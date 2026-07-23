/**
 * 编排运行时：单一有状态图的 Main 侧宿主 (orchestration-runtime tasks 2.7, 3.1–3.4, 4.x, 5.x)
 *
 * 持有**一张**编译后的 LangGraph（单一有状态图原则），召唤/恢复只向其注入命令改变下一跳，
 * MUST NOT 每次 new（task 3.4）。把图的抽象回调（emitDialogue/emitReasoning/recordMilestone）
 * 实现为具体的 IPC 回推与 SqliteCheckpointer 提交——图本身不 import electron/db（职责边界）。
 *
 * 消息形状对 Renderer 不变（task 3.3）：仍走 dialogue-stream 的 BackendStreamMessage
 * （stream-start/chunk/end/error）。中断/裁决的 control-event 通道在 section 4 叠加，happy path 无感。
 *
 * Checkpointer 两个时间尺度（design D3.5 方案 A）：运行态挂起/续跑由图内 MemorySaver 承担；
 * 里程碑态（作者可见 time-travel）由 recordMilestone 提交进 I2 SqliteCheckpointer，沿 parent 链成史。
 */

import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { Command, INTERRUPT } from '@langchain/langgraph';
import {
  IPC_CHANNELS,
  type BackendControlEvent,
  type BackendStreamMessage,
  type CheckpointDto,
  type CheckpointHistoryDto,
  type ConsistencyIssueDto,
  type CorpusHitDto,
  type RunId,
  type StoryBibleFactDeleteLocatorDto,
  type StoryBibleFactEditDto,
  type StoryBibleFactLocatorDto,
} from '../../shared/ipc/index.js';
import type { ResumeDecision } from '../../shared/ipc/index.js';
import type { CapabilityTier } from '../../core/model/index.js';
import type { Checkpoint, CheckpointId, NovelState } from '../../core/orchestration/index.js';
import { actionForAgent } from '../../core/orchestration/index.js';
import type { CandidateFact, ConsistencyIssue, ExtractionInput, FactView } from '../../core/story-bible/index.js';
import { asCheckpointId, asFactVersionId } from '../../core/story-bible/index.js';
import { asNodeId } from '../../core/manuscript/node-id.js';
import type { ModelResolver } from '../model-resolver.js';
import { appendOrchestrationLog } from '../local-log.js';
import type { SqliteCheckpointer, SqliteFactStore } from '../db/index.js';
import {
  assembleContext,
  type AssemblyRequest,
  type SummonScope,
} from './context-assembler.js';
import {
  buildCorrectionIssues,
  detectInstructionConflicts,
} from '../retrieval/fact-consistency.js';
import { retrieveFacts, type FactRetrievalQuery } from '../retrieval/fact-retrieval.js';
import {
  applyIngestPlan,
  buildIngestPlan,
  FactExtractor,
  normalizeCandidateFacts,
  chunkExtractionInput,
  type FactExtractionResult,
  type IngestConflict,
  type IngestPlan,
} from '../extraction/index.js';
import { countAuditableItems } from '../../core/audit/index.js';
import { InlineAuditRunner, AuditAbortedError, type AuditRunner } from '../audit/audit-runner.js';
import {
  carveFragment,
  computeDiffResult,
  spliceAcceptedHunks,
  type FragmentAnchor,
  type HunkDecision,
  type HunkValidity,
} from '../../core/refactor/index.js';
import { InlineDiffRunner, DiffAbortedError, type DiffRunner } from '../refactor/diff-runner.js';
import { writeBackRefactoredFragment } from '../refactor/refactor-writeback.js';
import { InlineEmbedRunner, EmbedAbortedError, type EmbedRunner } from '../corpus/embed-runner.js';
import type { CorpusStore } from '../corpus/corpus-store.js';
import {
  rankCorpusHits,
  type CorpusQuery,
  type CorpusHit,
} from '../../core/corpus/index.js';
import { readChapterContent } from '../novel-reader.js';
import {
  createOrchestrationGraph,
  type CompiledOrchestrationGraph,
  type GraphRunDeps,
} from './graph.js';

/** 审校类 agent：产 activeBugs、运行结束后结构化下发 review-completed（与写手/规划类区分）。 */
const REVIEW_AGENTS: ReadonlySet<string> = new Set([
  'reviewer',
  'fact-checker',
  'plagiarism-checker',
]);

/** 召唤参数（从 IPC summon/start 命令投影出的最小形状）。 */
export interface BackfillFactsParams {
  runId: RunId;
  chapters: ReadonlyArray<ExtractionInput>;
}

export interface SummonParams {
  runId: RunId;
  mode: 'diagnose' | 'mutate';
  /** 目标专家 agent 标识（驱动组装策略与事实检查）；缺省 writer。 */
  agent?: string;
  /** 作用范围（硬锚点 node/selection vs 软范围 document/project）；缺省 project。 */
  scope?: SummonScope;
  anchorNodeId?: string;
  /** 召唤入口已解析出的待处理正文（例如锚定章节 Markdown 原文）；diagnose 时给 reviewer 审校。 */
  initialDraft?: string;
  /** 软提示：作者对话中提及的章号节点 id（仅软排序/纠偏判定用，不硬过滤）。 */
  softChapterNodeId?: string;
  /** 检索关键词（实体名/伏笔/时间线关键词）。 */
  keywords?: ReadonlyArray<string>;
  instruction?: string;
  /** writer 产出新正文后是否自动抽取低风险事实；冲突仍必须人工裁决。 */
  autoExtractFacts?: boolean;
}

/** 从 checkpoint 重启的参数（time-travel task 5.2）。 */
export interface RestartParams {
  runId: RunId;
  /** 选定的历史 checkpoint id（MUST 存在） */
  checkpointId: string;
  /** 可选的作者新指令（为空时沿用 checkpoint 内 chatHistory 的上下文继续） */
  instruction?: string;
}

/** 运行时依赖注入：模型解析器、里程碑 checkpointer 与事实库（均可能未就绪）。 */
export interface RuntimeDeps {
  getModelResolver: () => ModelResolver | undefined;
  getCheckpointer: () => SqliteCheckpointer | undefined;
  /** 事实库读句柄（供上下文组装与事实检查）；未就绪时图降级为不召回。 */
  getFactStore: () => SqliteFactStore | undefined;
  /** 全书总检派发器（I5）：缺省内联执行；main/index 注入 utilityProcess 版本。 */
  getAuditRunner?: () => AuditRunner | undefined;
  /** 局部重构 diff 派发器（I6）：缺省内联执行；main/index 注入 utilityProcess 版本。 */
  getDiffRunner?: () => DiffRunner | undefined;
  /** 素材 embedding 派发器（I7）：缺省内联执行；main/index 注入 utilityProcess 版本。 */
  getEmbedRunner?: () => EmbedRunner | undefined;
  /** 素材向量存储（I7）：未就绪时检索返回空快照（弱参考，不阻断）。 */
  getCorpusStore?: () => CorpusStore | undefined;
}

/** 本次召唤的检索/组装基座（scope/锚点/关键词/指令）。随账本持久，供 resume 时 assembleContext 复用。 */
interface RunAssemblyBase {
  readonly agent: string;
  readonly scope: SummonScope;
  readonly anchorNodeId?: string;
  readonly softChapterNodeId?: string;
  readonly keywords: ReadonlyArray<string>;
  readonly instruction: string;
  readonly autoExtractFacts: boolean;
}

/** 抽取冲突挂起账本：等待作者经 resume-run 选择 accept-new / keep-existing 等选项。 */
interface PendingExtractionConflictRun {
  readonly wc: WebContents;
  readonly chapterId: string;
  readonly conflicts: ReadonlyArray<IngestConflict>;
}

/** 一次运行的可变账本（seq/里程碑 parent 游标随节点推进而变）。 */
interface ActiveRun {
  readonly controller: AbortController;
  readonly wc: WebContents;
  /** LangGraph 运行态 checkpoint 键（= runId，标识同一 thread 的挂起/续跑）。 */
  readonly threadId: string;
  /** 本次召唤的组装基座（供 assembleContext/checkFacts 闭包读）。 */
  readonly assembly: RunAssemblyBase;
  /** dialogue 分片序号（前端按序拼接）。 */
  seq: number;
  /** 里程碑链游标：下一次 commit 的 parent（初始 null，提交后前移）。 */
  parent: CheckpointId | null;
}

/** restart/无参场景的默认组装基座：writer + 全局范围 + 空关键词 → assembleContext 返回空、checkFacts 返回空。 */
const DEFAULT_ASSEMBLY_BASE: RunAssemblyBase = {
  agent: 'writer',
  scope: 'project',
  keywords: [],
  instruction: '',
  autoExtractFacts: false,
};

/** 从召唤参数投影出组装基座（缺省值：writer/project/空关键词/空指令）。可选锚点用 spread 守卫 exactOptionalPropertyTypes。 */
function assemblyBaseFrom(params: SummonParams): RunAssemblyBase {
  return {
    agent: params.agent ?? 'writer',
    scope: params.scope ?? 'project',
    keywords: params.keywords ?? [],
    instruction: params.instruction ?? '',
    autoExtractFacts: params.autoExtractFacts ?? false,
    ...(params.anchorNodeId !== undefined ? { anchorNodeId: params.anchorNodeId } : {}),
    ...(params.softChapterNodeId !== undefined
      ? { softChapterNodeId: params.softChapterNodeId }
      : {}),
  };
}

/**
 * 关键词投影为 FactRetrievalQuery：空数组返回 undefined（无关键词=不过滤实体/伏笔/时间线）。
 * 否则把关键词 join 成一个词，同时填进三类字段——让每类各按自己的字段子串匹配（实体名/伏笔/时间线）。
 */
function keywordsToQuery(keywords: ReadonlyArray<string>): FactRetrievalQuery | undefined {
  if (keywords.length === 0) return undefined;
  const term = keywords.join(' ');
  return {
    entityName: term,
    plotHookKeyword: term,
    timelineKeyword: term,
  };
}

export class OrchestrationRuntime {
  readonly #graph: CompiledOrchestrationGraph;
  readonly #deps: RuntimeDeps;
  /** 每 runId 一条活跃账本（abort 精确中断、resume 复用 thread/parent）。 */
  readonly #runs = new Map<RunId, ActiveRun>();
  /** 显式抽取冲突的挂起账本，复用 resume-run 手刹通道裁决。 */
  readonly #pendingExtractionConflicts = new Map<RunId, PendingExtractionConflictRun>();

  constructor(deps: RuntimeDeps) {
    this.#graph = createOrchestrationGraph();
    this.#deps = deps;
  }

  /** 精确中断某运行（拉手刹）。节点在提交里程碑前抛出，故不落 checkpoint（干净态）。 */
  abort(runId: RunId): void {
    this.#runs.get(runId)?.controller.abort();
  }

  /** 启动一次非 LangGraph 的显式抽取账本，使 abort-run 也能中断抽取模型调用。 */
  #startUtilityRun(wc: WebContents, runId: RunId): ActiveRun {
    const run: ActiveRun = {
      controller: new AbortController(),
      wc,
      threadId: runId,
      assembly: DEFAULT_ASSEMBLY_BASE,
      seq: 0,
      parent: null,
    };
    this.#runs.set(runId, run);
    return run;
  }

  /** 进程退出/切工作区时清理所有活跃运行（task 3.2）。 */
  disposeAll(): void {
    for (const run of this.#runs.values()) run.controller.abort();
    this.#runs.clear();
  }

  /** 只读查询入口使用的事实库句柄；Renderer 仍只能通过 Main 投影后的 DTO 访问。 */
  getFactStore(): SqliteFactStore | undefined {
    return this.#deps.getFactStore();
  }

  /** 向渲染进程回推一条 dialogue 流式消息（保持 walking-skeleton 形状）。 */
  #send(wc: WebContents, message: BackendStreamMessage): void {
    wc.send(IPC_CHANNELS.dialogueStream, message);
  }

  /** 向渲染进程下行一条控制事件（与内容流严格分离，task 4.2）。 */
  #sendControl(wc: WebContents, event: BackendControlEvent): void {
    wc.send(IPC_CHANNELS.controlEvent, event);
  }

  /** 组装本次运行注入图的抽象回调（把图与具体 IPC/DB 解耦）。 */
  #buildRunDeps(run: ActiveRun, resolver: ModelResolver): GraphRunDeps {
    const checkpointer = this.#deps.getCheckpointer();
    const factStore = this.#deps.getFactStore();
    const assembly = run.assembly;
    return {
      createAdapter: (agentId: string, tier: CapabilityTier, options) =>
        resolver.createAdapter(agentId, tier, options),
      emitDialogue: (delta: string) => {
        this.#send(run.wc, {
          type: 'stream-chunk',
          runId: run.threadId,
          kind: 'dialogue',
          delta,
          seq: run.seq++,
        });
      },
      emitReasoning: (delta: string) => {
        this.#send(run.wc, {
          type: 'stream-chunk',
          runId: run.threadId,
          kind: 'dialogue',
          delta: `\u0001reasoning\u0001${delta}`,
          seq: run.seq++,
        });
      },
      signal: run.controller.signal,
      log: (message: string) => {
        const line = `[orchestration:${run.threadId}] ${message}`;
        console.info(line);
        appendOrchestrationLog(line);
      },
      // section 6：按 agent 声明装配上下文。无事实库时返回 null（图降级为不召回）。
      assembleContext: async (agentId: string, state: NovelState) => {
        if (factStore === undefined) return null;
        const request = this.#assemblyRequest(agentId, assembly);
        return assembleContext(factStore, state, request);
      },
      // section 7：事实库硬检查（章号纠偏+指令冲突）——reviewer 节点合并入 activeBugs。
      checkFacts: async (agentId: string, _state: NovelState) =>
        this.#checkFacts(agentId, assembly),
      ...(assembly.autoExtractFacts
        ? {
            afterWriterDraft: async (state: NovelState): Promise<void> => {
              await this.#autoExtractAfterWriter(run, resolver, state);
            },
          }
        : {}),
      recordMilestone: async (atNode: string, state: NovelState): Promise<void> => {
        // 里程碑态 checkpoint（design D3.5）：持久化进 SqliteCheckpointer，沿 parent 链成史。
        if (checkpointer === undefined) return; // 无持久化则跳过里程碑（happy path 仍可跑）
        const cp = await checkpointer.commit(atNode, state, run.parent);
        run.parent = cp.id;
      },
    };
  }

  /** 把运行的组装基座投影为 AssemblyRequest（关键词→FactRetrievalQuery）。 */
  #assemblyRequest(agentId: string, base: RunAssemblyBase): AssemblyRequest {
    const keywords = keywordsToQuery(base.keywords);
    return {
      agentId,
      scope: base.scope,
      ...(base.anchorNodeId !== undefined ? { anchorNodeId: base.anchorNodeId } : {}),
      ...(base.softChapterNodeId !== undefined
        ? { softChapterNodeId: base.softChapterNodeId }
        : {}),
      ...(keywords !== undefined ? { keywords } : {}),
    };
  }

  async #runFactExtractionPipeline(
    wc: WebContents,
    runId: RunId,
    input: ExtractionInput,
    resolver: ModelResolver,
    factStore: SqliteFactStore,
    signal: AbortSignal,
    progress?: { index: number; total: number },
  ): Promise<void> {
    const chapterId = input.location.id as string;
    const latestVersion = await factStore.getLatestVersion();
    const emptyView: FactView = {
      version: asFactVersionId('extraction-empty-view'),
      entities: [],
      timeline: { events: [] },
      relations: [],
      plotHooks: [],
    };
    const view = latestVersion === null ? emptyView : await factStore.getView(latestVersion);
    const extractor = new FactExtractor(resolver);
    const chunks = chunkExtractionInput(input);
    const extractedChunks: FactExtractionResult[] = [];
    const candidates: CandidateFact[] = [];

    for (const chunk of chunks) {
      if (signal.aborted) {
        this.#sendControl(wc, {
          type: 'fact-extraction-failed',
          runId,
          chapterId,
          error: { category: 'aborted', message: '事实抽取已中断' },
        });
        return;
      }
      const extracted = await extractor.extract(chunk, {
        signal,
        logger: (message) => appendOrchestrationLog(`[extraction:${runId}] ${message}`),
      });
      extractedChunks.push(extracted);
      candidates.push(...extracted.output.candidates);
    }

    if (signal.aborted) {
      this.#sendControl(wc, {
        type: 'fact-extraction-failed',
        runId,
        chapterId,
        error: { category: 'aborted', message: '事实抽取已中断' },
      });
      return;
    }

    const initialNormalized = normalizeCandidateFacts(candidates, view);
    const batchEntities = initialNormalized.facts.flatMap((fact) =>
      fact.kind === 'entity' && !view.entities.some((entity) => entity.id === fact.entity.id)
        ? [fact.entity]
        : [],
    );
    const normalizationView: FactView =
      batchEntities.length === 0
        ? view
        : { ...view, entities: [...view.entities, ...batchEntities] };
    const normalized = normalizeCandidateFacts(candidates, normalizationView);
    const plan = buildIngestPlan(normalized.facts, view, normalized.skipped);
    const applied = await applyIngestPlan(factStore, plan, view);
    const rawChars = extractedChunks.reduce((sum, item) => sum + item.diagnostics.rawChars, 0);
    const candidateObjects = extractedChunks.reduce((sum, item) => sum + item.diagnostics.candidateObjects, 0);
    const validCandidates = extractedChunks.reduce((sum, item) => sum + item.diagnostics.validCandidates, 0);
    const invalidCandidates = extractedChunks.reduce((sum, item) => sum + item.diagnostics.invalidCandidates, 0);
    const parseSource = extractedChunks.some((item) => item.diagnostics.source === 'candidate-salvage')
      ? 'candidate-salvage'
      : extractedChunks.every((item) => item.diagnostics.source === 'none')
        ? 'none'
        : 'json-object';

    this.#sendControl(wc, {
      type: 'fact-extraction-completed',
      runId,
      chapterId,
      rawChars,
      parseSource,
      candidateObjects,
      validCandidates,
      invalidCandidates,
      autoIngested: plan.diagnostics.autoIngest,
      conflicts: plan.diagnostics.conflicts,
      skipped: plan.diagnostics.skipped,
      factVersion: applied.version as string,
      chunks: chunks.length,
      ...(progress !== undefined ? progress : {}),
    });
    if (plan.conflicts.length > 0) {
      this.#pendingExtractionConflicts.set(runId, {
        wc,
        chapterId,
        conflicts: plan.conflicts,
      });
      this.#sendControl(wc, {
        type: 'interrupt-raised',
        runId,
        issues: plan.conflicts.map((conflict) => toIssueDto(conflict.issue)),
      });
    }
  }

  async #autoExtractAfterWriter(
    run: ActiveRun,
    resolver: ModelResolver,
    state: NovelState,
  ): Promise<void> {
    const factStore = this.#deps.getFactStore();
    const location = state.currentChapterId;
    if (factStore === undefined || location === null || state.currentDraft.trim().length === 0) return;
    this.#sendControl(run.wc, {
      type: 'fact-extraction-started',
      runId: run.threadId,
      chapterId: location.id as string,
      textChars: state.currentDraft.length,
    });
    await this.#runFactExtractionPipeline(
      run.wc,
      run.threadId,
      { location, text: state.currentDraft },
      resolver,
      factStore,
      run.controller.signal,
    );
  }

  /**
   * 事实库硬检查（section 7）：章号纠偏（软提示与真实出处不一致）+ 指令冲突（首次登场撞既有事实）。
   * 无事实库/版本时返回空。纯读取，不写库。
   */
  async #checkFacts(
    _agentId: string,
    base: RunAssemblyBase,
  ): Promise<ReadonlyArray<ConsistencyIssue>> {
    const factStore = this.#deps.getFactStore();
    if (factStore === undefined) return [];
    const version = await factStore.getLatestVersion();
    if (version === null) return [];
    const view = await factStore.getView(version);
    const query = keywordsToQuery(base.keywords) ?? {};
    const hits = retrieveFacts(view, query);

    const issues: ConsistencyIssue[] = [];
    // 章号纠偏（task 7.3）：仅当作者给了软章号且与真实出处不一致时产出候选。
    if (base.softChapterNodeId !== undefined && base.softChapterNodeId.length > 0) {
      issues.push(...buildCorrectionIssues(hits, base.softChapterNodeId));
    }
    // 指令冲突硬阻断（task 7.4）：指令声称首次登场但实体已有出处。
    issues.push(...detectInstructionConflicts(hits, base.instruction));
    return issues;
  }

  /** 组装召唤的初始状态：作者指令进 chatHistory，被召唤 agent / 模式定 currentAction，锚点入 currentChapterId。 */
  #initialState(params: SummonParams): Partial<NovelState> {
    const instruction = params.instruction ?? '请依据上下文给出你的处理。';
    // 优先按被召唤的专家 agent 推导动作（如 fact-checker→fact-check），使 supervisor 能路由到该节点；
    // agent 无专属动作时回退按 mode 推导（diagnose→review 只审不写 / mutate→write 先写后审）。
    const agentAction = params.agent !== undefined ? actionForAgent(params.agent) : undefined;
    const currentAction = agentAction ?? (params.mode === 'diagnose' ? 'review' : 'write');
    const state: Partial<NovelState> = {
      chatHistory: [{ role: 'user', content: instruction, author: 'author' }],
      ...(params.initialDraft !== undefined ? { currentDraft: params.initialDraft } : {}),
      currentAction,
      agentStatus: 'idle',
    };
    if (params.anchorNodeId !== undefined && params.anchorNodeId.length > 0) {
      state.currentChapterId = { id: asNodeId(params.anchorNodeId), kind: 'chapter' };
    }
    return state;
  }

  /**
   * 召唤一次运行：向长驻图注入初始命令并驱动到完成或挂起（task 3.1）。
   * 返回后若图处于挂起态（等待作者裁决），resume 走 {@link resume}。
   */
  async summon(wc: WebContents, params: SummonParams): Promise<void> {
    const { runId } = params;
    const resolver = this.#deps.getModelResolver();
    if (resolver === undefined) {
      this.#send(wc, {
        type: 'stream-error',
        runId,
        kind: 'dialogue',
        error: { category: 'io', message: '模型配置未就绪：请检查 config/models.json' },
      });
      return;
    }

    const run: ActiveRun = {
      controller: new AbortController(),
      wc,
      threadId: runId,
      assembly: assemblyBaseFrom(params),
      seq: 0,
      parent: null,
    };
    this.#runs.set(runId, run);
    this.#send(wc, { type: 'stream-start', runId, kind: 'dialogue' });

    await this.#drive(run, resolver, this.#initialState(params));
  }

  /**
   * 恢复被挂起的运行，携带作者决策（task 4.3–4.5）。
   * 以 Command({resume}) 从挂起点续跑：modify/correct 回 writer，approve/reject 终止。
   */
  async resume(wc: WebContents, runId: RunId, decision: ResumeDecision): Promise<void> {
    // decision 跨 IPC 到达时为不可信输入：校验判别形状后方可续跑，非法决策以 stream-error 拒绝，
    // 避免让未知 kind 穿透到图 awaitDecision 的穷尽 switch（无 default 分支会静默返回 undefined）。
    if (!isValidResumeDecision(decision)) {
      this.#send(wc, {
        type: 'stream-error',
        runId,
        kind: 'dialogue',
        error: { category: 'validation', message: '恢复决策非法：无法识别的作者裁决' },
      });
      return;
    }
    if (await this.#resumeExtractionConflict(wc, runId, decision)) return;
    const resolver = this.#deps.getModelResolver();
    if (resolver === undefined) {
      this.#send(wc, {
        type: 'stream-error',
        runId,
        kind: 'dialogue',
        error: { category: 'io', message: '模型配置未就绪：无法恢复运行' },
      });
      return;
    }
    // 复用既有账本（保 thread/parent 游标连续 + 组装基座）；若已丢失（如重启）则新建一条同 thread 账本。
    const existing = this.#runs.get(runId);
    const run: ActiveRun = existing ?? {
      controller: new AbortController(),
      wc,
      threadId: runId,
      assembly: DEFAULT_ASSEMBLY_BASE,
      seq: 0,
      parent: null,
    };
    if (existing === undefined) this.#runs.set(runId, run);

    await this.#drive(run, resolver, new Command({ resume: decision }));
  }

  /**
   * 从历史 checkpoint 重开运行（time-travel task 5.2）。
   * 加载指定 checkpoint 的 NovelState 快照，作为新分支的初始状态注入图。
   * 新运行产生的 milestone checkpoint 挂在选定 checkpoint 之下（parent=选定 id），
   * MUST NOT 破坏既有 checkpoint 链。
   *
   * 新 runId 保证新 thread_id → MemorySaver 空白干净态，避免旧运行态干扰。
   */
  async restartFromCheckpoint(wc: WebContents, params: RestartParams): Promise<void> {
    const { checkpointId, instruction } = params;
    const runId = randomUUID(); // 新分支用新 runId
    const resolver = this.#deps.getModelResolver();
    if (resolver === undefined) {
      this.#send(wc, {
        type: 'stream-error',
        runId,
        kind: 'dialogue',
        error: { category: 'io', message: '模型配置未就绪：无法从 checkpoint 重启' },
      });
      return;
    }
    const checkpointer = this.#deps.getCheckpointer();
    if (checkpointer === undefined) {
      this.#send(wc, {
        type: 'stream-error',
        runId,
        kind: 'dialogue',
        error: { category: 'io', message: '持久化未就绪：无法从 checkpoint 重启' },
      });
      return;
    }

    const cpId = asCheckpointId(checkpointId);
    const cp: Checkpoint | null = await checkpointer.get(cpId);
    if (cp === null) {
      this.#send(wc, {
        type: 'stream-error',
        runId,
        kind: 'dialogue',
        error: {
          category: 'validation',
          message: `checkpoint ${checkpointId} 不存在`,
        },
      });
      return;
    }

    // 以 checkpoint 快照为初始状态，可选追加作者新指令。
    const baseState: Partial<NovelState> = { ...cp.state };
    if (instruction !== undefined && instruction.length > 0) {
      baseState.chatHistory = [
        ...(cp.state.chatHistory ?? []),
        { role: 'user' as const, content: instruction, author: 'author' },
      ];
      // 带新指令从 checkpoint 重开时，应显式启动写作分支；否则若 checkpoint 是 idle 快照，supervisor 会直接 END。
      baseState.currentAction = 'write';
      baseState.agentStatus = 'idle';
    }

    const run: ActiveRun = {
      controller: new AbortController(),
      wc,
      threadId: runId,
      // restart 无原始 summon 参数，用默认基座（不召回/不硬检查），沿 checkpoint 快照续跑。
      assembly: DEFAULT_ASSEMBLY_BASE,
      seq: 0,
      parent: cp.id, // 新里程碑挂到选定 checkpoint 下（分支）
    };
    this.#runs.set(runId, run);
    this.#send(wc, { type: 'stream-start', runId, kind: 'dialogue' });

    await this.#drive(run, resolver, baseState);
  }

  /** 显式抽取章节事实：Main 侧读入的正文进入 extractor → normalizer → ingest plan → writer。 */
  async extractFacts(wc: WebContents, runId: RunId, input: ExtractionInput): Promise<void> {
    const resolver = this.#deps.getModelResolver();
    const factStore = this.#deps.getFactStore();
    const chapterId = input.location.id as string;
    if (resolver === undefined) {
      this.#sendControl(wc, {
        type: 'fact-extraction-failed',
        runId,
        chapterId,
        error: { category: 'io', message: '模型配置未就绪：请检查 config/models.json' },
      });
      return;
    }
    if (factStore === undefined) {
      this.#sendControl(wc, {
        type: 'fact-extraction-failed',
        runId,
        chapterId,
        error: { category: 'io', message: '事实库未就绪：无法写入抽取结果' },
      });
      return;
    }

    const run = this.#startUtilityRun(wc, runId);
    this.#sendControl(wc, {
      type: 'fact-extraction-started',
      runId,
      chapterId,
      textChars: input.text.length,
    });

    try {
      await this.#runFactExtractionPipeline(
        wc,
        runId,
        input,
        resolver,
        factStore,
        run.controller.signal,
      );
    } catch (err) {
      this.#sendControl(wc, {
        type: 'fact-extraction-failed',
        runId,
        chapterId,
        error: {
          category: run.controller.signal.aborted ? 'aborted' : 'model',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      if (!this.#pendingExtractionConflicts.has(runId)) this.#runs.delete(runId);
    }
  }

  async confirmStoryBibleFact(
    wc: WebContents,
    runId: RunId,
    target: StoryBibleFactLocatorDto,
  ): Promise<void> {
    const factStore = this.#deps.getFactStore();
    if (factStore === undefined) {
      this.#sendControl(wc, {
        type: 'story-bible-fact-confirmation-failed',
        runId,
        target,
        error: { category: 'io', message: '事实库未就绪：无法确认事实' },
      });
      return;
    }

    try {
      const version = await factStore.confirmFact(target);
      this.#sendControl(wc, {
        type: 'story-bible-fact-confirmed',
        runId,
        target,
        factVersion: version as string,
        status: 'confirmed',
      });
    } catch (err) {
      this.#sendControl(wc, {
        type: 'story-bible-fact-confirmation-failed',
        runId,
        target,
        error: {
          category: err instanceof Error ? 'validation' : 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  async editStoryBibleFact(
    wc: WebContents,
    runId: RunId,
    edit: StoryBibleFactEditDto,
  ): Promise<void> {
    const factStore = this.#deps.getFactStore();
    if (factStore === undefined) {
      this.#sendControl(wc, {
        type: 'story-bible-fact-edit-failed',
        runId,
        edit,
        error: { category: 'io', message: '事实库未就绪：无法编辑事实' },
      });
      return;
    }

    try {
      const version = await factStore.editFact(edit);
      this.#sendControl(wc, {
        type: 'story-bible-fact-edited',
        runId,
        edit,
        factVersion: version as string,
        status: 'confirmed',
      });
    } catch (err) {
      this.#sendControl(wc, {
        type: 'story-bible-fact-edit-failed',
        runId,
        edit,
        error: {
          category: err instanceof Error ? 'validation' : 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  async deleteStoryBibleFact(
    wc: WebContents,
    runId: RunId,
    target: StoryBibleFactDeleteLocatorDto,
  ): Promise<void> {
    const factStore = this.#deps.getFactStore();
    if (factStore === undefined) {
      this.#sendControl(wc, {
        type: 'story-bible-fact-delete-failed',
        runId,
        target,
        error: { category: 'io', message: '事实库未就绪：无法删除事实' },
      });
      return;
    }

    try {
      const version = await factStore.deleteFact(target);
      this.#sendControl(wc, {
        type: 'story-bible-fact-deleted',
        runId,
        target,
        factVersion: version as string,
      });
    } catch (err) {
      this.#sendControl(wc, {
        type: 'story-bible-fact-delete-failed',
        runId,
        target,
        error: {
          category: err instanceof Error ? 'validation' : 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  async mergeStoryBibleEntities(
    wc: WebContents,
    runId: RunId,
    sourceEntityId: string,
    targetEntityId: string,
  ): Promise<void> {
    const factStore = this.#deps.getFactStore();
    if (factStore === undefined) {
      this.#sendControl(wc, {
        type: 'story-bible-entities-merge-failed',
        runId,
        sourceEntityId,
        targetEntityId,
        error: { category: 'io', message: '事实库未就绪：无法合并实体' },
      });
      return;
    }

    try {
      const version = await factStore.mergeEntities(sourceEntityId, targetEntityId);
      this.#sendControl(wc, {
        type: 'story-bible-entities-merged',
        runId,
        sourceEntityId,
        targetEntityId,
        factVersion: version as string,
      });
    } catch (err) {
      this.#sendControl(wc, {
        type: 'story-bible-entities-merge-failed',
        runId,
        sourceEntityId,
        targetEntityId,
        error: {
          category: err instanceof Error ? 'validation' : 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  async runGlobalAudit(wc: WebContents, runId: RunId): Promise<void> {
    const factStore = this.#deps.getFactStore();
    if (factStore === undefined) {
      this.#sendControl(wc, {
        type: 'global-audit-failed',
        runId,
        error: { category: 'io', message: '事实库未就绪：无法运行全书总检' },
      });
      return;
    }

    const run = this.#startUtilityRun(wc, runId);
    try {
      const version = await factStore.getLatestVersion();
      if (version === null) {
        this.#sendControl(wc, {
          type: 'global-audit-failed',
          runId,
          error: { category: 'validation', message: 'Story Bible 为空：请先抽取章节事实再运行全书总检' },
        });
        return;
      }

      const view = await factStore.getView(version);
      const totalItems = countAuditableItems(view);
      this.#sendControl(wc, {
        type: 'global-audit-started',
        runId,
        factVersion: version as string,
        totalItems,
      });

      if (run.controller.signal.aborted) {
        this.#sendControl(wc, {
          type: 'global-audit-failed',
          runId,
          error: { category: 'aborted', message: '全书总检已中断' },
        });
        return;
      }
      this.#sendControl(wc, {
        type: 'global-audit-progress',
        runId,
        phase: 'map',
        completedItems: totalItems,
        totalItems,
      });

      if (run.controller.signal.aborted) {
        this.#sendControl(wc, {
          type: 'global-audit-failed',
          runId,
          error: { category: 'aborted', message: '全书总检已中断' },
        });
        return;
      }
      const runner = this.#deps.getAuditRunner?.() ?? new InlineAuditRunner();
      const result = await runner.run(view, run.controller.signal);
      this.#sendControl(wc, {
        type: 'global-audit-progress',
        runId,
        phase: 'reduce',
        completedItems: totalItems,
        totalItems,
      });
      this.#sendControl(wc, {
        type: 'global-audit-progress',
        runId,
        phase: 'score',
        completedItems: totalItems,
        totalItems,
      });
      this.#sendControl(wc, {
        type: 'global-audit-completed',
        runId,
        dashboard: {
          factVersion: result.factVersion,
          generatedAt: result.generatedAt,
          healthScore: result.healthScore,
          scoreExplanation: result.scoreExplanation,
          totalItems: result.totalItems,
          issues: result.issues.map(toIssueDto),
        },
      });
    } catch (err) {
      const aborted = err instanceof AuditAbortedError || run.controller.signal.aborted;
      this.#sendControl(wc, {
        type: 'global-audit-failed',
        runId,
        error: {
          category: aborted ? 'aborted' : 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      this.#runs.delete(runId);
    }
  }

  /**
   * 计算一次局部重构 diff (I6 refactor-worker-runtime)。
   * Main 据锚点从磁盘正文裁出原片段（carveFragment）→ 经可注入 DiffRunner 派发（默认
   * utilityProcess，fork 不可用回退内联）计算最小差异 + hunk 拆分 → 经 refactor-diff-* 控制事件下发。
   * diff 属 CPU 密集，在 worker 算；Main 不阻塞。
   */
  async computeRefactorDiff(
    wc: WebContents,
    runId: RunId,
    anchor: FragmentAnchor,
    rewrittenFragment: string,
  ): Promise<void> {
    const run = this.#startUtilityRun(wc, runId);
    try {
      const chapter = await readChapterContent(anchor.node.id);
      const fragment = carveFragment(chapter.content, anchor);
      if (fragment === null) {
        this.#sendControl(wc, {
          type: 'refactor-diff-failed',
          runId,
          error: { category: 'validation', message: '片段锚点越界或非法：无法裁出待修片段' },
        });
        return;
      }
      const runner = this.#deps.getDiffRunner?.() ?? new InlineDiffRunner();
      const result = await runner.run(fragment, rewrittenFragment, run.controller.signal);
      this.#sendControl(wc, {
        type: 'refactor-diff-computed',
        runId,
        anchor: { id: anchor.node.id, kind: anchor.node.kind },
        originalFragment: fragment.text,
        rewrittenFragment: result.rewrittenFragment,
        hunks: result.hunks.map((h) => ({
          id: h.id,
          fragmentFrom: h.fragmentFrom,
          fragmentTo: h.fragmentTo,
          original: h.original,
          rewritten: h.rewritten,
        })),
      });
    } catch (err) {
      const aborted = err instanceof DiffAbortedError || run.controller.signal.aborted;
      this.#sendControl(wc, {
        type: 'refactor-diff-failed',
        runId,
        error: {
          category: aborted ? 'aborted' : 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      this.#runs.delete(runId);
    }
  }

  /**
   * 运行一次素材语义检索 (I7 corpus-worker-runtime)。
   * Main 据作用域从存储取素材快照 → 经可注入 EmbedRunner 派发查询 embedding（默认
   * utilityProcess，fork 不可用回退内联）→ 以余弦相似度排序 + 过滤 + 截断 → 经 corpus-retrieval-* 下发。
   * embedding 属 CPU 密集，在 worker 算；Main 不阻断。素材为弱参考，不写事实库、不入一致性检查。
   */
  async retrieveCorpus(wc: WebContents, runId: RunId, query: CorpusQuery): Promise<void> {
    const run = this.#startUtilityRun(wc, runId);
    this.#sendControl(wc, {
      type: 'corpus-retrieval-started',
      runId,
      query: query.query,
    });
    try {
      const store = this.#deps.getCorpusStore?.();
      const items = store !== undefined ? await store.snapshot(query.scope) : [];
      const runner = this.#deps.getEmbedRunner?.() ?? new InlineEmbedRunner();
      const vectors = await runner.run([query.query], run.controller.signal);
      const queryVector = vectors[0] ?? [];
      const result = rankCorpusHits(queryVector, items, query);
      this.#sendControl(wc, {
        type: 'corpus-retrieval-completed',
        runId,
        hits: result.hits.map(toCorpusHitDto),
      });
    } catch (err) {
      const aborted = err instanceof EmbedAbortedError || run.controller.signal.aborted;
      this.#sendControl(wc, {
        type: 'corpus-retrieval-failed',
        runId,
        error: {
          category: aborted ? 'aborted' : 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      this.#runs.delete(runId);
    }
  }

  /**
   * 提交逐 hunk 裁决：拼回→写盘→提交可回滚 checkpoint (I6 refactor-worker-runtime)。
   *
   * spec「逐 hunk 裁决经纯函数拼回并写回磁盘正文」「变更作为可回滚步」：
   * 确定性重算 DiffResult（与 compute 同输入）→ spliceAcceptedHunks 纯函数仅拼接接受项 →
   * 仅替换锚点区间写回磁盘（绝不整章覆盖） → 变更作为可回滚步提交 checkpointer。
   */
  async applyHunkDecisions(
    wc: WebContents,
    runId: RunId,
    anchor: FragmentAnchor,
    rewrittenFragment: string,
    decisions: ReadonlyArray<HunkDecision>,
  ): Promise<void> {
    try {
      const chapter = await readChapterContent(anchor.node.id);
      const fragment = carveFragment(chapter.content, anchor);
      if (fragment === null) {
        this.#sendControl(wc, {
          type: 'refactor-apply-failed',
          runId,
          error: { category: 'validation', message: '片段锚点越界或非法：无法裁出待修片段' },
        });
        return;
      }
      // 确定性重算 DiffResult（无状态：同片段+同改写恒产同 hunk 序列），hunk 均有效。
      const diff = computeDiffResult(fragment, rewrittenFragment);
      const validity: Record<string, HunkValidity> = {};
      for (const h of diff.hunks) validity[h.id] = 'valid';

      const splice = spliceAcceptedHunks(diff, decisions, validity);
      if (!splice.ok) {
        this.#sendControl(wc, {
          type: 'refactor-apply-failed',
          runId,
          error: {
            category: 'validation',
            message: splice.reason === 'overlapping-hunks' ? '接受的 hunk 区间重叠，无法确定性拼回' : '存在失效 hunk，需重算',
          },
          hunkIds: splice.hunkIds,
        });
        return;
      }

      const writeback = await writeBackRefactoredFragment(anchor, splice.fragmentText);
      if (!writeback.ok) {
        this.#sendControl(wc, {
          type: 'refactor-apply-failed',
          runId,
          error: {
            category: writeback.reason === 'io-error' ? 'io' : 'validation',
            message: `正文写回失败：${writeback.reason ?? 'unknown'}`,
          },
        });
        return;
      }

      const acceptedHunkIds = decisions.filter((d) => d.decision === 'accept').map((d) => d.hunkId);

      // 变更作为可回滚步提交 checkpointer（与事实版本共用标识空间）。
      const checkpointer = this.#deps.getCheckpointer();
      let checkpointId: string | undefined;
      if (checkpointer !== undefined) {
        const state = this.#refactorCheckpointState(anchor.node.id, chapter.content, splice.fragmentText, anchor);
        const cp = await checkpointer.commit(`refactor:${anchor.node.id}`, state, null);
        checkpointId = cp.id as string;
      }

      this.#sendControl(wc, {
        type: 'refactor-applied',
        runId,
        nodeId: anchor.node.id,
        acceptedHunkIds,
        ...(checkpointId !== undefined ? { checkpointId } : {}),
      });
    } catch (err) {
      this.#sendControl(wc, {
        type: 'refactor-apply-failed',
        runId,
        error: {
          category: err instanceof DiffAbortedError ? 'aborted' : 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  /** 构造重构变更的 checkpoint 快照（以写回后整章正文为草稿，供 time-travel 回退）。 */
  #refactorCheckpointState(
    nodeId: string,
    originalContent: string,
    fragmentText: string,
    anchor: FragmentAnchor,
  ): NovelState {
    const nextContent =
      originalContent.slice(0, anchor.from) + fragmentText + originalContent.slice(anchor.to);
    return {
      currentChapterId: { id: asNodeId(nodeId), kind: anchor.node.kind },
      currentDraft: nextContent,
      chatHistory: [],
      activeBugs: [],
      currentAction: 'idle',
      agentStatus: 'idle',
      contextRefs: { facts: null, corpus: null },
    };
  }

  async backfillFacts(wc: WebContents, params: BackfillFactsParams): Promise<void> {
    const resolver = this.#deps.getModelResolver();
    const factStore = this.#deps.getFactStore();
    const firstChapterId = params.chapters[0]?.location.id as string | undefined;
    if (resolver === undefined) {
      this.#sendControl(wc, {
        type: 'fact-extraction-failed',
        runId: params.runId,
        ...(firstChapterId !== undefined ? { chapterId: firstChapterId } : {}),
        error: { category: 'io', message: '模型配置未就绪：请检查 config/models.json' },
      });
      return;
    }
    if (factStore === undefined) {
      this.#sendControl(wc, {
        type: 'fact-extraction-failed',
        runId: params.runId,
        ...(firstChapterId !== undefined ? { chapterId: firstChapterId } : {}),
        error: { category: 'io', message: '事实库未就绪：无法写入抽取结果' },
      });
      return;
    }
    if (params.chapters.length === 0) {
      this.#sendControl(wc, {
        type: 'fact-extraction-failed',
        runId: params.runId,
        error: { category: 'validation', message: '补抽章节列表为空' },
      });
      return;
    }

    const run = this.#startUtilityRun(wc, params.runId);
    try {
      for (const [offset, chapter] of params.chapters.entries()) {
        const chapterId = chapter.location.id as string;
        if (run.controller.signal.aborted) {
          this.#sendControl(wc, {
            type: 'fact-extraction-failed',
            runId: params.runId,
            chapterId,
            error: { category: 'aborted', message: '事实补抽已中断' },
          });
          return;
        }
        this.#sendControl(wc, {
          type: 'fact-extraction-started',
          runId: params.runId,
          chapterId,
          textChars: chapter.text.length,
          index: offset + 1,
          total: params.chapters.length,
        });
        await this.#runFactExtractionPipeline(
          wc,
          params.runId,
          chapter,
          resolver,
          factStore,
          run.controller.signal,
          { index: offset + 1, total: params.chapters.length },
        );
        if (this.#pendingExtractionConflicts.has(params.runId)) return;
      }
    } catch (err) {
      this.#sendControl(wc, {
        type: 'fact-extraction-failed',
        runId: params.runId,
        ...(firstChapterId !== undefined ? { chapterId: firstChapterId } : {}),
        error: {
          category: run.controller.signal.aborted ? 'aborted' : 'model',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      if (!this.#pendingExtractionConflicts.has(params.runId)) this.#runs.delete(params.runId);
    }
  }

  async #resumeExtractionConflict(
     wc: WebContents,
     runId: RunId,
     decision: ResumeDecision,
   ): Promise<boolean> {
     const pending = this.#pendingExtractionConflicts.get(runId);
     if (pending === undefined) return false;
     const factStore = this.#deps.getFactStore();
     if (factStore === undefined) {
       this.#sendControl(wc, {
         type: 'fact-extraction-failed',
         runId,
         chapterId: pending.chapterId,
         error: { category: 'io', message: '事实库未就绪：无法处理抽取冲突裁决' },
       });
       return true;
     }

     const optionId = decision.kind === 'correct' ? decision.optionId : decision.kind;
     if (optionId === 'accept-new') {
       const latestVersion = await factStore.getLatestVersion();
       const view: FactView = latestVersion === null
         ? {
             version: asFactVersionId('extraction-conflict-empty-view'),
             entities: [],
             timeline: { events: [] },
             relations: [],
             plotHooks: [],
           }
         : await factStore.getView(latestVersion);
       const conflictPlan: IngestPlan = {
         autoIngest: pending.conflicts.map((conflict) => ({
           operation: 'update',
           fact: conflict.fact,
           reason: '作者裁决接受抽取冲突新事实',
         })),
         conflicts: [],
         skipped: [],
         diagnostics: {
           autoIngest: pending.conflicts.length,
           conflicts: 0,
           skipped: 0,
         },
       };
       const applied = await applyIngestPlan(factStore, conflictPlan, view);
       this.#sendControl(wc, {
         type: 'fact-extraction-completed',
         runId,
         chapterId: pending.chapterId,
         rawChars: 0,
         parseSource: 'json-object',
         candidateObjects: pending.conflicts.length,
         validCandidates: pending.conflicts.length,
         invalidCandidates: 0,
         autoIngested: pending.conflicts.length,
         conflicts: 0,
         skipped: 0,
         factVersion: applied.version as string,
       });
     } else if (optionId === 'keep-existing' || optionId === 'ignore-candidate' || decision.kind === 'reject') {
       this.#sendControl(wc, {
         type: 'fact-extraction-completed',
         runId,
         chapterId: pending.chapterId,
         rawChars: 0,
         parseSource: 'json-object',
         candidateObjects: pending.conflicts.length,
         validCandidates: pending.conflicts.length,
         invalidCandidates: 0,
         autoIngested: 0,
         conflicts: 0,
         skipped: pending.conflicts.length,
       });
     } else {
       this.#sendControl(wc, {
         type: 'fact-extraction-failed',
         runId,
         chapterId: pending.chapterId,
         error: { category: 'validation', message: `暂不支持的抽取冲突裁决：${optionId}` },
       });
       return true;
     }

     this.#pendingExtractionConflicts.delete(runId);
     this.#runs.delete(runId);
     return true;
   }

   /** 取 checkpoint 历史链 DTO（time-travel task 5.1）。
   * checkpointId 可空：为空时取最近一次 checkpoint 为起点。
   * 返回沿 parent 链回溯的摘要列表，供 Renderer 呈现 time-travel 面板。
   */
  async getCheckpointHistory(checkpointId?: string): Promise<CheckpointHistoryDto> {
    const checkpointer = this.#deps.getCheckpointer();
    if (checkpointer === undefined) return { checkpoints: [] };

    let fromId: CheckpointId;
    if (checkpointId !== undefined && checkpointId.length > 0) {
      fromId = asCheckpointId(checkpointId);
    } else {
      const latest = await checkpointer.getLatest();
      if (latest === null) return { checkpoints: [] };
      fromId = latest.id;
    }

    const chain = await checkpointer.history(fromId);
    return {
      checkpoints: chain.map(toCheckpointDto),
    };
  }

  /** 驱动图运行到完成或挂起，并收敛出 stream-end / stream-error（summon 与 resume 共用）。 */
  async #drive(
    run: ActiveRun,
    resolver: ModelResolver,
    input: Parameters<CompiledOrchestrationGraph['invoke']>[0],
  ): Promise<void> {
    const { threadId: runId, wc } = run;
    const runDeps = this.#buildRunDeps(run, resolver);
    const isReviewAgent = REVIEW_AGENTS.has(run.assembly.agent);
    try {
      const stream = await this.#graph.stream(input, {
        configurable: { thread_id: runId, deps: runDeps },
        signal: run.controller.signal,
        streamMode: ['tasks', 'values'],
      });
      let latestState: unknown;
      const interrupts: Array<{ value?: unknown }> = [];

      for await (const chunk of stream) {
        if (!Array.isArray(chunk) || chunk.length !== 2) continue;
        const [mode, payload] = chunk as [unknown, unknown];
        if (mode === 'values') {
          latestState = payload;
          continue;
        }
        if (mode !== 'tasks' || typeof payload !== 'object' || payload === null) continue;
        const task = payload as {
          name?: unknown;
          input?: unknown;
          result?: unknown;
          interrupts?: unknown;
        };
        if (typeof task.name !== 'string') continue;
        if (task.input !== undefined) {
          this.#sendControl(wc, { type: 'graph-node-activated', runId, node: task.name, phase: 'enter' });
        }
        if (Array.isArray(task.interrupts)) {
          interrupts.push(...task.interrupts as Array<{ value?: unknown }>);
        }
        if (task.result !== undefined) {
          this.#sendControl(wc, { type: 'graph-node-activated', runId, node: task.name, phase: 'exit' });
        }
      }

      const state = latestState as { [INTERRUPT]?: Array<{ value?: unknown }> } | undefined;
      const pending = [...interrupts, ...(state?.[INTERRUPT] ?? [])].flatMap(
        (interrupt) => (interrupt.value ?? []) as ReadonlyArray<ConsistencyIssue>,
      );
      if (pending.length > 0) {
        // 挂起等待作者裁决：dialogue 轴结束一段，待裁决问题经 control-event 推强类型报告。
        this.#send(wc, { type: 'stream-end', runId, kind: 'dialogue', reason: 'completed' });
        if (isReviewAgent) {
          this.#sendControl(wc, {
            type: 'review-completed',
            runId,
            agent: run.assembly.agent,
            issues: pending.map(toIssueDto),
          });
        }
        this.#sendControl(wc, { type: 'interrupt-raised', runId, issues: pending.map(toIssueDto) });
        return;
      }
      this.#send(wc, { type: 'stream-end', runId, kind: 'dialogue', reason: 'completed' });
      // 审校类运行正常完成：若产出非空 activeBugs，经 control-event 下发结构化卡片清单。
      if (isReviewAgent) {
        const bugs = (latestState as { activeBugs?: ReadonlyArray<ConsistencyIssue> } | undefined)?.activeBugs ?? [];
        if (bugs.length > 0) {
          this.#sendControl(wc, {
            type: 'review-completed',
            runId,
            agent: run.assembly.agent,
            issues: bugs.map(toIssueDto),
          });
        }
      }
      this.#runs.delete(runId);
    } catch (err) {
      if (run.controller.signal.aborted) {
        this.#send(wc, { type: 'stream-end', runId, kind: 'dialogue', reason: 'aborted' });
      } else {
        this.#send(wc, {
          type: 'stream-error',
          runId,
          kind: 'dialogue',
          error: { category: 'model', message: err instanceof Error ? err.message : String(err) },
        });
      }
      this.#runs.delete(runId);
    }
  }
}

/**
 * 校验跨 IPC 到达的作者恢复决策判别形状（resume-run 的 Main 侧信任边界）。
 * 受支持：approve / reject / correct(optionId:string) / modify(issues:array)。
 * 不深入校验 modify.issues 内元（由图节点 validateConsistencyIssues 收窄）与 correct.optionId 取值
 *（由 resume 分支自行处理未知 optionId），仅保证 kind 合法且必需字段类型正确。
 */
function isValidResumeDecision(decision: ResumeDecision): boolean {
  if (typeof decision !== 'object' || decision === null) return false;
  switch ((decision as { kind?: unknown }).kind) {
    case 'approve':
    case 'reject':
      return true;
    case 'correct':
      return typeof (decision as { optionId?: unknown }).optionId === 'string';
    case 'modify':
      return Array.isArray((decision as { issues?: unknown }).issues);
    default:
      return false;
  }
}

/**
 * 把 core `ConsistencyIssue` 投影为可序列化 DTO（NodeRef.id 去 brand 为 string）。
 * shared/ 不依赖 core/，故跨 IPC 只传结构同构的普通对象。
 */
function toIssueDto(issue: ConsistencyIssue): ConsistencyIssueDto {
  return {
    type: issue.type,
    severity: issue.severity,
    anchors: issue.anchors.map((a) => ({ id: a.id as string, kind: a.kind })),
    description: issue.description,
    requiresHumanDecision: issue.requiresHumanDecision,
    ...(issue.suggestedFix !== undefined ? { suggestedFix: issue.suggestedFix } : {}),
    ...(issue.evidence !== undefined ? { evidence: issue.evidence } : {}),
    ...(issue.options !== undefined
      ? { options: issue.options.map((o) => ({ id: o.id, label: o.label })) }
      : {}),
  };
}

/**
 * 把 core `CorpusHit` 投影为可序列化 DTO（I7）。
 * id/type 去 brand 为 string；source 可空时用 spread 守卫 exactOptionalPropertyTypes。
 */
function toCorpusHitDto(hit: CorpusHit): CorpusHitDto {
  const { item } = hit;
  const source =
    item.source !== undefined
      ? {
          kind: item.source.kind as string,
          label: item.source.label,
          ...(item.source.locator !== undefined ? { locator: item.source.locator } : {}),
        }
      : undefined;
  return {
    item: {
      id: item.id as string,
      type: item.type as string,
      content: item.content,
      tags: item.tags,
      ...(source !== undefined ? { source } : {}),
    },
    score: hit.score,
  };
}

/**
 * 把 core `Checkpoint` 投影为可序列化摘要 DTO。
 * 只传呈现字段（不传完整 NovelState），供 Renderer time-travel 面板渲染。
 */
function toCheckpointDto(cp: Checkpoint): CheckpointDto {
  // 摘要取 chatHistory 最后一条 user/assistant 消息的前 80 字。
  let summary = '';
  const chat = cp.state.chatHistory;
  if (chat !== undefined && chat.length > 0) {
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i];
      if (msg !== undefined && (msg.role === 'user' || msg.role === 'assistant')) {
        summary = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content;
        break;
      }
    }
  }
  return {
    id: cp.id as string,
    parent: cp.parent === null ? null : (cp.parent as string),
    atNode: cp.atNode,
    summary,
    createdAt: cp.createdAt,
  };
}
