/**
 * IPC handlers 接线 (walking-skeleton 3.x → orchestration-runtime tasks 3.1–3.3, 4.3, 5.x)
 *
 * Main 侧把三件事接到 Electron IPC：
 *  1) 查询通道（invoke/handle）：取章节树、以节点 id 取正文、取 checkpoint 历史链（真读盘/DB）。
 *  2) 控制通道（on/send）：接前端 FrontendCommandMessage：
 *     summon-run/start-run → 委托 OrchestrationRuntime 向长驻图注入命令（不再单 agent 直调）；
 *     abort-run → 精确中断；resume-run → 带作者决策从挂起点续跑；
 *     restart-from-checkpoint → 从历史 checkpoint 重开分支。
 *  3) 运行时长驻一张有状态图（单一有状态图原则），will-quit/切工作区经 dispose 清理。
 *
 * LLM/读盘/图/checkpointer 均在 Main；Renderer 消息形状不变（仍走 dialogue-stream）。
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  IPC_CHANNELS,
  QUERY_CHANNELS,
  type FrontendCommandMessage,
  type GetCheckpointHistoryRequest,
  type GetChapterContentRequest,
  type ChapterTreeDto,
  type ChapterContentDto,
  type CheckpointHistoryDto,
  type StoryBibleDto,
  type ArchitectBoardDto,
  type GetTaskCenterRequest,
  type TaskCenterSnapshotDto,
  WORKFLOW_QUERY_CHANNELS, WORKFLOW_COMMAND_CHANNEL, type WorkflowCommand,
  type LegacyOutlineDto,
  type PreservationManifestDto,
  type OutlineGenerationProgressDto,
} from '../shared/ipc/index.js';
import { readChapterTree, readChapterContent, readManifestChapterIds, readWorkspaceProjectContext, DEFAULT_NOVEL_DIR } from './novel-reader.js';
import { asNodeId } from '../core/manuscript/index.js';
import {
  asCorpusItemType,
  asCorpusProjectId,
  asCorpusWorkId,
  type CorpusFilter,
  type CorpusQuery,
  type CorpusScope,
} from '../core/corpus/index.js';
import { emptyStoryBibleDto, projectStoryBible, emptyArchitectBoardDto, projectArchitectBoard } from './story-bible-dto.js';
import { loadModelsConfig, ModelResolver } from './model-resolver.js';
import type { WorkflowApplicationService } from './workflow-application-service.js';
import {
  OrchestrationRuntime,
  type BackfillFactsParams,
  type SummonParams,
  type RestartParams,
} from './orchestration/runtime.js';
import * as legacyOrgService from './legacy-organization/outline-service.js';
import * as legacyOrgStore from './legacy-organization/store.js';
import { PlotAdvisor } from './legacy-organization/plot-advisor.js';
import { BookDiagnoser } from './legacy-organization/book-diagnoser.js';
import { AssetExtractor } from './story-asset/asset-extractor.js';
import * as storyAssetStore from './story-asset/asset-store.js';
import { validateStoryAssetSnapshot, type StoryAssetSnapshot } from '../core/story-asset/index.js';
import type { StoryAssetSnapshotDto, PlotThreadDto, CharacterProfileDto, CharacterRelationDto, CharacterArcDto, ForeshadowingDto, CredibleClaimDto } from '../shared/ipc/index.js';

const idSchema = z.string().trim().min(1).max(256);

/* ── 故事资产确认 (draft → confirmed) ──────────────────────── */

function confirmAsset(snapshot: StoryAssetSnapshot, kind: 'plotThread' | 'character' | 'relation' | 'arc' | 'foreshadowing', assetId: string): StoryAssetSnapshot {
  const now = new Date().toISOString();
  const confirmItem = <T extends { readonly id: string; readonly status: string }>(items: ReadonlyArray<T>): ReadonlyArray<T> =>
    items.map((item) => item.id === assetId && item.status === 'draft' ? { ...item, status: 'confirmed' as const } : item);
  return {
    ...snapshot,
    updatedAt: now,
    plotThreads: kind === 'plotThread' ? confirmItem(snapshot.plotThreads) : snapshot.plotThreads,
    characters: kind === 'character' ? confirmItem(snapshot.characters) : snapshot.characters,
    relations: kind === 'relation' ? confirmItem(snapshot.relations) : snapshot.relations,
    arcs: kind === 'arc' ? confirmItem(snapshot.arcs) : snapshot.arcs,
    foreshadowings: kind === 'foreshadowing' ? snapshot.foreshadowings.map((item) => item.id === assetId && item.status === 'draft' ? { ...item, status: 'confirmed' as const } : item) : snapshot.foreshadowings,
  };
}

/* ── 故事资产快照投影 (core → DTO) ──────────────────────────── */

function projectClaim(claim: { readonly value: string; readonly credibility: string; readonly evidence: ReadonlyArray<{ readonly plotNodeId?: string; readonly chapterTitle?: string; readonly quote: string }>; readonly authorNote?: string }): CredibleClaimDto {
  return {
    value: claim.value,
    credibility: claim.credibility as CredibleClaimDto['credibility'],
    evidence: claim.evidence,
    ...(claim.authorNote === undefined ? {} : { authorNote: claim.authorNote }),
  };
}

function projectSnapshot(snapshot: StoryAssetSnapshot): StoryAssetSnapshotDto {
  const plotThreads: ReadonlyArray<PlotThreadDto> = snapshot.plotThreads.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    goal: projectClaim(t.goal),
    plotNodeIds: t.plotNodeIds,
    characterIds: t.characterIds,
    stages: t.stages,
    keyEvents: t.keyEvents,
    ...(t.timeAnchor === undefined ? {} : { timeAnchor: projectClaim(t.timeAnchor) }),
    status: t.status,
  }));
  const characters: ReadonlyArray<CharacterProfileDto> = snapshot.characters.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    identity: projectClaim(c.identity),
    appearance: projectClaim(c.appearance),
    abilities: projectClaim(c.abilities),
    personality: projectClaim(c.personality),
    languageStyle: projectClaim(c.languageStyle),
    desire: projectClaim(c.desire),
    goal: projectClaim(c.goal),
    fear: projectClaim(c.fear),
    weakness: projectClaim(c.weakness),
    currentStatus: projectClaim(c.currentStatus),
    plotThreadIds: c.plotThreadIds,
    ...(c.narrativeFunction === undefined ? {} : { narrativeFunction: projectClaim(c.narrativeFunction) }),
    status: c.status,
  }));
  const relations: ReadonlyArray<CharacterRelationDto> = snapshot.relations.map((r) => ({
    id: r.id,
    fromCharacterId: r.fromCharacterId,
    toCharacterId: r.toCharacterId,
    kind: r.kind,
    description: projectClaim(r.description),
    changes: r.changes,
    status: r.status,
  }));
  const arcs: ReadonlyArray<CharacterArcDto> = snapshot.arcs.map((a) => ({
    id: a.id,
    characterId: a.characterId,
    description: a.description,
    turningPoints: a.turningPoints,
    ...(a.startState === undefined ? {} : { startState: a.startState }),
    ...(a.endState === undefined ? {} : { endState: a.endState }),
    status: a.status,
  }));
  const foreshadowings: ReadonlyArray<ForeshadowingDto> = snapshot.foreshadowings.map((f) => ({
    id: f.id,
    description: f.description,
    state: f.state,
    plantedPlotNodeId: f.plantedPlotNodeId,
    ...(f.paidOffPlotNodeId === undefined ? {} : { paidOffPlotNodeId: f.paidOffPlotNodeId }),
    advancedPlotNodeIds: f.advancedPlotNodeIds,
    credibility: f.credibility,
    evidence: f.evidence,
    status: f.status,
  }));
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    plotThreads,
    characters,
    relations,
    arcs,
    foreshadowings,
    sourceOutlineVersion: snapshot.sourceOutlineVersion,
  };
}
const workflowRefSchema = z.object({ workflowId: idSchema, stageId: idSchema, issueId: idSchema.optional() }).strict();
const metaShape = { requestId: idSchema.optional(), operationId: idSchema.optional(), expectedVersion: z.number().int().nonnegative().optional(), workflowRef: workflowRefSchema.optional() };
const workflowSnapshotQuerySchema = z.object({ ...metaShape, workflowId: idSchema.optional(), projectId: idSchema }).strict();
const assetQuerySchema = z.object({ assetId: idSchema, projectId: idSchema }).strict();
const workflowIssuesQuerySchema = z.object({
  workflowId: idSchema,
  projectId: idSchema,
  severity: z.enum(['critical', 'warning', 'info']).optional(),
  status: z.enum(['open', 'fixing', 'verifying', 'resolved', 'dismissed']).optional(),
}).strict();
const taskCenterQuerySchema = z.object({
  projectId: idSchema.optional(),
  workflowId: idSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();
const taskUiEffectResultCommandSchema = z.object({
  type: z.literal('report-task-ui-effect-result'),
  runId: idSchema,
  operationId: idSchema,
  result: z.object({
    taskRunId: idSchema,
    activityId: idSchema,
    effectId: idSchema,
    effectKind: z.enum([
      'select-chapter', 'highlight-quote', 'scroll-to-evidence', 'show-diff',
      'show-hunk-review', 'show-checkpoint', 'open-fact-sheet', 'open-dashboard',
    ]),
    status: z.enum(['applied', 'failed']),
    message: z.string().trim().min(1).max(1_000),
  }).strict(),
}).strict();
const controlTaskRunCommandSchema = z.object({
  type: z.literal('control-task-run'),
  runId: idSchema,
  operationId: idSchema,
  taskRunId: idSchema,
  action: z.enum(['pause', 'resume', 'cancel']),
}).strict();
const supplementTaskInputCommandSchema = z.object({
  type: z.literal('supplement-task-input'),
  runId: idSchema,
  operationId: idSchema,
  taskRunId: idSchema,
  constraint: z.string().trim().min(1).max(4_000),
}).strict();
const authorIntentSchema = z.object({ kind: z.enum(['preserve', 'extract', 'remove']), text: z.string().trim().min(1).max(2_000) }).strict();
const startWorkflowSchema = z.object({ ...metaShape, requestId: idSchema, operationId: idSchema, type: z.literal('start-workflow'), projectId: idSchema, workflowId: idSchema.optional(), kind: z.enum(['new-book-creation', 'legacy-book-revision']).optional(), objective: z.string().trim().min(1).max(10_000), authorIntents: z.array(authorIntentSchema).max(100).optional() }).strict();
const workflowActionSchema = z.object({
  ...metaShape, requestId: idSchema, operationId: idSchema, expectedVersion: z.number().int().nonnegative(), type: z.enum([
    'workflow-start-stage', 'workflow-confirm-stage', 'workflow-retry-stage', 'workflow-skip-stage',
    'workflow-pause', 'workflow-resume', 'workflow-cancel', 'workflow-update-goal', 'workflow-update-author-intents', 'workflow-select-issue', 'workflow-dismiss-issue',
    'workflow-verify-issue', 'workflow-change-asset', 'workflow-confirm-asset-change', 'workflow-reject-asset-change',
    'workflow-resolve-asset-impact',
  ]), workflowId: idSchema, stageId: idSchema.optional(), chapterId: idSchema.optional(), issueId: idSchema.optional(), assetId: idSchema.optional(),
  candidateId: idSchema.optional(), impactId: idSchema.optional(), runId: idSchema.optional(), reason: z.string().max(10_000).optional(), result: z.string().max(256).optional(),
  content: z.unknown().optional(), provenance: z.unknown().optional(), objective: z.string().trim().min(1).max(10_000).optional(), authorIntents: z.array(authorIntentSchema).max(100).optional(),
}).strict();
const workflowCommandSchema = z.union([startWorkflowSchema, workflowActionSchema]);

/**
 * 注册所有 IPC handlers。启动时调用一次。
 * @param runtime 长驻编排运行时（持有单一有状态图 + checkpointer 接线）。
 */
export function registerIpcHandlers(
  runtime: OrchestrationRuntime,
  workflowService?: WorkflowApplicationService,
  getModelResolver?: () => ModelResolver | undefined,
): void {
  if (workflowService !== undefined) {
    ipcMain.handle(WORKFLOW_QUERY_CHANNELS.snapshot, async (_e, raw: unknown) => ({ snapshot: await workflowService.get(workflowSnapshotQuerySchema.parse(raw) as unknown as Parameters<WorkflowApplicationService['get']>[0]) }));
    ipcMain.handle(WORKFLOW_QUERY_CHANNELS.active, async (_e, raw: unknown) => ({ snapshot: await workflowService.active(idSchema.parse(raw)) }));
    ipcMain.handle(WORKFLOW_QUERY_CHANNELS.asset, async (_e, raw: unknown) => ({ asset: await workflowService.asset(assetQuerySchema.parse(raw)) }));
    ipcMain.handle(WORKFLOW_QUERY_CHANNELS.issues, async (_e, raw: unknown) => {
      const parsed = workflowIssuesQuerySchema.parse(raw);
      return { issues: await workflowService.issuesList({
        workflowId: parsed.workflowId,
        projectId: parsed.projectId,
        ...(parsed.severity === undefined ? {} : { severity: parsed.severity }),
        ...(parsed.status === undefined ? {} : { status: parsed.status }),
      }) };
    });
    ipcMain.handle(WORKFLOW_COMMAND_CHANNEL, async (event, raw: unknown) => {
      const command = workflowCommandSchema.parse(raw) as WorkflowCommand;
      const runId = command.type === 'start-workflow' ? command.operationId : (command.runId ?? command.operationId);
      try {
        const snapshot = await workflowService.command(command);
        if (snapshot !== null) event.sender.send(IPC_CHANNELS.controlEvent, { type: 'workflow-snapshot', runId, requestId: command.requestId, operationId: command.operationId, snapshot });
        for (const assetEvent of workflowService.drainAssetEvents()) event.sender.send(IPC_CHANNELS.controlEvent, assetEvent);
        return { snapshot };
      } catch (error: unknown) {
        const latest = command.type === 'start-workflow'
          ? null
          : await workflowService.latest(command.workflowId);
        const failure = {
          type: 'workflow-failure' as const,
          runId,
          requestId: command.requestId,
          operationId: command.operationId,
          error: { code: 'workflow-command-failed', message: error instanceof Error ? error.message : String(error) },
          ...(latest !== null ? { snapshot: latest } : {}),
        };
        event.sender.send(IPC_CHANNELS.controlEvent, failure);
        return { snapshot: latest, failure };
      }
    });
  }
  ipcMain.handle(QUERY_CHANNELS.getChapterTree, async (): Promise<ChapterTreeDto> => {
    return readChapterTree();
  });
  ipcMain.handle(QUERY_CHANNELS.getWorkspaceProject, async () => readWorkspaceProjectContext());

  ipcMain.handle(
    QUERY_CHANNELS.getChapterContent,
    async (_event: IpcMainInvokeEvent, req: unknown): Promise<ChapterContentDto> => {
      const request = req as GetChapterContentRequest;
      if (typeof request?.nodeId !== 'string' || request.nodeId.length === 0) {
        throw new Error('getChapterContent 缺少 nodeId');
      }
      return readChapterContent(request.nodeId);
    },
  );

  // time-travel 查询：取 checkpoint 历史链（task 5.1）。
  ipcMain.handle(
    QUERY_CHANNELS.getCheckpointHistory,
    async (_event: IpcMainInvokeEvent, req: unknown): Promise<CheckpointHistoryDto> => {
      const request = req as GetCheckpointHistoryRequest;
      return runtime.getCheckpointHistory(request?.checkpointId);
    },
  );

  ipcMain.handle(QUERY_CHANNELS.getStoryBible, async (): Promise<StoryBibleDto> => {
    const factStore = runtime.getFactStore();
    if (factStore === undefined) return emptyStoryBibleDto();
    const version = await factStore.getLatestVersion();
    if (version === null) return emptyStoryBibleDto();
    return projectStoryBible(await factStore.getView(version));
  });

  ipcMain.handle(QUERY_CHANNELS.getArchitectBoard, async (): Promise<ArchitectBoardDto> => {
    const factStore = runtime.getFactStore();
    if (factStore === undefined) return emptyArchitectBoardDto();
    const version = await factStore.getLatestVersion();
    if (version === null) return emptyArchitectBoardDto();
    return projectArchitectBoard(await factStore.getView(version));
  });

  ipcMain.handle(
    QUERY_CHANNELS.getTaskCenter,
    async (_event: IpcMainInvokeEvent, raw: unknown): Promise<TaskCenterSnapshotDto> => {
      const request = taskCenterQuerySchema.parse(raw) as GetTaskCenterRequest;
      return runtime.getTaskCenter(request);
    },
  );

  // ── 老书整理 v2 查询 ──────────────────────────────────────────

  ipcMain.handle(
    QUERY_CHANNELS.getLegacyOutline,
    async (_event: IpcMainInvokeEvent, raw: unknown): Promise<LegacyOutlineDto | undefined> => {
      const projectId = typeof raw === 'string' ? raw : '';
      if (projectId.length === 0) return undefined;
      const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
      if (outline === undefined) return undefined;
      return {
        id: outline.id,
        projectId: outline.projectId,
        version: outline.version,
        createdAt: outline.createdAt,
        crossChapterIssues: (outline.crossChapterIssues ?? []).map((issue) => ({
          id: issue.id,
          plotNodeIds: issue.plotNodeIds,
          chapterNodeIds: issue.chapterNodeIds,
          kind: issue.kind,
          severity: issue.severity,
          description: issue.description,
          evidence: issue.evidence,
          status: issue.status,
          authorNote: issue.authorNote,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
        })),
        deletedPlots: (outline.deletedPlots ?? []).map((item) => ({
          node: {
            id: item.node.id,
            parentId: item.node.parentId,
            order: item.node.order,
            kind: item.node.kind,
            title: item.node.title,
            summary: item.node.summary,
            characters: item.node.characters,
            sources: item.node.sources.map((s) => ({ nodeId: s.nodeRef.id, label: s.label, quote: s.quote })),
            crossChapter: item.node.crossChapter ?? false,
            preserved: item.node.preserved,
            authorNote: item.node.authorNote,
          },
          deletedAt: item.deletedAt,
        })),
        plotSequence: legacyOrgService.resolvePlotSequence(outline),
        nodes: outline.nodes.map((n) => ({
          id: n.id,
          parentId: n.parentId,
          order: n.order,
          kind: n.kind,
          title: n.title,
          summary: n.summary,
          characters: n.characters,
          sources: n.sources.map((s) => ({ nodeId: s.nodeRef.id, label: s.label, quote: s.quote })),
          crossChapter: n.crossChapter ?? false,
          preserved: n.preserved,
          authorNote: n.authorNote,
        })),
        advisorConversations: (outline.advisorConversations ?? []).map((conv) => ({
          plotNodeId: conv.plotNodeId,
          turns: conv.turns,
          updatedAt: conv.updatedAt,
        })),
      };
    },
  );

  ipcMain.handle(
    QUERY_CHANNELS.getPreservationManifest,
    async (_event: IpcMainInvokeEvent, raw: unknown): Promise<PreservationManifestDto | undefined> => {
      const projectId = typeof raw === 'string' ? raw : '';
      if (projectId.length === 0) return undefined;
      const manifest = await legacyOrgStore.loadPreservations(DEFAULT_NOVEL_DIR);
      if (manifest === undefined) return undefined;
      return {
        projectId: manifest.projectId,
        outlineId: manifest.outlineId,
        plots: manifest.plots.map((p) => ({
          id: p.id,
          outlineNodeId: p.outlineNodeId,
          title: p.title,
          sourceNodeIds: p.sourceRefs.map((s) => s.id),
          authorNote: p.authorNote,
          preservedAt: p.preservedAt,
        })),
        quotes: manifest.quotes.map((q) => ({
          id: q.id,
          text: q.text,
          sourceNodeId: q.sourceNodeRef.id,
          sourceChapterTitle: q.sourceChapterTitle,
          outlineNodeId: q.outlineNodeId,
          recommended: q.recommended,
          authorNote: q.authorNote,
          preservedAt: q.preservedAt,
        })),
        updatedAt: manifest.updatedAt,
      };
    },
  );

  ipcMain.handle(
    QUERY_CHANNELS.getOutlineGenerationProgress,
    async (_event: IpcMainInvokeEvent, raw: unknown): Promise<OutlineGenerationProgressDto> => {
      const projectId = typeof raw === 'string' ? raw : '';
      if (projectId.length === 0) return { status: 'idle', chaptersRead: undefined, totalChapters: undefined, error: undefined };
      return legacyOrgStore.loadProgress(DEFAULT_NOVEL_DIR);
    },
  );

  ipcMain.handle(
    QUERY_CHANNELS.getStoryAssetSnapshot,
    async (_event: IpcMainInvokeEvent, raw: unknown): Promise<StoryAssetSnapshotDto | undefined> => {
      const projectId = typeof raw === 'string' ? raw : '';
      if (projectId.length === 0) return undefined;
      const snapshot = await storyAssetStore.loadStoryAssetSnapshot(DEFAULT_NOVEL_DIR);
      if (snapshot === undefined) return undefined;
      return projectSnapshot(snapshot);
    },
  );

  ipcMain.on(IPC_CHANNELS.controlEvent, async (event, raw: unknown) => {
    const message = raw as FrontendCommandMessage;
    const wc = event.sender;
    switch (message.type) {
      case 'summon-run': {
        // node/selection 锚定诊断必须把章节正文放入初始状态；否则 reviewer 只有作者指令，无法审校正文。
        const initialDraft =
          message.anchorNodeId !== undefined && message.anchorNodeId.length > 0
            ? (await readChapterContent(message.anchorNodeId)).content
            : undefined;
        const params: SummonParams = {
          runId: message.runId,
          mode: message.mode,
          agent: message.agent,
          scope: message.scope,
          ...(message.anchorNodeId !== undefined ? { anchorNodeId: message.anchorNodeId } : {}),
          ...(initialDraft !== undefined ? { initialDraft } : {}),
          ...(message.softChapterNodeId !== undefined
            ? { softChapterNodeId: message.softChapterNodeId }
            : {}),
          ...(message.keywords !== undefined ? { keywords: message.keywords } : {}),
          ...(message.instruction !== undefined ? { instruction: message.instruction } : {}),
          ...(message.autoExtractFacts !== undefined ? { autoExtractFacts: message.autoExtractFacts } : {}),
          ...(message.targetAssetId !== undefined ? { targetAssetId: message.targetAssetId } : {}),
          ...(message.workflowRef !== undefined ? { workflowRef: message.workflowRef } : {}),
        };
        void runtime.summon(wc, params);
        return;
      }
      case 'start-run': {
        // start-run 无锚点/指令，按诊断召唤处理（保持既有骨架语义）。
        void runtime.summon(wc, { runId: message.runId, mode: 'diagnose' });
        return;
      }
      case 'abort-run': {
        runtime.abort(message.runId);
        return;
      }
      case 'abort-model-task': {
        runtime.abortModelTask(message.taskId, message.attemptId, message.runId);
        return;
      }
      case 'retry-model-task': {
        void runtime.retryModelTask(message.taskId, message.attemptId, wc);
        return;
      }
      case 'workflow-supplement-model-task': {
        void runtime.supplementModelTask(message.taskId, message.attemptId, message.supplement, wc);
        return;
      }
      case 'resume-run': {
        void runtime.resume(wc, message.runId, message.decision, message.workflowRef);
        return;
      }
      case 'restart-from-checkpoint': {
        const params: RestartParams = {
          runId: message.runId,
          checkpointId: message.checkpointId,
          ...(message.instruction !== undefined ? { instruction: message.instruction } : {}),
        };
        void runtime.restartFromCheckpoint(wc, params);
        return;
      }
      case 'extract-facts': {
        const chapter = await readChapterContent(message.nodeId);
        void runtime.extractFacts(wc, message.runId, {
          location: { id: asNodeId(message.nodeId), kind: 'chapter' },
          text: chapter.content,
        });
        return;
      }
      case 'backfill-facts': {
        const nodeIds = message.nodeIds !== undefined && message.nodeIds.length > 0
          ? message.nodeIds
          : await readManifestChapterIds();
        const chapters = await Promise.all(
          nodeIds.map(async (nodeId) => {
            const chapter = await readChapterContent(nodeId);
            return {
              location: { id: asNodeId(nodeId), kind: 'chapter' as const },
              text: chapter.content,
            };
          }),
        );
        const params: BackfillFactsParams = {
          runId: message.runId,
          chapters,
          ...(message.workflowRef === undefined ? {} : { workflowRef: message.workflowRef }),
        };
        void runtime.backfillFacts(wc, params);
        return;
      }
      case 'run-global-audit': {
        void runtime.runGlobalAudit(wc, message.runId, message.workflowRef);
        return;
      }
      case 'run-targeted-verification': {
        void runtime.runTargetedVerification(wc, message.runId, message.workflowRef);
        return;
      }
      case 'locate-source': {
        void runtime.locateSource(wc, message.runId, message.workflowRef);
        return;
      }
      case 'choose-source-location': {
        void runtime.chooseSourceLocationCommand(wc, message.taskRunId, message.candidateId, message.operationId);
        return;
      }
      case 'control-task-run': {
        const parsed = controlTaskRunCommandSchema.safeParse(raw);
        if (!parsed.success) return;
        void runtime.controlTaskRun(wc, parsed.data.taskRunId, parsed.data.action, parsed.data.operationId).catch(() => {
          // Invalid or stale control requests are rejected without creating an unhandled rejection.
        });
        return;
      }
      case 'report-task-ui-effect-result': {
        const parsed = taskUiEffectResultCommandSchema.safeParse(raw);
        if (!parsed.success) return;
        void runtime.reportTaskUiEffectResult(wc, parsed.data.operationId, parsed.data.result).catch(() => {
          // Invalid or stale effect receipts are rejected without creating an unhandled rejection.
        });
        return;
      }
      case 'supplement-task-input': {
        const parsed = supplementTaskInputCommandSchema.safeParse(raw);
        if (!parsed.success) return;
        void runtime.supplementTaskInput(wc, parsed.data.taskRunId, parsed.data.constraint, parsed.data.operationId).catch(() => {
          // 无效/陈旧的补充请求静默拒绝，不产生未处理的 rejection。
        });
        return;
      }
      case 'retrieve-corpus': {
        const dto = message.query;
        const scope: CorpusScope = {
          level: dto.scope.level,
          projectId: dto.scope.projectId !== null ? asCorpusProjectId(dto.scope.projectId) : null,
          workId: dto.scope.workId !== null ? asCorpusWorkId(dto.scope.workId) : null,
        };
        const filter: CorpusFilter | undefined =
          dto.filter !== undefined
            ? {
                ...(dto.filter.types !== undefined
                  ? { types: dto.filter.types.map((t) => asCorpusItemType(t)) }
                  : {}),
                ...(dto.filter.tags !== undefined ? { tags: dto.filter.tags } : {}),
                ...(dto.filter.sourceKinds !== undefined
                  ? { sourceKinds: dto.filter.sourceKinds }
                  : {}),
              }
            : undefined;
        const query: CorpusQuery = {
          query: dto.query,
          scope,
          ...(filter !== undefined ? { filter } : {}),
          ...(dto.topK !== undefined ? { topK: dto.topK } : {}),
          ...(dto.minScore !== undefined ? { minScore: dto.minScore } : {}),
        };
        void runtime.retrieveCorpus(wc, message.runId, query);
        return;
      }
      case 'compute-refactor-diff': {
        void runtime.computeRefactorDiff(
          wc,
          message.runId,
          {
            node: { id: asNodeId(message.anchor.nodeId), kind: 'chapter' },
            from: message.anchor.from,
            to: message.anchor.to,
          },
          message.rewrittenFragment,
          message.workflowRef,
        );
        return;
      }
      case 'apply-hunk-decisions': {
        void runtime.applyHunkDecisions(
          wc,
          message.runId,
          {
            node: { id: asNodeId(message.anchor.nodeId), kind: 'chapter' },
            from: message.anchor.from,
            to: message.anchor.to,
          },
          message.rewrittenFragment,
          message.decisions.map((d) => ({ hunkId: d.hunkId, decision: d.decision })),
          message.workflowRef,
        );
        return;
      }
      case 'confirm-story-bible-fact': {
        void runtime.confirmStoryBibleFact(wc, message.runId, message.target);
        return;
      }
      case 'edit-story-bible-fact': {
        void runtime.editStoryBibleFact(wc, message.runId, message.edit);
        return;
      }
      case 'delete-story-bible-fact': {
        void runtime.deleteStoryBibleFact(wc, message.runId, message.target);
        return;
      }
      case 'merge-story-bible-entities': {
        void runtime.mergeStoryBibleEntities(
          wc,
          message.runId,
          message.sourceEntityId,
          message.targetEntityId,
        );
        return;
      }
      case 'get-chapter-tree':
      case 'get-chapter-content':
        // 查询走 invoke/handle 通道，此处忽略。
        return;
      case 'generate-legacy-outline': {
        const tree = await readChapterTree(DEFAULT_NOVEL_DIR);
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.generateOutline(ctx.projectId, DEFAULT_NOVEL_DIR, tree);
        return;
      }
      case 'recognize-chapter-plots': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        const resolver = getModelResolver?.();
        if (resolver === undefined) {
          await legacyOrgStore.saveProgress(DEFAULT_NOVEL_DIR, {
            status: 'failed', chaptersRead: 0, totalChapters: 1, error: '模型尚未配置，无法识别章节情节',
          });
          return;
        }
        await legacyOrgService.recognizeChapterPlots(
          DEFAULT_NOVEL_DIR,
          ctx.projectId,
          message.chapterNodeId,
          resolver,
        ).catch(() => {
          // 服务已将明确失败原因写入进度；控制消息无需制造未处理 rejection。
        });
        return;
      }
      case 'recognize-book-plots': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        const resolver = getModelResolver?.();
        if (resolver === undefined) {
          await legacyOrgStore.saveProgress(DEFAULT_NOVEL_DIR, {
            status: 'failed', chaptersRead: 0, totalChapters: undefined, error: '模型尚未配置，无法识别全书情节',
          });
          return;
        }
        await legacyOrgService.recognizeBookPlots(
          DEFAULT_NOVEL_DIR,
          ctx.projectId,
          resolver,
        ).catch(() => {
          // 服务已经写入可恢复的失败进度。
        });
        return;
      }
      case 'ask-legacy-plot-advisor': {
        const resolver = getModelResolver?.();
        if (resolver === undefined) {
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'legacy-plot-advisor-failed',
            runId: message.runId,
            plotNodeId: message.plotNodeId,
            error: '模型尚未配置，无法联系参谋',
          });
          return;
        }
        try {
          const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
          const chapter = outline?.nodes.find((node) => node.id === message.chapterNodeId && node.kind === 'chapter');
          const plot = outline?.nodes.find((node) => node.id === message.plotNodeId && node.kind === 'plot-beat' && node.parentId === message.chapterNodeId);
          if (chapter === undefined || plot === undefined) throw new Error('找不到当前情节，请刷新后重试');
          const chapterContent = await readChapterContent(message.chapterNodeId, DEFAULT_NOVEL_DIR);
          const advice = await new PlotAdvisor(resolver).ask({
            chapterTitle: chapter.title,
            chapterContent: chapterContent.content,
            plotTitle: plot.title,
            plotSummary: plot.summary,
            evidenceQuote: plot.sources[0]?.quote,
            question: message.question,
            conversation: message.conversation ?? [],
            mode: message.mode,
          });
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'legacy-plot-advisor-completed',
            runId: message.runId,
            plotNodeId: message.plotNodeId,
            question: message.question,
            advice: advice.advice,
            options: advice.options,
          });
        } catch (error: unknown) {
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'legacy-plot-advisor-failed',
            runId: message.runId,
            plotNodeId: message.plotNodeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case 'diagnose-legacy-book': {
        const resolver = getModelResolver?.();
        if (resolver === undefined) {
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'legacy-book-diagnosis-failed',
            runId: message.runId,
            error: '模型尚未配置，无法运行全书诊断',
          });
          return;
        }
        try {
          const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
          if (outline === undefined) throw new Error('大纲尚未生成，请先生成大纲');
          const candidates = await new BookDiagnoser(resolver).diagnose(outline);
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'legacy-book-diagnosis-completed',
            runId: message.runId,
            candidates,
          });
        } catch (error: unknown) {
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'legacy-book-diagnosis-failed',
            runId: message.runId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case 'extract-story-assets': {
        const resolver = getModelResolver?.();
        if (resolver === undefined) {
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'story-asset-extraction-failed',
            runId: message.runId,
            error: '模型尚未配置，无法提炼故事资产',
          });
          return;
        }
        try {
          const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
          if (outline === undefined) throw new Error('大纲尚未生成，请先生成大纲');
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'story-asset-extraction-started',
            runId: message.runId,
            projectId: message.projectId,
          });
          const version = await storyAssetStore.nextStoryAssetVersion(DEFAULT_NOVEL_DIR);
          const snapshot = await new AssetExtractor(resolver).extract(outline, version);
          await storyAssetStore.saveStoryAssetSnapshot(DEFAULT_NOVEL_DIR, snapshot, 'draft');
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'story-asset-extraction-completed',
            runId: message.runId,
            projectId: message.projectId,
            snapshot: projectSnapshot(snapshot),
          });
        } catch (error: unknown) {
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'story-asset-extraction-failed',
            runId: message.runId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case 'confirm-story-asset': {
        try {
          const snapshot = await storyAssetStore.loadStoryAssetSnapshot(DEFAULT_NOVEL_DIR);
          if (snapshot === undefined) throw new Error('故事资产快照不存在，请先提炼');
          if (message.expectedVersion !== undefined && message.expectedVersion !== snapshot.version) throw new Error(`故事资产版本冲突：当前版本为 ${snapshot.version}`);
          const updated = confirmAsset(snapshot, message.assetKind, message.assetId);
          const targetItems = message.assetKind === 'plotThread' ? updated.plotThreads : message.assetKind === 'character' ? updated.characters : message.assetKind === 'relation' ? updated.relations : message.assetKind === 'arc' ? updated.arcs : updated.foreshadowings;
          const target = targetItems.find((item) => item.id === message.assetId);
          if (target === undefined) throw new Error(`故事资产不存在：${message.assetId}`);
          if (target.status !== 'confirmed') throw new Error(`故事资产无法确认，当前状态为 ${target.status}`);
          const version = await storyAssetStore.nextStoryAssetVersion(DEFAULT_NOVEL_DIR);
          const versioned = { ...updated, id: `snapshot-${Date.now()}`, version };
          if (versioned === snapshot) throw new Error('故事资产确认失败');
          await storyAssetStore.saveStoryAssetSnapshot(DEFAULT_NOVEL_DIR, versioned, 'draft', snapshot.version);
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'story-asset-confirmed', runId: message.runId, assetKind: message.assetKind, assetId: message.assetId,
          });
        } catch (error: unknown) {
          wc.send(IPC_CHANNELS.controlEvent, {
            type: 'story-asset-confirmation-failed',
            runId: message.runId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case 'edit-story-asset': {
        try {
          const snapshot = await storyAssetStore.loadStoryAssetSnapshot(DEFAULT_NOVEL_DIR);
          if (snapshot === undefined) throw new Error('故事资产快照不存在，请先提炼');
          if (snapshot.version !== message.expectedVersion) throw new Error(`故事资产版本冲突：当前版本为 ${snapshot.version}`);
          const update = <T extends { readonly id: string }>(items: ReadonlyArray<T>, fn: (item: T) => T): ReadonlyArray<T> => items.map((item) => item.id === message.assetId ? fn(item) : item);
          const note = message.authorNote?.trim();
          const updateClaim = <T extends { readonly value: string }>(claim: T): T => ({ ...claim, value: message.value.trim(), ...(note === undefined || note.length === 0 ? {} : { authorNote: note }) });
          const updated: StoryAssetSnapshot = {
            ...snapshot,
            updatedAt: new Date().toISOString(),
            plotThreads: message.assetKind === 'plotThread' ? update(snapshot.plotThreads, (item) => ({ ...item, goal: updateClaim(item.goal) })) : snapshot.plotThreads,
            characters: message.assetKind === 'character' ? update(snapshot.characters, (item) => ({ ...item, identity: updateClaim(item.identity) })) : snapshot.characters,
            relations: message.assetKind === 'relation' ? update(snapshot.relations, (item) => ({ ...item, description: updateClaim(item.description) })) : snapshot.relations,
            arcs: message.assetKind === 'arc' ? update(snapshot.arcs, (item) => ({ ...item, description: message.value.trim() })) : snapshot.arcs,
            foreshadowings: snapshot.foreshadowings,
          };
          const version = await storyAssetStore.nextStoryAssetVersion(DEFAULT_NOVEL_DIR);
          const versioned = { ...updated, id: `snapshot-${Date.now()}`, version };
          await storyAssetStore.saveStoryAssetSnapshot(DEFAULT_NOVEL_DIR, versioned, 'draft', snapshot.version);
          wc.send(IPC_CHANNELS.controlEvent, { type: 'story-asset-changed', runId: message.runId, action: 'edited', snapshot: projectSnapshot(versioned) });
        } catch (error: unknown) {
          wc.send(IPC_CHANNELS.controlEvent, { type: 'story-asset-change-failed', runId: message.runId, action: 'edited', error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      case 'publish-story-assets': {
        try {
          const snapshot = await storyAssetStore.loadStoryAssetSnapshot(DEFAULT_NOVEL_DIR);
          if (snapshot === undefined) throw new Error('故事资产草案不存在，请先提炼');
          if (snapshot.version !== message.expectedVersion) throw new Error(`故事资产版本冲突：当前版本为 ${snapshot.version}`);
          const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
          const plotIds = outline === undefined ? undefined : new Set(outline.nodes.filter((item) => item.kind === 'plot-beat').map((item) => item.id));
          const validationIssues = validateStoryAssetSnapshot(snapshot, plotIds);
          if (validationIssues.length > 0) throw new Error(`故事资产校验失败：${validationIssues[0]?.message ?? '未知问题'}`);
          const allItems = [...snapshot.plotThreads, ...snapshot.characters, ...snapshot.relations, ...snapshot.arcs, ...snapshot.foreshadowings];
          if (allItems.some((item) => item.status !== undefined && item.status !== 'confirmed' && item.status !== 'formal')) throw new Error('仍有未确认的故事资产，不能发布');
          const formal = { ...snapshot, id: `snapshot-${Date.now()}`, version: await storyAssetStore.nextStoryAssetVersion(DEFAULT_NOVEL_DIR), updatedAt: new Date().toISOString(), plotThreads: snapshot.plotThreads.map((item) => ({ ...item, status: 'formal' as const })), characters: snapshot.characters.map((item) => ({ ...item, status: 'formal' as const })), relations: snapshot.relations.map((item) => ({ ...item, status: 'formal' as const })), arcs: snapshot.arcs.map((item) => ({ ...item, status: 'formal' as const })), foreshadowings: snapshot.foreshadowings.map((item) => ({ ...item, status: 'formal' as const })) };
          await storyAssetStore.saveStoryAssetSnapshot(DEFAULT_NOVEL_DIR, formal, 'formal', snapshot.version);
          wc.send(IPC_CHANNELS.controlEvent, { type: 'story-asset-changed', runId: message.runId, action: 'published', snapshot: projectSnapshot(formal) });
        } catch (error: unknown) {
          wc.send(IPC_CHANNELS.controlEvent, { type: 'story-asset-change-failed', runId: message.runId, action: 'published', error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      case 'add-outline-plot': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.addOutlinePlot(DEFAULT_NOVEL_DIR, ctx.projectId, message.chapterNodeId, message.title, message.summary);
        return;
      }
      case 'update-outline-plot': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.updateOutlinePlot(DEFAULT_NOVEL_DIR, ctx.projectId, message.plotNodeId, message.title, message.summary);
        return;
      }
      case 'move-outline-plot': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.moveOutlinePlot(DEFAULT_NOVEL_DIR, ctx.projectId, message.plotNodeId, message.direction);
        return;
      }
      case 'delete-outline-plot': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.deleteOutlinePlot(DEFAULT_NOVEL_DIR, ctx.projectId, message.plotNodeId);
        return;
      }
      case 'restore-deleted-plot': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.restoreDeletedPlot(DEFAULT_NOVEL_DIR, ctx.projectId, message.plotNodeId);
        return;
      }
      case 'merge-outline-plots': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.mergeOutlinePlots(DEFAULT_NOVEL_DIR, ctx.projectId, message.plotNodeIds, message.primaryChapterNodeId, message.title, message.summary);
        return;
      }
      case 'add-cross-chapter-issue': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.addCrossChapterIssue(DEFAULT_NOVEL_DIR, ctx.projectId, message.plotNodeIds, message.kind, message.severity, message.description, message.evidence, message.authorNote);
        return;
      }
      case 'update-cross-chapter-issue': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.updateCrossChapterIssue(DEFAULT_NOVEL_DIR, ctx.projectId, message.issueId, message.status, message.authorNote);
        return;
      }
      case 'save-advisor-conversation': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.saveAdvisorConversation(DEFAULT_NOVEL_DIR, ctx.projectId, message.plotNodeId, message.turns);
        return;
      }
      case 'clear-advisor-conversation': {
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        await legacyOrgService.clearAdvisorConversation(DEFAULT_NOVEL_DIR, ctx.projectId, message.plotNodeId);
        return;
      }
      case 'preserve-plot': {
        const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        if (outline === undefined) return;
        const node = outline.nodes.find((n) => n.id === message.outlineNodeId);
        await legacyOrgService.preservePlot(
          DEFAULT_NOVEL_DIR,
          ctx.projectId,
          outline.id,
          { outlineNodeId: message.outlineNodeId, authorNote: message.authorNote },
          node?.title ?? '',
        );
        return;
      }
      case 'unpreserve-plot': {
        const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        if (outline === undefined) return;
        await legacyOrgService.unpreservePlot(DEFAULT_NOVEL_DIR, ctx.projectId, outline.id, message.plotId);
        return;
      }
      case 'preserve-quote': {
        const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        if (outline === undefined) return;
        await legacyOrgService.preserveQuote(
          DEFAULT_NOVEL_DIR,
          ctx.projectId,
          outline.id,
          {
            text: message.text,
            sourceNodeRef: message.sourceNodeId,
            sourceChapterTitle: message.sourceChapterTitle,
            outlineNodeId: message.outlineNodeId,
            authorNote: message.authorNote,
          },
        );
        return;
      }
      case 'unpreserve-quote': {
        const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        if (outline === undefined) return;
        await legacyOrgService.unpreserveQuote(DEFAULT_NOVEL_DIR, ctx.projectId, outline.id, message.quoteId);
        return;
      }
      case 'update-preservation-note': {
        const outline = await legacyOrgStore.loadOutline(DEFAULT_NOVEL_DIR);
        const ctx = await readWorkspaceProjectContext(DEFAULT_NOVEL_DIR);
        if (outline === undefined) return;
        await legacyOrgService.updateNote(
          DEFAULT_NOVEL_DIR,
          ctx.projectId,
          outline.id,
          message.itemId,
          message.kind,
          message.note,
        );
        return;
      }
    }
  });
}

export { loadModelsConfig, ModelResolver };
