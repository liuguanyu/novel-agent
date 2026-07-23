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
} from '../shared/ipc/index.js';
import { readChapterTree, readChapterContent, readManifestChapterIds } from './novel-reader.js';
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
import {
  OrchestrationRuntime,
  type BackfillFactsParams,
  type SummonParams,
  type RestartParams,
} from './orchestration/runtime.js';

/**
 * 注册所有 IPC handlers。启动时调用一次。
 * @param runtime 长驻编排运行时（持有单一有状态图 + checkpointer 接线）。
 */
export function registerIpcHandlers(runtime: OrchestrationRuntime): void {
  ipcMain.handle(QUERY_CHANNELS.getChapterTree, async (): Promise<ChapterTreeDto> => {
    return readChapterTree();
  });

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
      case 'resume-run': {
        void runtime.resume(wc, message.runId, message.decision);
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
        const params: BackfillFactsParams = { runId: message.runId, chapters };
        void runtime.backfillFacts(wc, params);
        return;
      }
      case 'run-global-audit': {
        void runtime.runGlobalAudit(wc, message.runId);
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
