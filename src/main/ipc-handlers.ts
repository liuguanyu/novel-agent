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
  WORKFLOW_QUERY_CHANNELS, WORKFLOW_COMMAND_CHANNEL, type WorkflowCommand,
} from '../shared/ipc/index.js';
import { readChapterTree, readChapterContent, readManifestChapterIds, readWorkspaceProjectContext } from './novel-reader.js';
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

const idSchema = z.string().trim().min(1).max(256);
const workflowRefSchema = z.object({ workflowId: idSchema, stageId: idSchema, issueId: idSchema.optional() }).strict();
const metaShape = { requestId: idSchema.optional(), operationId: idSchema.optional(), expectedVersion: z.number().int().nonnegative().optional(), workflowRef: workflowRefSchema.optional() };
const workflowSnapshotQuerySchema = z.object({ ...metaShape, workflowId: idSchema.optional(), projectId: idSchema }).strict();
const assetQuerySchema = z.object({ assetId: idSchema, projectId: idSchema }).strict();
const authorIntentSchema = z.object({ kind: z.enum(['preserve', 'extract', 'remove']), text: z.string().trim().min(1).max(2_000) }).strict();
const startWorkflowSchema = z.object({ ...metaShape, requestId: idSchema, operationId: idSchema, type: z.literal('start-workflow'), projectId: idSchema, workflowId: idSchema.optional(), kind: z.enum(['new-book-creation', 'legacy-book-revision']).optional(), objective: z.string().trim().min(1).max(10_000), authorIntents: z.array(authorIntentSchema).max(100).optional() }).strict();
const workflowActionSchema = z.object({
  ...metaShape, requestId: idSchema, operationId: idSchema, expectedVersion: z.number().int().nonnegative(), type: z.enum([
    'workflow-start-stage', 'workflow-confirm-stage', 'workflow-retry-stage', 'workflow-skip-stage',
    'workflow-pause', 'workflow-resume', 'workflow-cancel', 'workflow-update-goal', 'workflow-update-author-intents', 'workflow-select-issue', 'workflow-dismiss-issue',
    'workflow-verify-issue', 'workflow-change-asset', 'workflow-confirm-asset-change', 'workflow-reject-asset-change',
    'workflow-resolve-asset-impact',
  ]), workflowId: idSchema, stageId: idSchema.optional(), issueId: idSchema.optional(), assetId: idSchema.optional(),
  impactId: idSchema.optional(), runId: idSchema.optional(), reason: z.string().max(10_000).optional(), result: z.string().max(256).optional(),
  content: z.unknown().optional(), provenance: z.unknown().optional(), objective: z.string().trim().min(1).max(10_000).optional(), authorIntents: z.array(authorIntentSchema).max(100).optional(),
}).strict();
const workflowCommandSchema = z.union([startWorkflowSchema, workflowActionSchema]);

/**
 * 注册所有 IPC handlers。启动时调用一次。
 * @param runtime 长驻编排运行时（持有单一有状态图 + checkpointer 接线）。
 */
export function registerIpcHandlers(runtime: OrchestrationRuntime, workflowService?: WorkflowApplicationService): void {
  if (workflowService !== undefined) {
    ipcMain.handle(WORKFLOW_QUERY_CHANNELS.snapshot, async (_e, raw: unknown) => ({ snapshot: await workflowService.get(workflowSnapshotQuerySchema.parse(raw) as unknown as Parameters<WorkflowApplicationService['get']>[0]) }));
    ipcMain.handle(WORKFLOW_QUERY_CHANNELS.active, async (_e, raw: unknown) => ({ snapshot: await workflowService.active(idSchema.parse(raw)) }));
    ipcMain.handle(WORKFLOW_QUERY_CHANNELS.asset, async (_e, raw: unknown) => ({ asset: await workflowService.asset(assetQuerySchema.parse(raw)) }));
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
    }
  });
}

export { loadModelsConfig, ModelResolver };
