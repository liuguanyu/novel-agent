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

import { createHash, randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { Command, INTERRUPT } from '@langchain/langgraph';
import {
  IPC_CHANNELS,
  type BackendControlEvent,
  type BackendModelTaskEvent,
  type BackendStreamMessage,
  type ModelTaskActivityPhase,
  type ModelTaskConflictCandidateDto,
  type ModelTaskDisplayMetadata,
  type ModelTaskRefDto,
  type ModelTaskSupplementDto,
  type CheckpointDto,
  type CheckpointHistoryDto,
  type ConsistencyIssueDto,
  type CorpusHitDto,
  type RunId,
  type StoryBibleFactDeleteLocatorDto,
  type StoryBibleFactEditDto,
  type StoryBibleFactLocatorDto,
  type BackendTaskActivityEvent,
  type TaskActivityEvent,
  type TaskArtifactRefDto,
  type TaskHeartbeatDto,
  type TaskModelAuditDto,
  type TaskRunCompletedEvent,
  type TaskRunFailedEvent,
  type TaskRunRefDto,
  type TaskUiEffectDto,
} from '../../shared/ipc/index.js';
import type { ResumeDecision, WorkflowRefDto } from '../../shared/ipc/index.js';
import type { CapabilityTier } from '../../core/model/index.js';
import type { Checkpoint, CheckpointId, NovelState } from '../../core/orchestration/index.js';
import { actionForAgent } from '../../core/orchestration/index.js';
import {
  resolveContinuation,
  type ContinuationScope,
  type InterruptContinuationRecord,
  type WorkflowContinuation,
  buildLegacyRevisionDiagnosis,
  locateSourceEvidence,
  type WorkflowIssueRecord,
  type WorkflowRef,
  getBuiltinWorkflowTemplate,
  type WorkflowKind,
} from '../../core/workflow/index.js';
import type { CandidateFact, ConsistencyIssue, ExtractionInput, FactView } from '../../core/story-bible/index.js';
import {
  createTaskRunFromPlaybook,
  positionTaskRunAtStep,
  taskRunHasRequiredInputs,
  transitionTaskRun,
  type TaskPlaybook,
  type TaskRun,
  type TaskRunArtifact,
} from '../../core/task-runtime/index.js';
import { asCheckpointId, asFactVersionId } from '../../core/story-bible/index.js';
import { asNodeId } from '../../core/manuscript/node-id.js';
import type { ModelResolver } from '../model-resolver.js';
import { appendOrchestrationLog } from '../local-log.js';
import type { CreativeAssetRepository, SqliteCheckpointer, SqliteFactStore, TaskRunRepository, WorkflowIssueRepository, WorkflowRepository } from '../db/index.js';
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
import type { ChapterContentDto } from '../../shared/ipc/index.js';
import {
  createOrchestrationGraph,
  type CompiledOrchestrationGraph,
  type GraphRunDeps,
} from './graph.js';
import { parseReviewerIssuesWithDiagnostics } from './consistency-schema.js';

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
  workflowRef?: WorkflowRef;
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
  /** Lightweight ownership only; workflow history remains in the workflow service. */
  workflowRef?: WorkflowRef;
}

/** 从 checkpoint 重启的参数（time-travel task 5.2）。 */
export interface RestartParams {
  runId: RunId;
  /** 选定的历史 checkpoint id（MUST 存在） */
  checkpointId: string;
  /** 可选的作者新指令（为空时沿用 checkpoint 内 chatHistory 的上下文继续） */
  instruction?: string;
}

type TargetedVerificationAgent = 'reviewer' | 'fact-checker' | 'plagiarism-checker';

export function targetedVerificationAgentFor(issueType: string): TargetedVerificationAgent {
  const normalized = issueType.toLowerCase();
  if (normalized.includes('plagiarism') || normalized.includes('originality') || normalized.includes('similarity')) {
    return 'plagiarism-checker';
  }
  if (['naming-conflict', 'timeline-break', 'plot-hook-dangling', 'state-contradiction', 'spatial-inconsistency', 'attribute-conflict', 'fact-conflict'].includes(normalized)) {
    return 'fact-checker';
  }
  return 'reviewer';
}

export interface StageRunEvidenceRecorder {
  record(input: {
    readonly runId: RunId;
    readonly workflowRef: WorkflowRef;
    readonly status: 'started' | 'resumed' | 'completed' | 'failed' | 'interrupted';
    readonly evidence?: Readonly<Record<string, string>>;
    /** Required completion outcome when the current template stage has a quality gate. */
    readonly completion?: {
      readonly passed: boolean;
      readonly issueIds: ReadonlyArray<string>;
      readonly transition?: 'quality-failed' | 'issues-found';
    };
  }): Promise<void>;
}

/** Persistence boundary for durable interrupt continuation records. */
export interface ContinuationRecordService {
  save(record: InterruptContinuationRecord): Promise<void>;
  getByRunId(runId: RunId): Promise<InterruptContinuationRecord | null>;
  remove(interruptId: string): Promise<void>;
  resolveStageTarget?(workflowRef: WorkflowRef, targetTemplateStageId: string): Promise<string | null>;
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
  stageRunEvidence?: StageRunEvidenceRecorder;
  continuationRecords?: ContinuationRecordService;
  workflowIssues?: WorkflowIssueRepository;
  workflows?: WorkflowRepository;
  creativeAssets?: CreativeAssetRepository;
  taskRuns?: TaskRunRepository;
  /** 可注入正文 I/O，供隔离 E2E 使用；未注入时使用默认小说工作区。 */
  manuscript?: {
    readonly readChapterContent: (nodeId: string) => Promise<ChapterContentDto>;
    readonly writeBackRefactoredFragment: (anchor: FragmentAnchor, fragmentText: string) => Promise<{ ok: boolean; reason?: 'node-not-found' | 'anchor-out-of-range' | 'io-error'; newContentLength?: number }>;
  };
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
interface ModelTaskAttemptContext {
  readonly taskId: string;
  readonly attemptId: string;
  readonly kind: 'fact-extraction';
  readonly runId: RunId;
  readonly workflowRef?: WorkflowRef;
}

interface FactTaskRecord {
  readonly taskId: string;
  readonly wc: WebContents;
  readonly kind: 'chapter' | 'backfill';
  readonly inputs: ReadonlyArray<ExtractionInput>;
  readonly workflowRef?: WorkflowRef;
  currentAttempt: ModelTaskAttemptContext;
  currentOffset: number;
  supplement?: ModelTaskSupplementDto;
}

interface PendingExtractionConflictRun {
  readonly wc: WebContents;
  readonly chapterId: string;
  readonly conflicts: ReadonlyArray<IngestConflict>;
  readonly modelTask?: ModelTaskAttemptContext;
  readonly backfill?: {
    readonly chapters: ReadonlyArray<ExtractionInput>;
    readonly nextOffset: number;
  };
}

/** 一次运行的可变账本（seq/里程碑 parent 游标随节点推进而变）。 */
interface TaskRuntimeSession {
  run: TaskRun;
  ref: TaskRunRefDto;
  wc: WebContents;
  lastActivityAt: number;
  /** 当前活跃执行运行（在安全边界据此收敛 pause/cancel 而非只改 DB 状态）。 */
  execution?: ActiveRun;
  /** 作者请求的控制意图；在安全步骤边界据此收敛状态。 */
  requestedControl?: 'pause' | 'cancel';
  heartbeat?: ReturnType<typeof setInterval>;
  heartbeatState?: TaskHeartbeatDto;
}

interface ActiveRun {
  readonly controller: AbortController;
  readonly wc: WebContents;
  /** LangGraph 运行态 checkpoint 键（= runId，标识同一 thread 的挂起/续跑）。 */
  readonly threadId: string;
  /** 本次召唤的组装基座（供 assembleContext/checkFacts 闭包读）。 */
  readonly assembly: RunAssemblyBase;
  readonly workflowRef?: WorkflowRef;
  continuationTarget?: string;
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

/** 4.1 相关人物或事实底稿：单次定位最多附带的相关实体数，避免淹没作者。 */
const MAX_FACT_BACKING = 5;

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

/** 作者在安全边界主动中断任务（pause/cancel）时抛出，区别于真实失败。 */
class TaskControlAbort extends Error {
  readonly intent: 'pause' | 'cancel';
  constructor(intent: 'pause' | 'cancel') {
    super(intent === 'pause' ? '作者已暂停当前任务' : '作者已取消当前任务');
    this.name = 'TaskControlAbort';
    this.intent = intent;
  }
}

/** 把领域任务族映射到 IPC 任务种类；供通用引擎构造 TaskRunRefDto。 */
function ipcTaskKindFor(playbookId: string, kind: TaskRun['kind']): TaskRunRefDto['kind'] {
  if (playbookId === 'legacy.locate-source') return 'locate-source';
  if (kind === 'new-book') return 'new-book-planning';
  return 'temporary-task';
}

/**
 * 通用 playbook 执行引擎的上下文：执行器据此产出结构化产物或作者可读候选，
 * 但 MUST NOT 直接读写 DB/正文——真实模型/工具接入在后续 Phase 由注入的执行器完成。
 */
export interface PlaybookStepContext {
  readonly run: TaskRun;
  readonly stepId: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

/** 单个执行步骤的产出：作者可见产物引用与结构化输出（禁止隐藏思维链/整章正文）。 */
export interface PlaybookStepOutput {
  readonly message: string;
  readonly outputSummary?: string;
  readonly artifacts?: ReadonlyArray<{ readonly outputKey: string; readonly value: unknown; readonly ref: TaskArtifactRefDto }>;
  /** 可选：本步模型交互的可审计记录（仅白名单字段，Main 会再次白名单消毒后才下发）。 */
  readonly modelAudit?: TaskModelAuditDto;
}

/**
 * 模型审计白名单消毒（design 决策 5）：仅从已知字段重建 DTO，
 * 确保任何意外携带的 hidden CoT / 内部 prompt / 不可追溯解释字段都不会进入持久化活动或 Renderer。
 */
function sanitizeModelAudit(audit: TaskModelAuditDto): TaskModelAuditDto {
  return {
    goal: audit.goal,
    agent: audit.agent,
    tier: audit.tier,
    inputSummary: audit.inputSummary,
    outputSummary: audit.outputSummary,
    adoption: audit.adoption,
    ...(audit.contextRefs === undefined ? {} : { contextRefs: [...audit.contextRefs] }),
    ...(audit.constraints === undefined ? {} : { constraints: [...audit.constraints] }),
    ...(audit.structuredResult === undefined ? {} : { structuredResult: { ...audit.structuredResult } }),
    ...(audit.toolResults === undefined ? {} : { toolResults: [...audit.toolResults] }),
    ...(audit.validation === undefined ? {} : { validation: audit.validation }),
  };
}

/** 需要作者决策的步骤：先产出等待作者的提示，作者提交后再产出结果。 */
export interface PlaybookAuthorStep {
  readonly requiresAuthor: true;
  /** 进入等待作者态时的活动内容。 */
  readonly prompt: (ctx: PlaybookStepContext) => Promise<{ readonly message: string; readonly nextAction: string }>;
  /** 作者提交决策后据此产出结果。 */
  readonly apply: (ctx: PlaybookStepContext, decision: unknown) => Promise<PlaybookStepOutput>;
}

/** 纯执行步骤（不需要作者决策）。 */
export interface PlaybookAutoStep {
  readonly requiresAuthor?: false;
  readonly run: (ctx: PlaybookStepContext) => Promise<PlaybookStepOutput>;
}

export type PlaybookStepHandler = PlaybookAutoStep | PlaybookAuthorStep;

/** 一个可执行 playbook 的注册：声明 + 每步执行器 + 完成文案。 */
export interface PlaybookRegistration {
  readonly playbook: TaskPlaybook;
  readonly handlers: Readonly<Record<string, PlaybookStepHandler>>;
  readonly title: string;
  readonly completedSummary: string;
}

export interface RunPlaybookTaskOptions {
  readonly registration: PlaybookRegistration;
  readonly taskRunId: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly refs?: {
    readonly projectId?: string | null;
    readonly bookId?: string | null;
    readonly manuscriptId?: string | null;
  };
}

export class OrchestrationRuntime {
  readonly #graph: CompiledOrchestrationGraph;
  readonly #deps: RuntimeDeps;
  /** 每 runId 一条活跃账本（abort 精确中断、resume 复用 thread/parent）。 */
  readonly #runs = new Map<RunId, ActiveRun>();
  /** 显式抽取冲突的挂起账本，复用 resume-run 手刹通道裁决。 */
  readonly #pendingExtractionConflicts = new Map<RunId, PendingExtractionConflictRun>();
  /** 当前进程内的模型任务账本；持久化历史将在后续迁移中接入。 */
  readonly #factTasks = new Map<string, FactTaskRecord>();
  /** Diff preview binds apply to the exact fragment observed for this run. */
  readonly #fragmentBases = new Map<RunId, { nodeId: string; from: number; to: number; hash: string }>();
  readonly #taskSessions = new Map<string, TaskRuntimeSession>();
  /** 可执行 playbook 注册表（新任务通过注册接入，不复制工作台）。 */
  readonly #playbooks = new Map<string, PlaybookRegistration>();

  constructor(deps: RuntimeDeps) {
    this.#graph = createOrchestrationGraph();
    this.#deps = deps;
  }

  /**
   * 注册一个可执行 playbook。旧作/新书/临时任务均通过此接入；
   * 真实模型/工具的每步执行器由调用方注入（与 smoke 的 fake ModelResolver 同构）。
   */
  registerPlaybook(registration: PlaybookRegistration): void {
    this.#playbooks.set(registration.playbook.id, registration);
  }

  /** 精确中断某运行（拉手刹）。节点在提交里程碑前抛出，故不落 checkpoint（干净态）。 */
  abort(runId: RunId): void {
    this.#runs.get(runId)?.controller.abort();
  }

  /** 受控中断模型任务：必须同时匹配 task/attempt/run，避免误中断专家运行。 */
  abortModelTask(taskId: string, attemptId: string, runId: RunId): boolean {
    const task = this.#factTasks.get(taskId);
    if (task === undefined || task.currentAttempt.attemptId !== attemptId || task.currentAttempt.runId !== runId) return false;
    this.abort(runId);
    return true;
  }

  /** 对当前任务创建新 attempt；旧 attempt 只保留在 Renderer 的历史活动中，不被覆盖。 */
  async retryModelTask(taskId: string, attemptId: string, wc: WebContents): Promise<boolean> {
    const task = this.#factTasks.get(taskId);
    if (task === undefined || task.currentAttempt.attemptId !== attemptId) return false;
    const runId = randomUUID() as RunId;
    const nextAttempt = this.#createFactModelTask(runId, task.workflowRef, task.taskId);
    task.currentAttempt = nextAttempt;
    this.#sendModelTaskActivity(wc, nextAttempt, 'reading', '开始新的模型任务尝试');
    const run = this.#startUtilityRun(wc, runId, task.workflowRef);
    const supplement = task.supplement?.text;
    try {
      const resolver = this.#deps.getModelResolver();
      const factStore = this.#deps.getFactStore();
      if (resolver === undefined || factStore === undefined) {
        this.#failModelTask(wc, nextAttempt, { category: 'io', message: '模型任务依赖未就绪，无法重试' });
        return true;
      }
      if (task.kind === 'chapter') {
        const input = task.inputs[0];
        if (input === undefined) {
          this.#failModelTask(wc, nextAttempt, { category: 'validation', message: '模型任务缺少章节正文' });
          return true;
        }
        await this.#runFactExtractionPipeline(wc, runId, input, resolver, factStore, run.controller.signal, undefined, nextAttempt, supplement);
      } else {
        const startOffset = task.supplement?.scope === 'remaining-chapters' ? Math.min(task.currentOffset + 1, task.inputs.length) : task.currentOffset;
        const completed = await this.#continueFactBackfill(run, task.inputs, startOffset, resolver, factStore, nextAttempt, supplement);
        if (completed) this.#completeModelTask(wc, nextAttempt, { chapters: task.inputs.length - startOffset });
      }
    } catch (error) {
      this.#failModelTask(wc, nextAttempt, { category: 'model', message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!this.#pendingExtractionConflicts.has(runId)) this.#runs.delete(runId);
    }
    return true;
  }

  /** 补充要求只作用于新 attempt；workflow-goal 必须走作者目标更新命令，不能从任务自由文本写入。 */
  async supplementModelTask(taskId: string, attemptId: string, supplement: ModelTaskSupplementDto, wc: WebContents): Promise<boolean> {
    if (supplement.scope === 'workflow-goal' || supplement.text.trim().length === 0) return false;
    const task = this.#factTasks.get(taskId);
    if (task === undefined || task.currentAttempt.attemptId !== attemptId) return false;
    task.supplement = { ...supplement };
    return this.retryModelTask(taskId, attemptId, wc);
  }

  /** 启动一次非 LangGraph 的显式抽取账本，使 abort-run 也能中断抽取模型调用。 */
  #startUtilityRun(wc: WebContents, runId: RunId, workflowRef?: WorkflowRef): ActiveRun {
    const run: ActiveRun = {
      controller: new AbortController(),
      wc,
      threadId: runId,
      assembly: DEFAULT_ASSEMBLY_BASE,
      seq: 0,
      parent: null,
      ...(workflowRef === undefined ? {} : { workflowRef }),
    };
    this.#runs.set(runId, run);
    return run;
  }

  /** 进程退出/切工作区时清理所有活跃运行（task 3.2）。 */
  disposeAll(): void {
    for (const run of this.#runs.values()) run.controller.abort();
    this.#runs.clear();
    for (const session of [...this.#taskSessions.values()]) this.#closeTaskSession(session);
  }

  async getTaskCenter(request: { readonly projectId?: string; readonly workflowId?: string; readonly limit?: number }) {
    const repository = this.#deps.taskRuns;
    if (repository === undefined) return { runs: [], events: [] };
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 100);
    const runs = await repository.listRecent({
      limit,
      ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
      ...(request.workflowId === undefined ? {} : { workflowId: request.workflowId }),
    });
    return {
      runs,
      events: await repository.listEventsForRuns(runs.map((run) => run.taskRunId)),
    };
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

  #createFactModelTask(runId: RunId, workflowRef?: WorkflowRef, taskId?: string): ModelTaskAttemptContext {
    return {
      taskId: taskId ?? randomUUID(),
      attemptId: randomUUID(),
      kind: 'fact-extraction',
      runId,
      ...(workflowRef === undefined ? {} : { workflowRef }),
    };
  }

  #modelTaskRef(task: ModelTaskAttemptContext, chapterId?: string): ModelTaskRefDto {
    return {
      taskId: task.taskId,
      attemptId: task.attemptId,
      kind: task.kind,
      runId: task.runId,
      ...(task.workflowRef === undefined ? {} : { workflowRef: task.workflowRef }),
      ...(chapterId === undefined ? {} : { chapterId }),
    };
  }

  #sendModelTaskActivity(
    wc: WebContents,
    task: ModelTaskAttemptContext,
    phase: ModelTaskActivityPhase,
    message: string,
    chapterId?: string,
    metadata?: ModelTaskDisplayMetadata,
    awaitingAuthor = false,
    conflicts?: ReadonlyArray<ModelTaskConflictCandidateDto>,
  ): void {
    wc.send(IPC_CHANNELS.modelTaskEvent, {
      ...this.#modelTaskRef(task, chapterId),
      type: 'model-task-activity',
      attemptStatus: awaitingAuthor ? 'awaiting-author' : 'running',
      activity: {
        activityId: randomUUID(),
        phase,
        message,
        ...(metadata === undefined ? {} : { metadata }),
        ...(conflicts === undefined ? {} : { conflicts }),
        createdAt: new Date().toISOString(),
      },
    } satisfies BackendModelTaskEvent);
  }

  #completeModelTask(
    wc: WebContents,
    task: ModelTaskAttemptContext,
    summary: ModelTaskDisplayMetadata,
    chapterId?: string,
  ): void {
    wc.send(IPC_CHANNELS.modelTaskEvent, {
      ...this.#modelTaskRef(task, chapterId),
      type: 'model-task-completed',
      attemptStatus: 'completed',
      summary,
      completedAt: new Date().toISOString(),
    } satisfies BackendModelTaskEvent);
  }

  #failModelTask(
    wc: WebContents,
    task: ModelTaskAttemptContext,
    error: { category: 'model' | 'validation' | 'aborted' | 'io' | 'internal'; message: string },
    chapterId?: string,
  ): void {
    wc.send(IPC_CHANNELS.modelTaskEvent, {
      ...this.#modelTaskRef(task, chapterId),
      type: 'model-task-failed',
      attemptStatus: error.category === 'aborted' ? 'aborted' : 'failed',
      error,
      failedAt: new Date().toISOString(),
    } satisfies BackendModelTaskEvent);
  }

  #withWorkflow<T extends object>(run: ActiveRun, message: T): T & { workflowRef?: WorkflowRefDto } {
    return run.workflowRef === undefined ? message : { ...message, workflowRef: run.workflowRef };
  }

  async #assertWorkflowRef(ref: WorkflowRef, requireIssueRunId?: RunId, requireCurrentStage = false): Promise<void> {
    const workflows = this.#deps.workflows;
    if (workflows === undefined) throw new Error('workflow repository is unavailable');
    const workflow = await workflows.get(ref.workflowId);
    if (workflow === null || !workflow.stages.some((stage) => stage.stageId === ref.stageId)) throw new Error('stage does not belong to workflow');
    if (requireCurrentStage && workflow.currentStageId !== ref.stageId) throw new Error('workflowRef.stageId must equal current stage');
    if (ref.issueId !== undefined) {
      const issue = await this.#deps.workflowIssues?.get(ref.issueId);
      if (issue === null || issue === undefined || issue.workflowId !== ref.workflowId) throw new Error('issue does not belong to workflow');
      if (requireIssueRunId !== undefined && (issue.status !== 'fixing' || !issue.refactorRunIds.includes(requireIssueRunId))) throw new Error('issue is not fixing with this run');
    }
  }

  /**
   * task 5.2：启动阶段运行前校验模板允许专家。
   * 仅当 mutate 模式（专家实际承担阶段写入工作）且运行归属某 expert 阶段、该阶段声明了非空
   * allowedExperts 时，才强制召唤的专家 agent 必须在列表内；diagnose 模式（reviewer/fact-checker 审校诊断）
   * 不声称承担阶段专家工作，不受此约束。
   */
  async #assertStageActorAllowed(ref: WorkflowRef, mode: SummonParams['mode'], agent: string | undefined): Promise<void> {
    if (mode !== 'mutate' || agent === undefined) return;
    const workflow = await this.#deps.workflows?.get(ref.workflowId);
    const stage = workflow?.stages.find((item) => item.stageId === ref.stageId);
    if (workflow === null || workflow === undefined || stage === undefined) return;
    const template = getBuiltinWorkflowTemplate(workflow.kind as WorkflowKind, Number(workflow.templateVersion));
    const definition = template?.stages.find((item) => item.id === stage.templateStageId);
    if (definition === undefined || definition.actor !== 'expert' || definition.allowedExperts.length === 0) return;
    if (!definition.allowedExperts.includes(agent)) {
      throw new Error(`expert ${agent} is not allowed in stage ${stage.templateStageId}`);
    }
  }

  async #assertIssueAnchor(ref: WorkflowRef | undefined, nodeId: string): Promise<void> {
    if (ref?.issueId === undefined) return;
    const issue = await this.#deps.workflowIssues?.get(ref.issueId);
    if (issue === null || issue === undefined || !issue.anchorRefs.some((anchor) => anchor === `chapter:${nodeId}` || anchor === `scene:${nodeId}`)) {
      throw new Error('refactor anchor does not belong to issue');
    }
  }

  async #recordStageRun(
    run: ActiveRun,
    status: 'started' | 'resumed' | 'completed' | 'failed' | 'interrupted',
    evidence?: Readonly<Record<string, string>>,
    completion?: {
      readonly passed: boolean;
      readonly issueIds: ReadonlyArray<string>;
      readonly transition?: 'quality-failed' | 'issues-found';
    },
  ): Promise<void> {
    if (run.workflowRef === undefined || this.#deps.stageRunEvidence === undefined) return;
    await this.#deps.stageRunEvidence.record({
      runId: run.threadId,
      workflowRef: run.workflowRef,
      status,
      ...(evidence !== undefined ? { evidence } : {}),
      ...(completion !== undefined ? { completion } : {}),
    });
  }

  async #projectReviewIssues(
    run: ActiveRun,
    issues: ReadonlyArray<ConsistencyIssue>,
  ): Promise<{ readonly dtos: ReadonlyArray<ConsistencyIssueDto>; readonly issueIds: ReadonlyArray<string> }> {
    if (run.workflowRef === undefined || this.#deps.workflowIssues === undefined) {
      return { dtos: issues.map((issue) => toIssueDto(issue)), issueIds: [] };
    }
    const records = await this.#deps.workflowIssues.upsertFromAudit(
      run.workflowRef.workflowId,
      run.threadId,
      issues,
    );
    return {
      dtos: issues.map((issue, index) => toIssueDto(issue, records[index])),
      issueIds: records.map((record) => record.issueId),
    };
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
        this.#send(run.wc, this.#withWorkflow(run, {
          type: 'stream-chunk', runId: run.threadId, kind: 'dialogue', delta, seq: run.seq++,
        }));
      },
      emitReasoning: (delta: string) => {
        this.#send(run.wc, this.#withWorkflow(run, {
          type: 'stream-chunk', runId: run.threadId, kind: 'dialogue',
          delta: `\u0001reasoning\u0001${delta}`, seq: run.seq++,
        }));
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
      ...(run.continuationTarget !== undefined
        ? { continuationTarget: () => run.continuationTarget }
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
    modelTask?: ModelTaskAttemptContext,
    supplement?: string,
  ): Promise<void> {
    const chapterId = input.location.id as string;
    if (modelTask !== undefined) {
      this.#sendModelTaskActivity(wc, modelTask, 'reading', `已读取${chapterId}，共 ${input.text.length.toLocaleString()} 字`, chapterId, {
        textChars: input.text.length,
        ...(progress === undefined ? {} : { index: progress.index, total: progress.total }),
      });
    }
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
        if (modelTask !== undefined) this.#failModelTask(wc, modelTask, { category: 'aborted', message: '事实抽取已中断' }, chapterId);
        this.#sendControl(wc, {
          type: 'fact-extraction-failed',
          runId,
          chapterId,
          error: { category: 'aborted', message: '事实抽取已中断' },
        });
        return;
      }
      if (modelTask !== undefined) this.#sendModelTaskActivity(wc, modelTask, 'model', '正在识别人物、事件、关系与时间线', chapterId, {
        chunkIndex: extractedChunks.length + 1,
        chunks: chunks.length,
      });
      const extracted = await extractor.extract(chunk, {
        signal,
        logger: (message) => appendOrchestrationLog(`[extraction:${runId}] ${message}`),
        ...(supplement === undefined ? {} : { supplement }),
      });
      extractedChunks.push(extracted);
      candidates.push(...extracted.output.candidates);
    }

    if (signal.aborted) {
      if (modelTask !== undefined) this.#failModelTask(wc, modelTask, { category: 'aborted', message: '事实抽取已中断' }, chapterId);
      this.#sendControl(wc, {
        type: 'fact-extraction-failed',
        runId,
        chapterId,
        error: { category: 'aborted', message: '事实抽取已中断' },
      });
      return;
    }

    if (modelTask !== undefined) this.#sendModelTaskActivity(wc, modelTask, 'validation', '正在校验并归一化候选事实', chapterId, {
      candidateObjects: extractedChunks.reduce((sum, item) => sum + item.diagnostics.candidateObjects, 0),
    });
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
    if (modelTask !== undefined) this.#sendModelTaskActivity(wc, modelTask, 'ingest', '正在写入低风险事实并整理冲突', chapterId, {
      validCandidates: normalized.facts.length,
      skipped: plan.diagnostics.skipped,
    });
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
      if (modelTask !== undefined) {
        this.#sendModelTaskActivity(
          wc,
          modelTask,
          'conflict',
          `发现 ${plan.conflicts.length} 条冲突，等待作者裁决`,
          chapterId,
          { conflicts: plan.conflicts.length },
          true,
          plan.conflicts.map((conflict, index) => ({
            conflictId: createHash('sha1').update(`${chapterId}:${conflict.issue.type}:${conflict.issue.description}:${conflict.existingLabel}:${index}`).digest('hex'),
            candidateSummary: conflict.issue.description,
            existingSummary: conflict.existingLabel,
            ...(conflict.issue.evidence?.quote === undefined ? {} : { evidenceQuote: conflict.issue.evidence.quote }),
            allowedActions: ['accept-candidate', 'keep-existing', 'ignore-candidate'] as const,
          })),
        );
      }
      this.#pendingExtractionConflicts.set(runId, {
        wc,
        chapterId,
        conflicts: plan.conflicts,
        ...(modelTask === undefined ? {} : { modelTask }),
      });
      this.#sendControl(wc, {
        type: 'interrupt-raised',
        runId,
        issues: plan.conflicts.map((conflict) => toIssueDto(conflict.issue)),
      });
    } else if (modelTask !== undefined) {
      this.#sendModelTaskActivity(wc, modelTask, 'completed', '本章事实抽取完成', chapterId, {
        autoIngested: plan.diagnostics.autoIngest,
        conflicts: plan.diagnostics.conflicts,
        skipped: plan.diagnostics.skipped,
      });
      if (progress === undefined) {
        this.#completeModelTask(wc, modelTask, {
          autoIngested: plan.diagnostics.autoIngest,
          conflicts: plan.diagnostics.conflicts,
          skipped: plan.diagnostics.skipped,
          factVersion: applied.version as string,
        }, chapterId);
      }
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
      undefined,
      this.#createFactModelTask(run.threadId, run.workflowRef),
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
      ...(params.workflowRef !== undefined ? { workflowRef: params.workflowRef } : {}),
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
    if (params.workflowRef !== undefined) {
      try {
        await this.#assertWorkflowRef(params.workflowRef, undefined, true);
        await this.#assertStageActorAllowed(params.workflowRef, params.mode, params.agent);
      }
      catch (err) {
        this.#send(wc, { type: 'stream-error', runId, kind: 'dialogue', error: { category: 'validation', message: err instanceof Error ? err.message : String(err) } });
        return;
      }
    }
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
      ...(params.workflowRef !== undefined ? { workflowRef: params.workflowRef } : {}),
    };
    this.#runs.set(runId, run);
    await this.#recordStageRun(run, 'started');
    this.#send(wc, this.#withWorkflow(run, { type: 'stream-start', runId, kind: 'dialogue' }));

    await this.#drive(run, resolver, this.#initialState(params));
  }

  /**
   * 恢复被挂起的运行，携带作者决策（task 4.3–4.5）。
   * 以 Command({resume}) 从挂起点续跑：modify/correct 回 writer，approve/reject 终止。
   */
  async resume(
    wc: WebContents,
    runId: RunId,
    decision: ResumeDecision,
    workflowRef?: WorkflowRef,
  ): Promise<void> {
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
    if (await this.#resumeExtractionConflict(wc, runId, decision, workflowRef)) return;
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
    // 已存在运行的 workflowRef 是唯一 ownership 真相：调用方显式传 ref 时只能精确匹配，
    // 未传时则必须继承它，不能让 continuation scope 被伪造或降级为 standalone。
    const existing = this.#runs.get(runId);
    const continuationService = this.#deps.continuationRecords;
    const persistedRecord = continuationService === undefined ? null : await continuationService.getByRunId(runId);
    const ownedRef = existing?.workflowRef ?? (persistedRecord?.scope.kind === 'workflow' || persistedRecord?.scope.kind === 'issue' ? persistedRecord.scope.workflowRef : undefined);
    if (existing?.workflowRef !== undefined && workflowRef !== undefined && !sameWorkflowRef(existing.workflowRef, workflowRef)) {
      this.#send(wc, this.#withWorkflow(existing, { type: 'stream-error', runId, kind: 'dialogue', error: { category: 'validation', message: '恢复被拒绝：workflowRef 与运行 ownership 不匹配' } }));
      return;
    }
    const effectiveWorkflowRef = ownedRef ?? workflowRef;
    const run: ActiveRun = existing ?? {
      controller: new AbortController(),
      wc,
      threadId: runId,
      assembly: DEFAULT_ASSEMBLY_BASE,
      seq: 0,
      parent: null,
      ...(effectiveWorkflowRef !== undefined ? { workflowRef: effectiveWorkflowRef } : {}),
    };
    if (existing === undefined) this.#runs.set(runId, run);

    if (continuationService !== undefined) {
      const record = persistedRecord;
      if (record !== null) {
        const scope = continuationScope(runId, effectiveWorkflowRef);
        const resolved = resolveContinuation(record, decision.kind, scope);
        if (!resolved.ok) {
          this.#send(wc, this.#withWorkflow(run, {
            type: 'stream-error', runId, kind: 'dialogue',
            error: { category: 'validation', message: `恢复被拒绝：${resolved.reason}` },
          }));
          return;
        }
        const target = await this.#resolveContinuationTarget(resolved.continuation, effectiveWorkflowRef);
        if (target !== undefined) run.continuationTarget = target;
        await continuationService.remove(record.interruptId);
      } else if (existing === undefined) {
        this.#send(wc, this.#withWorkflow(run, { type: 'stream-error', runId, kind: 'dialogue', error: { category: 'validation', message: '恢复被拒绝：continuation not found' } }));
        this.#runs.delete(runId);
        return;
      }
    }

    // Continuation validation/consumption must succeed before the workflow leaves blocked.
    // Record this before graph execution so subsequent completion evidence is legal.
    await this.#recordStageRun(run, 'resumed');
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
    const modelTask = this.#createFactModelTask(runId);
    this.#factTasks.set(modelTask.taskId, {
      taskId: modelTask.taskId,
      wc,
      kind: 'chapter',
      inputs: [input],
      currentAttempt: modelTask,
      currentOffset: 0,
    });
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
        undefined,
        modelTask,
      );
    } catch (err) {
      this.#failModelTask(wc, modelTask, {
        category: run.controller.signal.aborted ? 'aborted' : 'model',
        message: err instanceof Error ? err.message : String(err),
      }, chapterId);
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

  async runGlobalAudit(wc: WebContents, runId: RunId, workflowRef?: WorkflowRef): Promise<void> {
    const emit = (event: BackendControlEvent): void => {
      this.#sendControl(wc, workflowRef === undefined ? event : { ...event, workflowRef } as BackendControlEvent);
    };
    if (workflowRef !== undefined) {
      try { await this.#assertWorkflowRef(workflowRef, undefined, true); }
      catch (err) {
        emit({ type: 'global-audit-failed', runId, error: { category: 'validation', message: err instanceof Error ? err.message : String(err) } });
        return;
      }
    }

    const run = this.#startUtilityRun(wc, runId, workflowRef);
    try {
      await this.#recordStageRun(run, 'started');
      const factStore = this.#deps.getFactStore();
      if (factStore === undefined) throw new Error('事实库未就绪：无法运行全书总检');
      const version = await factStore.getLatestVersion();
      if (version === null) throw new Error('Story Bible 为空：请先抽取章节事实再运行全书总检');

      const view = await factStore.getView(version);
      const totalItems = countAuditableItems(view);
      emit({ type: 'global-audit-started', runId, factVersion: version as string, totalItems });
      if (run.controller.signal.aborted) throw new AuditAbortedError('全书总检已中断');
      emit({ type: 'global-audit-progress', runId, phase: 'map', completedItems: totalItems, totalItems });
      if (run.controller.signal.aborted) throw new AuditAbortedError('全书总检已中断');

      const runner = this.#deps.getAuditRunner?.() ?? new InlineAuditRunner();
      const result = await runner.run(view, run.controller.signal);
      const persistedIssues = workflowRef !== undefined && this.#deps.workflowIssues !== undefined
        ? await this.#deps.workflowIssues.upsertFromAudit(workflowRef.workflowId, runId, result.issues)
        : [];
      const workflow = workflowRef === undefined ? null : await this.#deps.workflows?.get(workflowRef.workflowId) ?? null;
      const diagnosis = workflow?.kind === 'legacy-book-revision' && workflow.authorIntents.length > 0
        ? buildLegacyRevisionDiagnosis(
            workflow.authorIntents,
            view,
            result.issues.map((issue, index) => ({
              issue,
              ...(persistedIssues[index]?.issueId === undefined ? {} : { issueId: persistedIssues[index].issueId }),
            })),
            result.generatedAt,
          )
        : undefined;
      const diagnosisAssetId = diagnosis === undefined || workflow === null || this.#deps.creativeAssets === undefined
        ? undefined
        : `${workflow.workflowId}:legacy-revision-diagnosis`;
      if (diagnosisAssetId !== undefined && diagnosis !== undefined && workflow !== null && this.#deps.creativeAssets !== undefined) {
        const existing = await this.#deps.creativeAssets.get(diagnosisAssetId);
        const provenance = { runId, workflowRef, factVersion: diagnosis.factVersion, authorIntents: workflow.authorIntents };
        const asset = existing === null
          ? await this.#deps.creativeAssets.create({ assetId: diagnosisAssetId, projectId: workflow.projectId, kind: 'legacy-revision-diagnosis', scope: { kind: 'project', projectId: workflow.projectId }, content: diagnosis, status: 'generated', provenance }, `diagnosis:${runId}`)
          : await this.#deps.creativeAssets.update(diagnosisAssetId, existing.version, diagnosis, 'generated', provenance, `diagnosis:${runId}`);
        emit({ type: 'creative-asset-updated', runId, asset: asset as unknown as Record<string, unknown>, ...(workflowRef === undefined ? {} : { workflowRef }), projectId: workflow.projectId });
      }
      emit({ type: 'global-audit-progress', runId, phase: 'reduce', completedItems: totalItems, totalItems });
      emit({ type: 'global-audit-progress', runId, phase: 'score', completedItems: totalItems, totalItems });
      emit({
        type: 'global-audit-completed', runId,
        dashboard: {
          factVersion: result.factVersion, generatedAt: result.generatedAt,
          healthScore: result.healthScore, scoreExplanation: result.scoreExplanation,
          totalItems: result.totalItems, issues: result.issues.map((issue, index) => toIssueDto(issue, persistedIssues[index])),
          ...(diagnosis === undefined ? {} : { legacyDiagnosis: diagnosis }),
        },
      });
      await this.#recordStageRun(run, 'completed', diagnosisAssetId === undefined ? undefined : { diagnosisAssetId }, {
        passed: result.issues.length === 0,
        issueIds: persistedIssues.map((issue) => issue.issueId),
      });
    } catch (err) {
      const aborted = err instanceof AuditAbortedError || run.controller.signal.aborted;
      await this.#recordStageRun(run, aborted ? 'interrupted' : 'failed', { reason: err instanceof Error ? err.message : String(err) });
      emit({
        type: 'global-audit-failed', runId,
        error: {
          category: aborted ? 'aborted' : (this.#deps.getFactStore() === undefined ? 'io' : 'internal'),
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      this.#runs.delete(runId);
    }
  }

  /**
   * 4.1「相关人物或事实底稿」：从事实库按证据引文/问题描述召回被提及的实体，
   * 作为定位原文的只读输入之一，帮助作者判断此处正文应对齐哪些既定人物设定。
   * 纯读取投影，绝不改事实库；事实库未就绪或无命中时返回空，任务照常进行。
   */
  async #collectSourceFactBacking(
    quote: string,
    description: string,
  ): Promise<ReadonlyArray<{ readonly entityId: string; readonly name: string; readonly type: string }>> {
    const factStore = this.#deps.getFactStore();
    if (factStore === undefined) return [];
    const version = await factStore.getLatestVersion();
    if (version === null) return [];
    const view = await factStore.getView(version);
    const haystack = `${quote}${description}`;
    const backing: Array<{ readonly entityId: string; readonly name: string; readonly type: string }> = [];
    for (const entity of view.entities) {
      const names = [entity.canonicalName, ...entity.aliasSet.aliases];
      const mentioned = names.some((name) => name.length > 0 && haystack.includes(name));
      if (mentioned) {
        backing.push({ entityId: entity.id as string, name: entity.canonicalName, type: entity.type });
        if (backing.length >= MAX_FACT_BACKING) break;
      }
    }
    return backing;
  }

  async #createTaskSession(
    wc: WebContents,
    ref: TaskRunRefDto,
    projectId: string | null,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<TaskRuntimeSession> {
    const now = new Date().toISOString();
    const queued: TaskRun = {
      id: ref.taskRunId,
      kind: 'legacy-book',
      refs: {
        playbookId: 'legacy.locate-source',
        executionRunId: ref.runId,
        projectId,
        bookId: null,
        manuscriptId: null,
        workflowId: ref.workflowRef?.workflowId ?? null,
        workflowStageId: ref.workflowRef?.stageId ?? null,
        issueId: ref.issueId ?? null,
      },
      inputs,
      status: 'queued',
      currentStepId: 'read-chapter',
      currentStepIndex: 0,
      artifacts: [],
      authorDecisions: [],
      timestamps: {
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        awaitingAuthorAt: null,
        pausedAt: null,
        endedAt: null,
      },
      failure: null,
    };
    await this.#deps.taskRuns?.create(queued);
    const running = transitionTaskRun(queued, { status: 'running', occurredAt: now });
    await this.#deps.taskRuns?.save(running);
    const session: TaskRuntimeSession = { run: running, ref, wc, lastActivityAt: Date.now() };
    this.#taskSessions.set(ref.taskRunId, session);
    session.heartbeat = setInterval(() => {
      if (session.run.status !== 'running' || Date.now() - session.lastActivityAt < 2_000) return;
      const activity = this.#buildHeartbeatActivity('定位原文', session.heartbeatState);
      if (activity === undefined) return;
      void this.#publishTaskActivity(session, activity);
    }, 500);
    return session;
  }

  async #saveTaskRun(session: TaskRuntimeSession, run: TaskRun): Promise<void> {
    session.run = run;
    await this.#deps.taskRuns?.save(run);
    if (run.status !== 'running' && session.heartbeat !== undefined) {
      clearInterval(session.heartbeat);
      delete session.heartbeat;
    }
  }

  async #publishTaskEvent(session: TaskRuntimeSession, event: BackendTaskActivityEvent): Promise<void> {
    await this.#deps.taskRuns?.appendEvent(event);
    session.lastActivityAt = Date.now();
    session.wc.send(IPC_CHANNELS.taskActivityEvent, event);
  }

  async #publishTaskActivity(
    session: TaskRuntimeSession,
    event: Omit<TaskActivityEvent, keyof TaskRunRefDto | 'type' | 'activityId' | 'createdAt'>,
  ): Promise<void> {
    await this.#publishTaskEvent(session, {
      ...session.ref,
      type: 'task-activity',
      activityId: randomUUID(),
      ...event,
      createdAt: new Date().toISOString(),
    } satisfies TaskActivityEvent);
  }

  /**
   * 由结构化心跳进展构建一条 heartbeat 活动，MUST 至少携带一项真实信号，否则返回 undefined（拒绝空心跳/虚假进度）。
   * message/feedback 均由结构化字段派生，作者可读。
   */
  #buildHeartbeatActivity(
    title: string,
    state: TaskHeartbeatDto | undefined,
  ): Omit<TaskActivityEvent, keyof TaskRunRefDto | 'type' | 'activityId' | 'createdAt'> | undefined {
    if (state === undefined) return undefined;
    const hasSignal =
      state.step !== undefined ||
      state.processedCount !== undefined ||
      state.currentObject !== undefined ||
      state.recentSubStep !== undefined ||
      state.waitingOnExternal !== undefined;
    if (!hasSignal) return undefined; // 无真实进展信号：不发心跳，避免虚假进度。
    const progress =
      state.processedCount !== undefined
        ? state.totalCount !== undefined
          ? `（${state.processedCount}/${state.totalCount}）`
          : `（已处理 ${state.processedCount}）`
        : '';
    const objectPart = state.currentObject === undefined ? '' : `：${state.currentObject}`;
    const stepPart = state.step ?? '处理中';
    const message = state.waitingOnExternal === undefined
      ? `仍在${stepPart}${objectPart}${progress}`
      : `等待${state.waitingOnExternal}${progress}`;
    const feedback = state.recentSubStep === undefined ? undefined : `最近完成：${state.recentSubStep}`;
    return {
      status: 'running',
      phase: 'heartbeat',
      title,
      message,
      ...(feedback === undefined ? {} : { feedback }),
      heartbeat: state,
    };
  }

  #closeTaskSession(session: TaskRuntimeSession): void {
    if (session.heartbeat !== undefined) clearInterval(session.heartbeat);
    delete session.heartbeat;
    this.#taskSessions.delete(session.run.id);
  }

  #taskRef(runId: RunId, workflowRef: WorkflowRef, taskRunId: string, chapterId?: string) {
    return {
      taskRunId,
      taskId: `locate-source:${workflowRef.issueId ?? taskRunId}`,
      kind: 'locate-source' as const,
      runId,
      workflowRef,
      ...(workflowRef.issueId === undefined ? {} : { issueId: workflowRef.issueId }),
      ...(chapterId === undefined ? {} : { chapterId }),
    };
  }

  /** 从持久化 run 派生 IPC ref（任意 playbook 通用）：无 session 时的控制/回执事件据此构造。 */
  #refFromRun(run: TaskRun): TaskRunRefDto {
    const kind = ipcTaskKindFor(run.refs.playbookId, run.kind);
    const workflowRef = run.refs.workflowId === null || run.refs.workflowStageId === null
      ? undefined
      : { workflowId: run.refs.workflowId, stageId: run.refs.workflowStageId, ...(run.refs.issueId === null ? {} : { issueId: run.refs.issueId }) };
    const taskId = kind === 'locate-source'
      ? `locate-source:${run.refs.issueId ?? run.id}`
      : `${run.refs.playbookId}:${run.id}`;
    return {
      taskRunId: run.id,
      taskId,
      kind,
      runId: run.refs.executionRunId as RunId,
      ...(workflowRef === undefined ? {} : { workflowRef }),
      ...(run.refs.issueId === null ? {} : { issueId: run.refs.issueId }),
    };
  }



  async #completeLocatedSource(
    session: TaskRuntimeSession,
    stageRun: ActiveRun,
    workflowRef: WorkflowRef & { readonly issueId: string },
    candidate: { readonly from: number; readonly to: number; readonly quote: string },
    matchMethod: 'exact' | 'context' | 'author',
  ): Promise<void> {
    const chapterId = session.ref.chapterId;
    if (chapterId === undefined) throw new Error('原文定位任务缺少目标章节');
    const artifactRef = `chapter:${chapterId}:${candidate.from}-${candidate.to}`;
    const artifacts: ReadonlyArray<TaskArtifactRefDto> = [{ kind: 'source-location', label: '原文定位结果', ref: artifactRef }];
    const uiEffects: ReadonlyArray<TaskUiEffectDto> = [
      { effectId: randomUUID(), kind: 'select-chapter', chapterId, reason: '已找到诊断问题对应的目标章节' },
      { effectId: randomUUID(), kind: 'scroll-to-evidence', chapterId, quote: candidate.quote },
      { effectId: randomUUID(), kind: 'highlight-quote', chapterId, quote: candidate.quote, reason: '已验证诊断证据对应的原文位置' },
    ];
    await this.#publishTaskActivity(session, {
      status: 'running', phase: 'ui-effect', title: '更新工作区',
      message: '已定位原文，正在切换章节、滚动并高亮证据',
      outputSummary: matchMethod === 'author' ? '作者已确认候选原文位置' : `通过${matchMethod === 'exact' ? '精确匹配' : '上下文校验'}找到唯一位置`,
      artifactRefs: artifacts,
      uiEffects,
    });
    const now = new Date().toISOString();
    const artifact: TaskRunArtifact = { id: randomUUID(), outputKey: 'sourceLocation', value: { chapterId, from: candidate.from, to: candidate.to }, createdAt: now };
    const completedRun = transitionTaskRun({
      ...session.run,
      currentStepId: null,
      currentStepIndex: null,
      artifacts: [...session.run.artifacts, artifact],
    }, { status: 'completed', occurredAt: now });
    await this.#recordStageRun(stageRun, 'completed', { sourceLocation: artifactRef });
    await this.#saveTaskRun(session, completedRun);
    await this.#publishTaskEvent(session, {
      ...session.ref,
      type: 'task-run-completed', status: 'completed', title: '原文定位完成',
      summary: '已找到可修订的原文位置，正在等待正文工作区确认更新结果',
      artifactRefs: artifacts,
      completedAt: now,
    } satisfies TaskRunCompletedEvent);
    const latest = await this.#deps.workflows?.get(workflowRef.workflowId);
    if (latest !== null && latest !== undefined) {
      this.#sendControl(session.wc, {
        type: 'workflow-snapshot', runId: session.ref.runId,
        snapshot: { ...latest, authorIntents: latest.authorIntents as import('../../shared/ipc/workflow-messages.js').AuthorIntentDto[], stages: latest.stages as unknown as ReadonlyArray<Record<string, unknown>> },
      });
    }
    this.#closeTaskSession(session);
  }

  /**
   * 将诊断问题确定性定位到当前正文。该任务只读取 issue/正文，不调用模型；
   * 多候选时不会猜测，而是持久化候选并等待作者明确选择。
   */
  async locateSource(
    wc: WebContents,
    runId: RunId,
    workflowRef: WorkflowRef & { readonly issueId: string },
  ): Promise<void> {
    const run = this.#startUtilityRun(wc, runId, workflowRef);
    const taskRunId = randomUUID();
    let ref = this.#taskRef(runId, workflowRef, taskRunId);
    let session: TaskRuntimeSession | undefined;
    let awaitingAuthor = false;
    try {
      await this.#assertWorkflowRef(workflowRef, undefined, true);
      const workflow = await this.#deps.workflows?.get(workflowRef.workflowId);
      const stage = workflow?.stages.find((item) => item.stageId === workflowRef.stageId);
      if (stage?.templateStageId !== 'locate-source') throw new Error('当前任务不是定位原文');
      await this.#recordStageRun(run, 'started');
      const repository = this.#deps.workflowIssues;
      if (repository === undefined) throw new Error('诊断问题仓储尚未就绪');
      const issue = await repository.get(workflowRef.issueId);
      const payload = await repository.getPayload(workflowRef.issueId);
      if (issue === null || payload === null) throw new Error('诊断问题或证据已失效，请重新运行诊断');
      const chapterAnchor = payload.anchors.find((anchor) => anchor.kind === 'chapter');
      if (chapterAnchor === undefined) throw new Error('诊断问题缺少章节锚点，无法定位原文');
      if (payload.evidence === undefined) throw new Error('诊断问题缺少原文证据，请重新运行诊断');
      const chapterId = chapterAnchor.id as string;
      ref = this.#taskRef(runId, workflowRef, taskRunId, chapterId);
      // 4.1「相关人物或事实底稿」：定位前先从事实库召回证据中提及的已知实体，作为只读输入。
      const factBacking = await this.#collectSourceFactBacking(payload.evidence.quote, payload.description);
      session = await this.#createTaskSession(wc, ref, workflow?.projectId ?? null, {
        issue: { description: payload.description, issueId: workflowRef.issueId },
        evidence: payload.evidence,
        chapterAnchor: chapterId,
        factBacking,
      });
      session.execution = run;
      session.heartbeatState = { step: '读取目标章节并验证证据上下文', currentObject: `目标章节“${chapterId}”`, recentSubStep: '已声明诊断问题、证据引文和章节锤点' };
      const factBackingRefs = factBacking.map((item) => ({
        kind: 'fact' as const, label: `相关人物或事实–${item.name}`, ref: item.entityId,
      }));
      await this.#publishTaskActivity(session, {
        status: 'running', phase: 'input', title: '定位原文',
        message: `开始定位“${payload.description}”对应的原文`,
        inputSummary: factBacking.length > 0
          ? `诊断问题、证据引文、章节锤点、当前正文，以及 ${factBacking.length} 项相关人物或事实底稿`
          : '诊断问题、证据引文、章节锤点和当前正文',
        nextAction: '读取目标章节并匹配证据引文',
        evidenceRefs: [
          { kind: 'issue', label: '当前诊断问题', ref: workflowRef.issueId },
          { kind: 'chapter', label: '目标章节', ref: chapterId },
          { kind: 'quote', label: '诊断证据', ref: payload.evidence.quote },
          ...factBackingRefs,
        ],
      });
      this.#assertNotControlled(session);
      const chapter = await (this.#deps.manuscript?.readChapterContent ?? readChapterContent)(chapterId);
      this.#assertNotControlled(session);
      session.heartbeatState = { step: '匹配诊断证据', currentObject: `目标章节“${chapterId}”`, recentSubStep: '已读取目标章节正文' };
      await this.#publishTaskActivity(session, {
        status: 'running', phase: 'retrieval', title: '读取原文',
        message: '已读取目标章节，正在匹配诊断证据',
        inputSummary: `章节正文与证据引文“${payload.evidence.quote}”`,
        nextAction: '验证引文前后文，排除重复位置',
      });
      awaitingAuthor = await this.#matchAndResolveSource(session, run, workflowRef, chapterId, chapter.content, payload.evidence);
    } catch (error) {
      const controlIntent = error instanceof TaskControlAbort
        ? error.intent
        : (session?.requestedControl ?? (run.controller.signal.aborted ? 'cancel' : undefined));
      if (controlIntent === 'pause' && session !== undefined) {
        awaitingAuthor = await this.#pauseTaskSession(session, run);
      } else {
        await this.#failLocateSource(wc, ref, session, run, error, controlIntent === 'cancel');
      }
    } finally {
      if (!awaitingAuthor) this.#runs.delete(runId);
    }
  }

  /**
   * 确定性匹配证据到正文：唯一命中直接完成；多候选持久化并等待作者。
   * 初次运行与恢复后重新执行共用此确定性逻辑（不新建第二条 TaskRun）。
   * 返回是否进入等待作者状态。
   */
  async #matchAndResolveSource(
    session: TaskRuntimeSession,
    run: ActiveRun,
    workflowRef: WorkflowRef & { readonly issueId: string },
    chapterId: string,
    content: string,
    evidence: import('../../core/story-bible/index.js').IssueEvidence,
  ): Promise<boolean> {
    const taskRunId = session.run.id;
    const located = locateSourceEvidence(content, evidence);
    if (located.status === 'not-found') throw new Error(located.reason);
    if (located.status === 'ambiguous') {
      if (located.matchMethod === 'approximate') {
        // 忠实§15.4：精确匹配未命中时显式告知正在近似匹配，避免作者误以为任务卡住。
        await this.#publishTaskActivity(session, {
          status: 'running', phase: 'retrieval', title: '近似匹配',
          message: '引文与当前正文存在差异，正在近似匹配相近段落',
          nextAction: '汇总近似候选并等待作者确认',
        });
      }
      const createdAt = new Date().toISOString();
      const candidates = located.candidates.map((candidate, index) => ({
        candidateId: createHash('sha256').update(`${taskRunId}:${chapterId}:${candidate.from}:${candidate.to}`).digest('hex').slice(0, 24),
        taskRunId,
        kind: 'source-location' as const,
        label: `候选位置 ${index + 1}`,
        payload: {
          chapterId,
          from: candidate.from,
          to: candidate.to,
          quote: candidate.quote,
          preview: content.slice(Math.max(0, candidate.from - 40), Math.min(content.length, candidate.to + 40)),
        },
        status: 'pending' as const,
        createdAt,
      }));
      await this.#deps.taskRuns?.replaceCandidates(taskRunId, candidates);
      const waitingRun = transitionTaskRun({ ...session.run, currentStepId: 'confirm-location', currentStepIndex: 2 }, { status: 'awaiting-author', occurredAt: createdAt });
      await this.#saveTaskRun(session, waitingRun);
      await this.#publishTaskActivity(session, {
        status: 'awaiting-author', phase: 'awaiting-author', title: '需要确认原文位置',
        message: located.reason,
        outputSummary: located.matchMethod === 'approximate'
          ? `近似匹配到 ${located.candidates.length} 处相近原文`
          : `找到 ${located.candidates.length} 处候选原文`,
        feedback: located.matchMethod === 'approximate'
          ? '近似结果不确定，系统没有自动选择，请作者确认真实修改位置'
          : '系统没有自动选择，避免修改错误位置',
        nextAction: '请从候选原文中确认正确位置',
        artifactRefs: [{ kind: 'source-location-candidates', label: '待确认原文候选', ref: `task:${taskRunId}:candidates` }],
        authorCandidates: candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          kind: candidate.kind,
          label: candidate.label,
          chapterId,
          preview: String(candidate.payload['preview']),
        })),
      });
      return true;
    }
    await this.#completeLocatedSource(session, run, workflowRef, located.candidate, located.matchMethod);
    return false;
  }

  /** 将提醒错误或取消收敛为 failed/cancelled，并下发作者可读恢复信息。 */
  async #failLocateSource(
    wc: WebContents,
    ref: TaskRunRefDto,
    session: TaskRuntimeSession | undefined,
    run: ActiveRun,
    error: unknown,
    cancelled: boolean,
  ): Promise<void> {
    try {
      await this.#recordStageRun(run, 'failed', { reason: error instanceof Error ? error.message : String(error) });
    } catch {
      // Preserve the original task failure when the workflow has already moved.
    }
    const failedAt = new Date().toISOString();
    const failedEvent = {
      ...ref,
      type: 'task-run-failed', status: cancelled ? 'cancelled' : 'failed', title: cancelled ? '原文定位已取消' : '原文定位未完成',
      error: {
        category: cancelled ? 'aborted' : 'validation',
        message: cancelled ? '作者已取消原文定位任务' : (error instanceof Error ? error.message : String(error)),
        recovery: cancelled ? '如需重新定位，可在任务中心重新发起原文定位' : '检查诊断问题的章节锚点和证据引文，然后重新定位',
      },
      failedAt,
    } satisfies TaskRunFailedEvent;
    if (session === undefined) wc.send(IPC_CHANNELS.taskActivityEvent, failedEvent);
    else {
      const failedRun = transitionTaskRun(session.run, {
        status: cancelled ? 'cancelled' : 'failed',
        occurredAt: failedAt,
        ...(cancelled ? {} : { failure: { code: 'source-location-failed', message: failedEvent.error.message } }),
      });
      await this.#saveTaskRun(session, failedRun);
      await this.#publishTaskEvent(session, failedEvent);
      this.#closeTaskSession(session);
    }
  }

  /** 在安全边界将运行中任务收敛为 paused（不产生 UI Effect/产物/工作流推进）。 */
  async #pauseTaskSession(session: TaskRuntimeSession, run: ActiveRun): Promise<boolean> {
    const pausedAt = new Date().toISOString();
    const pausedRun = transitionTaskRun(session.run, { status: 'paused', occurredAt: pausedAt });
    await this.#saveTaskRun(session, pausedRun);
    delete session.requestedControl;
    // 丢弃已中断的执行运行；恢复时会新建干净的 AbortController。
    run.controller.abort();
    this.#runs.delete(session.ref.runId);
    delete session.execution;
    await this.#publishTaskActivity(session, {
      status: 'paused', phase: 'paused', title: '任务已暂停',
      message: '已在安全步骤边界暂停当前任务，正文未发生任何修改',
      feedback: '任务输入与已完成步骤已保留',
      nextAction: '可在当前任务卡或任务中心恢复或取消本任务',
    });
    // Keep the session alive so resume can reuse the same taskRunId.
    return true;
  }

  /** 若作者已请求 pause/cancel，在安全步骤边界中断当前执行。 */
  #assertNotControlled(session: TaskRuntimeSession): void {
    if (session.requestedControl !== undefined) throw new TaskControlAbort(session.requestedControl);
  }

  async reportTaskUiEffectResult(
    wc: WebContents,
    operationId: string,
    result: import('../../shared/ipc/index.js').TaskUiEffectResultDto,
  ): Promise<void> {
    const repository = this.#deps.taskRuns;
    if (repository === undefined) return;
    const run = await repository.get(result.taskRunId);
    if (run === null) throw new Error('任务运行不存在');
    const activities = await repository.listEvents(result.taskRunId);
    const source = activities.find(
      (event): event is TaskActivityEvent => event.type === 'task-activity' && event.activityId === result.activityId,
    );
    const effect = source?.uiEffects?.find((candidate) => candidate.effectId === result.effectId);
    if (effect === undefined || effect.kind !== result.effectKind) throw new Error('UI Effect 不属于该任务活动');
    const now = new Date().toISOString();
    const workflowRef = run.refs.workflowId === null || run.refs.workflowStageId === null
      ? undefined
      : {
          workflowId: run.refs.workflowId,
          stageId: run.refs.workflowStageId,
          ...(run.refs.issueId === null ? {} : { issueId: run.refs.issueId }),
        };
    const event = {
      taskRunId: result.taskRunId,
      taskId: `locate-source:${run.refs.issueId ?? result.taskRunId}`,
      kind: 'locate-source' as const,
      runId: run.refs.executionRunId as RunId,
      ...(workflowRef === undefined ? {} : { workflowRef }),
      ...(run.refs.issueId === null ? {} : { issueId: run.refs.issueId }),
      type: 'task-activity' as const,
      activityId: randomUUID(),
      status: run.status,
      phase: 'ui-effect' as const,
      title: result.status === 'applied' ? '工作区已更新' : '工作区更新未完成',
      message: result.message,
      feedback: result.status === 'applied' ? 'Renderer 已确认实际执行成功' : '任务产物已保留，正文没有因此被修改',
      ...(result.status === 'failed' ? { nextAction: '可重新打开任务中心并再次定位原文' } : {}),
      uiEffectResult: result,
      createdAt: now,
    } satisfies TaskActivityEvent;
    const inserted = await repository.appendEventForOperation(
      event,
      operationId,
      `task-run:${result.taskRunId}:ui-effect:${result.effectId}`,
    );
    if (inserted) wc.send(IPC_CHANNELS.taskActivityEvent, event);
  }

  /**
   * 3.4：作者在右栏助手补充的约束 → 落库为当前任务的新输入，并进入活动流。
   * 约束仅追加到 `inputs.authorSupplements`（作者可审计输入，绝不改写既有输入/隐藏思维链），
   * 并下发一条 `input` 阶段活动。经 `appendEventForOperation` 幂等去重；任务终态则拒绝补充。
   * 会话无关（重连后仍可补充）：不依赖 in-memory session，直接读写持久化 TaskRun。
   */
  async supplementTaskInput(
    wc: WebContents,
    taskRunId: string,
    constraint: string,
    operationId: string,
  ): Promise<void> {
    const repository = this.#deps.taskRuns;
    if (repository === undefined) throw new Error('任务运行仓储尚未就绪');
    const trimmed = constraint.trim();
    if (trimmed.length === 0) throw new Error('补充约束不能为空');
    const run = await repository.get(taskRunId);
    if (run === null) throw new Error('任务运行不存在');
    if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
      throw new Error('任务已结束，无法追加补充约束');
    }
    const now = new Date().toISOString();
    const priorSupplements = Array.isArray(run.inputs['authorSupplements'])
      ? (run.inputs['authorSupplements'] as ReadonlyArray<unknown>).filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      : [];
    const nextRun: TaskRun = {
      ...run,
      inputs: {
        ...run.inputs,
        authorSupplements: [...priorSupplements, { text: trimmed, addedAt: now }],
      },
    };
    const kind = ipcTaskKindFor(run.refs.playbookId, run.kind);
    const workflowRef = run.refs.workflowId === null || run.refs.workflowStageId === null
      ? undefined
      : {
          workflowId: run.refs.workflowId,
          stageId: run.refs.workflowStageId,
          ...(run.refs.issueId === null ? {} : { issueId: run.refs.issueId }),
        };
    const event = {
      taskRunId,
      taskId: `${kind}:${run.refs.issueId ?? taskRunId}`,
      kind,
      runId: run.refs.executionRunId as RunId,
      ...(workflowRef === undefined ? {} : { workflowRef }),
      ...(run.refs.issueId === null ? {} : { issueId: run.refs.issueId }),
      type: 'task-activity' as const,
      activityId: randomUUID(),
      status: run.status,
      phase: 'input' as const,
      title: '作者补充约束',
      message: `已收到你的补充约束，将作为当前任务的新输入：${trimmed}`,
      inputSummary: trimmed,
      feedback: '补充约束已加入任务输入，后续步骤会据此执行',
      createdAt: now,
    } satisfies TaskActivityEvent;
    const inserted = await repository.appendEventForOperation(
      event,
      operationId,
      `task-run:${taskRunId}:supplement`,
    );
    if (!inserted) return; // 重复 operationId：已收敛。
    await repository.save(nextRun);
    const session = this.#taskSessions.get(taskRunId);
    if (session !== undefined) session.run = nextRun;
    wc.send(IPC_CHANNELS.taskActivityEvent, event);
  }

  async chooseSourceLocationCommand(
    wc: WebContents,
    taskRunId: string,
    candidateId: string,
    operationId: string,
  ): Promise<void> {
    try {
      await this.chooseSourceLocation(wc, taskRunId, candidateId, operationId);
    } catch (error) {
      const run = await this.#deps.taskRuns?.get(taskRunId);
      if (run === null || run === undefined) return;
      const workflowRef = run.refs.workflowId === null || run.refs.workflowStageId === null
        ? undefined
        : {
            workflowId: run.refs.workflowId,
            stageId: run.refs.workflowStageId,
            ...(run.refs.issueId === null ? {} : { issueId: run.refs.issueId }),
          };
      const event = {
        taskRunId,
        taskId: `locate-source:${run.refs.issueId ?? taskRunId}`,
        kind: 'locate-source' as const,
        runId: run.refs.executionRunId as RunId,
        ...(workflowRef === undefined ? {} : { workflowRef }),
        ...(run.refs.issueId === null ? {} : { issueId: run.refs.issueId }),
        type: 'task-activity' as const,
        activityId: randomUUID(),
        status: run.status,
        phase: 'failed' as const,
        title: '原文位置确认未完成',
        message: error instanceof Error ? error.message : String(error),
        feedback: '任务状态和候选已保留，没有修改正文',
        nextAction: '刷新任务中心后重新选择仍待确认的候选',
        createdAt: new Date().toISOString(),
      } satisfies TaskActivityEvent;
      await this.#deps.taskRuns?.appendEvent(event);
      wc.send(IPC_CHANNELS.taskActivityEvent, event);
    }
  }

  async chooseSourceLocation(
    wc: WebContents,
    taskRunId: string,
    candidateId: string,
    operationId: string,
  ): Promise<void> {
    const repository = this.#deps.taskRuns;
    if (repository === undefined) throw new Error('任务运行仓储尚未就绪');
    const persisted = await repository.get(taskRunId);
    const priorCandidate = await repository.getSelectedCandidateOperation(taskRunId, candidateId, operationId);
    if (priorCandidate !== null && persisted?.status === 'completed') return;
    if (persisted === null || persisted.status !== 'awaiting-author') throw new Error('原文定位任务不在等待确认状态');
    const workflowId = persisted.refs.workflowId;
    const stageId = persisted.refs.workflowStageId;
    const issueId = persisted.refs.issueId;
    if (workflowId === null || stageId === null || issueId === null) throw new Error('原文定位任务缺少工作流归属');
    const workflowRef = { workflowId, stageId, issueId };
    await this.#assertWorkflowRef(workflowRef, undefined, true);
    const selected = await repository.selectCandidate(taskRunId, candidateId, operationId);
    const candidate = selected.candidate;
    const chapterId = typeof candidate.payload['chapterId'] === 'string' ? candidate.payload['chapterId'] : undefined;
    const from = typeof candidate.payload['from'] === 'number' ? candidate.payload['from'] : undefined;
    const to = typeof candidate.payload['to'] === 'number' ? candidate.payload['to'] : undefined;
    const quote = typeof candidate.payload['quote'] === 'string' ? candidate.payload['quote'] : undefined;
    if (chapterId === undefined || from === undefined || to === undefined || quote === undefined) throw new Error('原文定位候选数据已失效');
    const executionRunId = persisted.refs.executionRunId as RunId;
    const stageRun = this.#runs.get(executionRunId) ?? this.#startUtilityRun(wc, executionRunId, workflowRef);
    const ref = this.#taskRef(executionRunId, workflowRef, taskRunId, chapterId);
    const session = this.#taskSessions.get(taskRunId) ?? {
      run: persisted,
      ref,
      wc,
      lastActivityAt: Date.now(),
    };
    session.wc = wc;
    session.ref = ref;
    this.#taskSessions.set(taskRunId, session);
    const decidedAt = new Date().toISOString();
    const resumed = transitionTaskRun({
      ...persisted,
      authorDecisions: [...persisted.authorDecisions, {
        id: randomUUID(),
        stepId: 'confirm-location',
        prompt: '请选择诊断问题对应的正确原文位置',
        decision: { candidateId },
        decidedAt,
      }],
    }, { status: 'running', occurredAt: decidedAt });
    await this.#saveTaskRun(session, resumed);
    await this.#publishTaskActivity(session, {
      status: 'running', phase: 'validation', title: '确认原文位置',
      message: '已收到作者选择，正在验证候选归属并更新正文工作区',
      inputSummary: candidate.label,
      nextAction: '切换章节、滚动并高亮已确认的原文',
    });
    await this.#completeLocatedSource(session, stageRun, workflowRef, { from, to, quote }, 'author');
    this.#runs.delete(executionRunId);
  }

  /**
   * 作者控制持久化任务运行：暂停、恢复或取消。
   * MUST：不只改 DB 状态，而是真正协作中断当前运行；恢复复用同一 taskRunId，不新建第二条。
   * operation 幂等：重复同一 operationId 不重复收敛状态。
   */
  async controlTaskRun(
    wc: WebContents,
    taskRunId: string,
    action: 'pause' | 'resume' | 'cancel',
    operationId: string,
  ): Promise<void> {
    try {
      await this.#controlTaskRun(wc, taskRunId, action, operationId);
    } catch (error) {
      const run = await this.#deps.taskRuns?.get(taskRunId);
      if (run === null || run === undefined) return;
      const event = {
        ...this.#refFromRun(run),
        type: 'task-activity' as const,
        activityId: randomUUID(),
        status: run.status,
        phase: 'failed' as const,
        title: '任务控制未完成',
        message: error instanceof Error ? error.message : String(error),
        feedback: '任务状态未变更，没有修改正文',
        nextAction: '刷新任务中心后重试暂停、恢复或取消',
        createdAt: new Date().toISOString(),
      } satisfies TaskActivityEvent;
      await this.#deps.taskRuns?.appendEvent(event);
      wc.send(IPC_CHANNELS.taskActivityEvent, event);
    }
  }

  async #controlTaskRun(
    wc: WebContents,
    taskRunId: string,
    action: 'pause' | 'resume' | 'cancel',
    operationId: string,
  ): Promise<void> {
    const repository = this.#deps.taskRuns;
    if (repository === undefined) throw new Error('任务运行仓储尚未就绪');
    const scope = `task-run:${taskRunId}:control:${action}`;
    const persisted = await repository.get(taskRunId);
    if (persisted === null) throw new Error('任务运行不存在');
    const session = this.#taskSessions.get(taskRunId);

    if (action === 'pause') {
      // 已处于终态/已暂停：幂等返回。
      if (persisted.status === 'paused' || persisted.status === 'completed' || persisted.status === 'cancelled' || persisted.status === 'failed') return;
      if (session !== undefined && session.execution !== undefined && persisted.status === 'running') {
        // 运行中：记录控制请求并中断执行，在安全步骤边界收敛为 paused。
        session.requestedControl = 'pause';
        session.execution.controller.abort();
        return;
      }
      // awaiting-author：可立即持久化为 paused。
      await this.#persistControlTransition(wc, repository, persisted, session, 'paused', operationId, scope, {
        title: '任务已暂停',
        message: '已暂停原文定位，候选与输入已保留，正文未发生修改',
        nextAction: '可随时恢复或取消本任务',
      });
      return;
    }

    if (action === 'cancel') {
      if (persisted.status === 'completed' || persisted.status === 'cancelled' || persisted.status === 'failed') return;
      if (session !== undefined && session.execution !== undefined && persisted.status === 'running') {
        session.requestedControl = 'cancel';
        session.execution.controller.abort();
        return;
      }
      await this.#persistControlTransition(wc, repository, persisted, session, 'cancelled', operationId, scope, {
        title: '任务已取消',
        message: '已取消原文定位任务，正文未发生修改',
        nextAction: '如需重新定位，可在任务中心重新发起原文定位',
      });
      return;
    }

    // resume：仅允许从 paused 恢复；复用同一 taskRunId 与持久输入，从当前阶段重新执行。
    if (persisted.status !== 'paused') {
      if (persisted.status === 'running' || persisted.status === 'awaiting-author') return; // 已在进行/等待，幂等。
      throw new Error('任务不处于已暂停状态，无法恢复');
    }
    if (persisted.refs.playbookId === 'legacy.locate-source') {
      await this.#resumeLocateSource(wc, persisted);
    } else {
      await this.#resumePlaybookRun(wc, persisted);
    }
  }

  /** 将等待作者/无活跃执行的任务幂等收敛为 paused/cancelled。 */
  async #persistControlTransition(
    wc: WebContents,
    repository: TaskRunRepository,
    persisted: TaskRun,
    session: TaskRuntimeSession | undefined,
    target: 'paused' | 'cancelled',
    operationId: string,
    scope: string,
    copy: { readonly title: string; readonly message: string; readonly nextAction: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const nextRun = transitionTaskRun(persisted, { status: target, occurredAt: now });
    const ref = this.#refFromRun(persisted);
    const event = {
      ...ref,
      type: 'task-activity' as const,
      activityId: randomUUID(),
      status: target,
      phase: target === 'paused' ? 'paused' as const : 'cancelled' as const,
      title: copy.title,
      message: copy.message,
      feedback: '任务输入与已完成步骤已保留',
      nextAction: copy.nextAction,
      createdAt: now,
    } satisfies TaskActivityEvent;
    const inserted = await repository.appendEventForOperation(event, operationId, scope);
    if (!inserted) return; // 重复 operationId：已收敛，不重复。
    await repository.save(nextRun);
    if (session !== undefined) {
      session.run = nextRun;
      if (target === 'cancelled') this.#closeTaskSession(session);
      else if (session.heartbeat !== undefined) { clearInterval(session.heartbeat); delete session.heartbeat; }
    }
    wc.send(IPC_CHANNELS.taskActivityEvent, event);
  }

  /** 从 paused 恢复原文定位：复用同一 taskRunId、持久输入、工作流归属，重新确定性执行。 */
  async #resumeLocateSource(wc: WebContents, persisted: TaskRun): Promise<void> {
    const workflowId = persisted.refs.workflowId;
    const stageId = persisted.refs.workflowStageId;
    const issueId = persisted.refs.issueId;
    if (workflowId === null || stageId === null || issueId === null) throw new Error('原文定位任务缺少工作流归属');
    const workflowRef = { workflowId, stageId, issueId };
    await this.#assertWorkflowRef(workflowRef, undefined, true);
    const inputs = persisted.inputs as Readonly<Record<string, unknown>>;
    const evidence = inputs['evidence'] as import('../../core/story-bible/index.js').IssueEvidence | undefined;
    const chapterId = typeof inputs['chapterAnchor'] === 'string' ? inputs['chapterAnchor'] : undefined;
    if (evidence === undefined || chapterId === undefined) throw new Error('原文定位输入已失效，无法恢复');
    const executionRunId = persisted.refs.executionRunId as RunId;
    const run = this.#runs.get(executionRunId) ?? this.#startUtilityRun(wc, executionRunId, workflowRef);
    const ref = this.#taskRef(executionRunId, workflowRef, persisted.id, chapterId);
    const session: TaskRuntimeSession = this.#taskSessions.get(persisted.id) ?? { run: persisted, ref, wc, lastActivityAt: Date.now() };
    session.wc = wc;
    session.ref = ref;
    session.execution = run;
    delete session.requestedControl;
    this.#taskSessions.set(persisted.id, session);
    const resumedAt = new Date().toISOString();
    const resumedRun = transitionTaskRun(persisted, { status: 'running', occurredAt: resumedAt });
    // Restart heartbeat on the resumed session.
    session.run = resumedRun;
    await this.#deps.taskRuns?.save(resumedRun);
    this.#startTaskHeartbeat(session, '定位原文', { step: '重新匹配诊断证据', currentObject: `目标章节“${chapterId}”`, recentSubStep: '已从暂停点恢复任务' });
    await this.#publishTaskActivity(session, {
      status: 'running', phase: 'validation', title: '恢复定位原文',
      message: '已从暂停点恢复，正在重新匹配诊断证据',
      inputSummary: '持久化的诊断问题、证据引文与章节锚点',
      nextAction: '重新验证引文前后文，排除重复位置',
    });
    try {
      const chapter = await (this.#deps.manuscript?.readChapterContent ?? readChapterContent)(chapterId);
      this.#assertNotControlled(session);
      const awaitingAuthor = await this.#matchAndResolveSource(session, run, workflowRef, chapterId, chapter.content, evidence);
      if (!awaitingAuthor) this.#runs.delete(executionRunId);
    } catch (error) {
      const controlIntent = error instanceof TaskControlAbort ? error.intent : (session.requestedControl ?? undefined);
      if (controlIntent === 'pause') {
        await this.#pauseTaskSession(session, run);
      } else {
        await this.#failLocateSource(wc, ref, session, run, error, controlIntent === 'cancel');
        this.#runs.delete(executionRunId);
      }
    }
  }

  // ===========================================================================
  // 通用 playbook 执行引擎（task 2.1）：任意 kind（legacy-book/new-book/temporary）
  // 复用同一 Task Runtime。生产不注册 model-backed 执行器，仅提供能力；真实模型
  // 接入是后续 Phase。这里只负责状态收敛、产物持久化、作者决策与暂停恢复的幂等。
  // ===========================================================================

  /** 从注册的 playbook 起一次通用任务运行（queued→running→…→completed）。 */
  async runPlaybookTask(wc: WebContents, options: RunPlaybookTaskOptions): Promise<void> {
    const repository = this.#deps.taskRuns;
    if (repository === undefined) throw new Error('任务运行仓储尚未就绪');
    const { registration, taskRunId } = options;
    const playbook = registration.playbook;
    const executionRunId = randomUUID() as RunId;
    const run = this.#startUtilityRun(wc, executionRunId);
    const now = new Date().toISOString();
    const queued = createTaskRunFromPlaybook(playbook, {
      id: taskRunId,
      executionRunId,
      inputs: options.inputs,
      now,
      ...(options.refs === undefined ? {} : { refs: options.refs }),
    });
    if (!taskRunHasRequiredInputs(playbook, queued)) {
      const missing = playbook.inputs
        .filter((input) => input.required && queued.inputs[input.key] === undefined)
        .map((input) => input.label)
        .join('、');
      run.controller.abort();
      this.#runs.delete(executionRunId);
      const ref = this.#refFromRun(queued);
      await this.#failPlaybookRun(wc, ref, undefined, queued, new Error(`缺少必填输入：${missing}`), false);
      return;
    }
    await repository.create(queued);
    const running = transitionTaskRun(queued, { status: 'running', occurredAt: now });
    await repository.save(running);
    const ref = this.#refFromRun(running);
    const session: TaskRuntimeSession = { run: running, ref, wc, lastActivityAt: Date.now(), execution: run };
    this.#taskSessions.set(taskRunId, session);
    this.#startTaskHeartbeat(session, registration.title, { step: registration.title, currentObject: playbook.title, recentSubStep: '已接收任务输入' });
    let keepAlive = false;
    try {
      await this.#publishTaskActivity(session, {
        status: 'running', phase: 'input', title: registration.title,
        message: `已接收「${playbook.title}」的任务输入，开始执行`,
        inputSummary: playbook.inputs.map((input) => input.label).join('、') || '无显式输入',
      });
      await this.#advancePlaybook(session, registration, 0);
      keepAlive = session.run.status === 'awaiting-author' || session.run.status === 'paused';
    } catch (error) {
      const controlIntent = error instanceof TaskControlAbort ? error.intent : (session.requestedControl ?? undefined);
      if (controlIntent === 'pause') {
        keepAlive = await this.#pauseTaskSession(session, run);
      } else {
        await this.#failPlaybookRun(wc, ref, session, running, error, controlIntent === 'cancel');
      }
    } finally {
      if (!keepAlive) this.#runs.delete(executionRunId);
    }
  }

  /** 从 fromIndex 起逐步执行；遇作者决策步进入 awaiting-author 并返回，等作者提交后再续。 */
  async #advancePlaybook(
    session: TaskRuntimeSession,
    registration: PlaybookRegistration,
    fromIndex: number,
  ): Promise<void> {
    const playbook = registration.playbook;
    for (let i = fromIndex; i < playbook.steps.length; i += 1) {
      this.#assertNotControlled(session);
      const step = playbook.steps[i];
      if (step === undefined) throw new Error('playbook 步骤越界');
      const now = new Date().toISOString();
      const positioned = positionTaskRunAtStep(session.run, playbook, step.id, now);
      await this.#saveTaskRun(session, positioned);
      const handler = registration.handlers[step.id];
      if (handler === undefined) throw new Error(`playbook「${playbook.id}」缺少步骤「${step.id}」的执行器`);
      session.heartbeatState = { step: step.title, currentObject: playbook.title, recentSubStep: `进入步骤「${step.title}」` };
      const ctx: PlaybookStepContext = {
        run: session.run,
        stepId: step.id,
        inputs: session.run.inputs,
        signal: (session.execution ?? this.#runs.get(session.ref.runId))?.controller.signal ?? new AbortController().signal,
      };
      if (handler.requiresAuthor === true) {
        const prompt = await handler.prompt(ctx);
        this.#assertNotControlled(session);
        const awaitingAt = new Date().toISOString();
        const awaiting = transitionTaskRun(session.run, { status: 'awaiting-author', occurredAt: awaitingAt });
        await this.#saveTaskRun(session, awaiting);
        await this.#publishTaskActivity(session, {
          status: 'awaiting-author', phase: 'awaiting-author', title: step.title,
          message: prompt.message,
          nextAction: prompt.nextAction,
        });
        return; // 等待作者决策，由 submitPlaybookAuthorDecision 续跑。
      }
      const output = await handler.run(ctx);
      this.#assertNotControlled(session);
      await this.#recordStepOutput(session, registration, i, output);
    }
    await this.#completePlaybookRun(session, registration);
  }

  /** 记录单步产出：持久化产物、推进游标到下一步、下发 output 活动。 */
  async #recordStepOutput(
    session: TaskRuntimeSession,
    registration: PlaybookRegistration,
    index: number,
    output: PlaybookStepOutput,
  ): Promise<void> {
    const playbook = registration.playbook;
    const now = new Date().toISOString();
    const newArtifacts: TaskRunArtifact[] = (output.artifacts ?? []).map((artifact) => ({
      id: randomUUID(),
      outputKey: artifact.outputKey,
      value: artifact.value,
      createdAt: now,
    }));
    const artifactRefs = (output.artifacts ?? []).map((artifact) => artifact.ref);
    const nextStep = playbook.steps[index + 1];
    const advanced: TaskRun = {
      ...session.run,
      artifacts: [...session.run.artifacts, ...newArtifacts],
      currentStepId: nextStep === undefined ? null : nextStep.id,
      currentStepIndex: nextStep === undefined ? null : index + 1,
      timestamps: { ...session.run.timestamps, updatedAt: now },
    };
    await this.#saveTaskRun(session, advanced);
    await this.#publishTaskActivity(session, {
      status: 'running', phase: 'output', title: playbook.steps[index]?.title ?? registration.title,
      message: output.message,
      ...(output.outputSummary === undefined ? {} : { outputSummary: output.outputSummary }),
      ...(artifactRefs.length === 0 ? {} : { artifactRefs }),
      ...(output.modelAudit === undefined ? {} : { modelAudit: sanitizeModelAudit(output.modelAudit) }),
    });
  }

  /** 全部步骤完成：收敛 completed、清游标、发完成事件并关闭会话。 */
  async #completePlaybookRun(session: TaskRuntimeSession, registration: PlaybookRegistration): Promise<void> {
    const now = new Date().toISOString();
    const completed = transitionTaskRun({
      ...session.run,
      currentStepId: null,
      currentStepIndex: null,
    }, { status: 'completed', occurredAt: now });
    await this.#saveTaskRun(session, completed);
    await this.#publishTaskEvent(session, {
      ...session.ref,
      type: 'task-run-completed', status: 'completed', title: `${registration.title}完成`,
      summary: registration.completedSummary,
      completedAt: now,
    } satisfies TaskRunCompletedEvent);
    this.#closeTaskSession(session);
    this.#runs.delete(session.ref.runId);
  }

  /** 将失败或取消收敛为 failed/cancelled，并下发作者可读恢复信息。 */
  async #failPlaybookRun(
    wc: WebContents,
    ref: TaskRunRefDto,
    session: TaskRuntimeSession | undefined,
    _run: TaskRun,
    error: unknown,
    cancelled: boolean,
  ): Promise<void> {
    const failedAt = new Date().toISOString();
    const failedEvent = {
      ...ref,
      type: 'task-run-failed', status: cancelled ? 'cancelled' : 'failed',
      title: cancelled ? '任务已取消' : '任务未完成',
      error: {
        category: cancelled ? 'aborted' as const : 'internal' as const,
        message: cancelled ? '作者已取消当前任务' : (error instanceof Error ? error.message : String(error)),
        recovery: cancelled ? '如需继续，可在任务中心重新发起该任务' : '检查任务输入后重新发起，正文未发生修改',
      },
      failedAt,
    } satisfies TaskRunFailedEvent;
    if (session === undefined) {
      // 未创建持久记录（如缺必填输入）：只下发可读失败，不写 task_activities（无父行）。
      wc.send(IPC_CHANNELS.taskActivityEvent, failedEvent);
    } else {
      const failedRun = transitionTaskRun(session.run, {
        status: cancelled ? 'cancelled' : 'failed',
        occurredAt: failedAt,
        ...(cancelled ? {} : { failure: { code: 'playbook-task-failed', message: failedEvent.error.message } }),
      });
      await this.#saveTaskRun(session, failedRun);
      await this.#publishTaskEvent(session, failedEvent);
      this.#closeTaskSession(session);
    }
  }

  /** 作者提交决策 command 入口：捕获异常并下发可读失败活动而不抛给 IPC。 */
  async submitPlaybookAuthorDecision(
    wc: WebContents,
    taskRunId: string,
    stepId: string,
    decision: unknown,
    operationId: string,
  ): Promise<void> {
    try {
      await this.#submitPlaybookAuthorDecision(wc, taskRunId, stepId, decision, operationId);
    } catch (error) {
      const run = await this.#deps.taskRuns?.get(taskRunId);
      if (run === null || run === undefined) return;
      const event = {
        ...this.#refFromRun(run),
        type: 'task-activity' as const,
        activityId: randomUUID(),
        status: run.status,
        phase: 'failed' as const,
        title: '任务决策未完成',
        message: error instanceof Error ? error.message : String(error),
        feedback: '任务状态和已完成步骤已保留，没有修改正文',
        nextAction: '刷新任务中心后重新提交决策',
        createdAt: new Date().toISOString(),
      } satisfies TaskActivityEvent;
      await this.#deps.taskRuns?.appendEvent(event);
      wc.send(IPC_CHANNELS.taskActivityEvent, event);
    }
  }

  async #submitPlaybookAuthorDecision(
    wc: WebContents,
    taskRunId: string,
    stepId: string,
    decision: unknown,
    operationId: string,
  ): Promise<void> {
    const repository = this.#deps.taskRuns;
    if (repository === undefined) throw new Error('任务运行仓储尚未就绪');
    const persisted = await repository.get(taskRunId);
    if (persisted === null) throw new Error('任务运行不存在');
    const registration = this.#playbooks.get(persisted.refs.playbookId);
    if (registration === undefined) throw new Error('任务对应的 playbook 未注册');
    // 幂等：已完成且该步决策已录 → 直接返回。
    if (persisted.status === 'completed' && persisted.authorDecisions.some((d) => d.stepId === stepId)) return;
    if (persisted.status !== 'awaiting-author') throw new Error('任务不在等待作者决策状态');
    const playbook = registration.playbook;
    const stepIndex = playbook.steps.findIndex((step) => step.id === stepId);
    if (stepIndex === -1) throw new Error('决策步骤不属于该任务');
    const handler = registration.handlers[stepId];
    if (handler === undefined || handler.requiresAuthor !== true) throw new Error('该步骤不接受作者决策');
    const executionRunId = persisted.refs.executionRunId as RunId;
    const run = this.#runs.get(executionRunId) ?? this.#startUtilityRun(wc, executionRunId);
    const ref = this.#refFromRun(persisted);
    const session: TaskRuntimeSession = this.#taskSessions.get(taskRunId) ?? { run: persisted, ref, wc, lastActivityAt: Date.now() };
    session.wc = wc;
    session.ref = ref;
    session.execution = run;
    delete session.requestedControl;
    this.#taskSessions.set(taskRunId, session);
    const decidedAt = new Date().toISOString();
    const withDecision: TaskRun = {
      ...persisted,
      authorDecisions: [...persisted.authorDecisions, {
        id: randomUUID(),
        stepId,
        prompt: playbook.steps[stepIndex]?.title ?? stepId,
        decision,
        decidedAt,
      }],
    };
    const resumed = transitionTaskRun(withDecision, { status: 'running', occurredAt: decidedAt });
    const receivedEvent = {
      ...ref,
      type: 'task-activity' as const,
      activityId: randomUUID(),
      status: 'running' as const,
      phase: 'validation' as const,
      title: playbook.steps[stepIndex]?.title ?? '作者决策',
      message: '已收到作者决策，正在据此产出结果',
      createdAt: decidedAt,
    } satisfies TaskActivityEvent;
    const inserted = await repository.appendEventForOperation(
      receivedEvent,
      operationId,
      `task-run:${taskRunId}:author-decision:${stepId}`,
    );
    if (!inserted) return; // 重复 operationId：已收敛。
    await this.#saveTaskRun(session, resumed);
    session.wc.send(IPC_CHANNELS.taskActivityEvent, receivedEvent);
    session.lastActivityAt = Date.now();
    this.#startTaskHeartbeat(session, registration.title, { step: playbook.steps[stepIndex]?.title ?? stepId, currentObject: playbook.title, recentSubStep: '已收到作者决策' });
    let keepAlive = false;
    try {
      const ctx: PlaybookStepContext = { run: session.run, stepId, inputs: session.run.inputs, signal: run.controller.signal };
      const output = await handler.apply(ctx, decision);
      this.#assertNotControlled(session);
      await this.#recordStepOutput(session, registration, stepIndex, output);
      await this.#advancePlaybook(session, registration, stepIndex + 1);
      keepAlive = session.run.status === 'awaiting-author' || session.run.status === 'paused';
    } catch (error) {
      const controlIntent = error instanceof TaskControlAbort ? error.intent : (session.requestedControl ?? undefined);
      if (controlIntent === 'pause') {
        keepAlive = await this.#pauseTaskSession(session, run);
      } else {
        await this.#failPlaybookRun(wc, ref, session, resumed, error, controlIntent === 'cancel');
      }
    } finally {
      if (!keepAlive) this.#runs.delete(executionRunId);
    }
  }

  /** 从 paused 恢复通用任务：复用同一 taskRunId，从 currentStepIndex 续跑。 */
  async #resumePlaybookRun(wc: WebContents, persisted: TaskRun): Promise<void> {
    const registration = this.#playbooks.get(persisted.refs.playbookId);
    if (registration === undefined) throw new Error('任务对应的 playbook 未注册');
    if (!taskRunHasRequiredInputs(registration.playbook, persisted)) throw new Error('任务输入已失效，无法恢复');
    const executionRunId = persisted.refs.executionRunId as RunId;
    const run = this.#runs.get(executionRunId) ?? this.#startUtilityRun(wc, executionRunId);
    const ref = this.#refFromRun(persisted);
    const session: TaskRuntimeSession = this.#taskSessions.get(persisted.id) ?? { run: persisted, ref, wc, lastActivityAt: Date.now() };
    session.wc = wc;
    session.ref = ref;
    session.execution = run;
    delete session.requestedControl;
    this.#taskSessions.set(persisted.id, session);
    const resumedAt = new Date().toISOString();
    const resumed = transitionTaskRun(persisted, { status: 'running', occurredAt: resumedAt });
    await this.#saveTaskRun(session, resumed);
    this.#startTaskHeartbeat(session, registration.title, { step: registration.title, currentObject: registration.playbook.title, recentSubStep: '已从暂停点恢复任务' });
    let keepAlive = false;
    try {
      await this.#publishTaskActivity(session, {
        status: 'running', phase: 'validation', title: `恢复${registration.title}`,
        message: '已从暂停点恢复，正在继续未完成的步骤',
        nextAction: '继续执行剩余步骤',
      });
      await this.#advancePlaybook(session, registration, persisted.currentStepIndex ?? 0);
      keepAlive = session.run.status === 'awaiting-author' || session.run.status === 'paused';
    } catch (error) {
      const controlIntent = error instanceof TaskControlAbort ? error.intent : (session.requestedControl ?? undefined);
      if (controlIntent === 'pause') {
        keepAlive = await this.#pauseTaskSession(session, run);
      } else {
        await this.#failPlaybookRun(wc, ref, session, resumed, error, controlIntent === 'cancel');
      }
    } finally {
      if (!keepAlive) this.#runs.delete(executionRunId);
    }
  }

  /** 通用心跳：>2s 无活动且仍在运行时下发 heartbeat 活动，携带结构化真实进展，避免让作者以为产品卡死。 */
  #startTaskHeartbeat(
    session: TaskRuntimeSession,
    title: string,
    state: TaskHeartbeatDto,
  ): void {
    session.heartbeatState = state;
    if (session.heartbeat !== undefined) return;
    session.heartbeat = setInterval(() => {
      if (session.run.status !== 'running' || Date.now() - session.lastActivityAt < 2_000) return;
      const activity = this.#buildHeartbeatActivity(title, session.heartbeatState);
      if (activity === undefined) return;
      void this.#publishTaskActivity(session, activity);
    }, 500);
  }

  /**
   * 计算一次局部重构 diff (I6 refactor-worker-runtime)。
   * Main 据锚点从磁盘正文裁出原片段（carveFragment）→ 经可注入 DiffRunner 派发（默认
   * utilityProcess，fork 不可用回退内联）计算最小差异 + hunk 拆分 → 经 refactor-diff-* 控制事件下发。
   * diff 属 CPU 密集，在 worker 算；Main 不阻塞。
   */
  async runTargetedVerification(
    wc: WebContents,
    runId: RunId,
    workflowRef: WorkflowRef & { readonly issueId: string },
  ): Promise<void> {
    const run = this.#startUtilityRun(wc, runId, workflowRef);
    let advancesTargetedStage = false;
    try {
      await this.#assertWorkflowRef(workflowRef, undefined, true);
      const workflow = await this.#deps.workflows?.get(workflowRef.workflowId);
      const currentStage = workflow?.stages.find((stage) => stage.stageId === workflowRef.stageId);
      advancesTargetedStage = currentStage?.templateStageId === 'targeted-verification';
      if (advancesTargetedStage) await this.#recordStageRun(run, 'started');
      const repository = this.#deps.workflowIssues;
      if (repository === undefined) throw new Error('workflow issue repository is unavailable');
      const issue = await repository.get(workflowRef.issueId);
      const payload = await repository.getPayload(workflowRef.issueId);
      if (issue === null || issue.status !== 'verifying') throw new Error('issue is not awaiting verification');
      if (payload === null) throw new Error('issue payload is unavailable; rerun audit before verification');
      const chapterAnchor = payload.anchors.find((anchor) => anchor.kind === 'chapter');
      if (chapterAnchor === undefined) throw new Error('targeted verification requires a chapter anchor');
      const chapter = await (this.#deps.manuscript?.readChapterContent ?? readChapterContent)(chapterAnchor.id);
      const resolver = this.#deps.getModelResolver();
      if (resolver === undefined) throw new Error('model resolver is unavailable');
      const verificationAgent = targetedVerificationAgentFor(payload.type);
      const adapter = resolver.createAdapter(verificationAgent, 'reasoning');
      const result = await adapter.complete({
        messages: [
          { role: 'system', content: '你是针对性复检员。只判断给定问题在当前正文中是否仍存在。若已修复，严格输出 []；若仍存在或出现等价冲突，输出 ConsistencyIssue JSON 数组。不得报告无关的新问题。' },
          { role: 'user', content: `【待复检问题】\n${JSON.stringify(payload)}\n\n【当前章节正文】\n${chapter.content}` },
        ],
        options: { signal: run.controller.signal, maxTokens: 2048 },
      });
      const findings = parseReviewerIssuesWithDiagnostics(result.text, '').issues.map((finding) => ({
        ...finding,
        anchors: finding.anchors.map((anchor) => anchor.kind === 'chapter' ? chapterAnchor : anchor),
      }));
      const passed = findings.length === 0;
      const evidenceRefs = passed
        ? [`checkpoint:${issue.checkpointIds.at(-1) ?? 'unknown'}`, `chapter:${chapterAnchor.id as string}`]
        : findings.flatMap((finding) => finding.anchors.map((anchor) => `${anchor.kind}:${anchor.id as string}`));
      const updated = await repository.recordVerificationAndTransition(
        workflowRef.issueId, runId, passed, !passed, evidenceRefs,
      );
      if (advancesTargetedStage) {
        await this.#recordStageRun(run, 'completed', undefined, {
          passed,
          issueIds: passed ? [] : [workflowRef.issueId],
          ...(passed ? {} : { transition: 'quality-failed' }),
        });
      }
      this.#sendControl(wc, {
        type: 'targeted-verification-completed', runId, workflowRef, passed,
        issue: toIssueDto(payload, updated),
        findings: findings.map((finding) => toIssueDto(finding)),
      });
      if (advancesTargetedStage) {
        const latest = await this.#deps.workflows?.get(workflowRef.workflowId);
        if (latest !== null && latest !== undefined) {
          this.#sendControl(wc, {
            type: 'workflow-snapshot', runId,
            snapshot: { ...latest, authorIntents: latest.authorIntents as import('../../shared/ipc/workflow-messages.js').AuthorIntentDto[], stages: latest.stages as unknown as ReadonlyArray<Record<string, unknown>> },
          });
        }
      }
    } catch (err) {
      if (advancesTargetedStage) {
        try {
          await this.#recordStageRun(run, 'failed', { reason: err instanceof Error ? err.message : String(err) });
        } catch {
          // Preserve the original verification failure; stale-stage errors are already represented by the snapshot.
        }
      }
      this.#sendControl(wc, {
        type: 'targeted-verification-failed', runId, workflowRef,
        error: {
          category: run.controller.signal.aborted ? 'aborted' : err instanceof Error && /unavailable/.test(err.message) ? 'io' : 'validation',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      this.#runs.delete(runId);
    }
  }

  async computeRefactorDiff(
    wc: WebContents,
    runId: RunId,
    anchor: FragmentAnchor,
    rewrittenFragment: string,
    workflowRef?: WorkflowRef,
  ): Promise<void> {
    const run = this.#startUtilityRun(wc, runId, workflowRef);
    try {
      if (workflowRef !== undefined) await this.#assertWorkflowRef(workflowRef, workflowRef.issueId === undefined ? undefined : runId, true);
      await this.#assertIssueAnchor(workflowRef, anchor.node.id as string);
      const chapter = await (this.#deps.manuscript?.readChapterContent ?? readChapterContent)(anchor.node.id);
      const fragment = carveFragment(chapter.content, anchor);
      if (fragment === null) {
        this.#sendControl(wc, {
          type: 'refactor-diff-failed',
          runId,
          ...(workflowRef !== undefined ? { workflowRef } : {}),
          error: { category: 'validation', message: '片段锚点越界或非法：无法裁出待修片段' },
        });
        return;
      }
      const runner = this.#deps.getDiffRunner?.() ?? new InlineDiffRunner();
      const result = await runner.run(fragment, rewrittenFragment, run.controller.signal);
      this.#fragmentBases.set(runId, { nodeId: anchor.node.id as string, from: anchor.from, to: anchor.to, hash: createHash('sha256').update(fragment.text).digest('hex') });
      this.#sendControl(wc, {
        type: 'refactor-diff-computed',
        runId,
        ...(workflowRef !== undefined ? { workflowRef } : {}),
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
        ...(workflowRef !== undefined ? { workflowRef } : {}),
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
    workflowRef?: WorkflowRef,
  ): Promise<void> {
    try {
      if (workflowRef !== undefined) await this.#assertWorkflowRef(workflowRef, workflowRef.issueId === undefined ? undefined : runId, true);
      await this.#assertIssueAnchor(workflowRef, anchor.node.id as string);
      const chapter = await (this.#deps.manuscript?.readChapterContent ?? readChapterContent)(anchor.node.id);
      const fragment = carveFragment(chapter.content, anchor);
      if (fragment === null) {
        this.#sendControl(wc, {
          type: 'refactor-apply-failed',
          runId,
          ...(workflowRef !== undefined ? { workflowRef } : {}),
          error: { category: 'validation', message: '片段锚点越界或非法：无法裁出待修片段' },
        });
        return;
      }
      const base = this.#fragmentBases.get(runId);
      const currentHash = createHash('sha256').update(fragment.text).digest('hex');
      if (base === undefined || base.nodeId !== anchor.node.id || base.from !== anchor.from || base.to !== anchor.to || base.hash !== currentHash) throw new Error('fragment base changed or was not previewed; recompute diff');
      // 确定性重算 DiffResult（无状态：同片段+同改写恒产同 hunk 序列），hunk 均有效。
      const diff = computeDiffResult(fragment, rewrittenFragment);
      const validity: Record<string, HunkValidity> = {};
      for (const h of diff.hunks) validity[h.id] = 'valid';

      const splice = spliceAcceptedHunks(diff, decisions, validity);
      if (!splice.ok) {
        this.#sendControl(wc, {
          type: 'refactor-apply-failed',
          runId,
          ...(workflowRef !== undefined ? { workflowRef } : {}),
          error: {
            category: 'validation',
            message: splice.reason === 'overlapping-hunks' ? '接受的 hunk 区间重叠，无法确定性拼回' : '存在失效 hunk，需重算',
          },
          hunkIds: splice.hunkIds,
        });
        return;
      }

      const acceptedHunkIds = decisions.filter((decision) => decision.decision === 'accept').map((decision) => decision.hunkId);
      if (workflowRef?.issueId !== undefined && acceptedHunkIds.length === 0) {
        this.#sendControl(wc, {
          type: 'refactor-apply-failed',
          runId,
          workflowRef,
          error: { category: 'validation', message: '未接受任何 hunk；问题仍处于 fixing，不能创建 checkpoint 或进入复检' },
        });
        return;
      }

      const writeback = await (this.#deps.manuscript?.writeBackRefactoredFragment ?? writeBackRefactoredFragment)(anchor, splice.fragmentText);
      if (!writeback.ok) {
        this.#sendControl(wc, {
          type: 'refactor-apply-failed',
          runId,
          ...(workflowRef !== undefined ? { workflowRef } : {}),
          error: {
            category: writeback.reason === 'io-error' ? 'io' : 'validation',
            message: `正文写回失败：${writeback.reason ?? 'unknown'}`,
          },
        });
        return;
      }

      // 变更作为可回滚步提交 checkpointer（与事实版本共用标识空间）。
      const checkpointer = this.#deps.getCheckpointer();
      let checkpointId: string | undefined;
      if (checkpointer !== undefined) {
        const state = this.#refactorCheckpointState(anchor.node.id, chapter.content, splice.fragmentText, anchor);
        const cp = await checkpointer.commit(`refactor:${anchor.node.id}`, state, null);
        checkpointId = cp.id as string;
      }
      if (workflowRef?.issueId !== undefined) {
        if (checkpointId === undefined) throw new Error('issue refactor requires a durable checkpoint');
        if (this.#deps.workflowIssues === undefined) throw new Error('workflow issue repository is unavailable');
        const issue = await this.#deps.workflowIssues.get(workflowRef.issueId);
        if (issue === null || issue.workflowId !== workflowRef.workflowId) {
          throw new Error('issue does not belong to workflow');
        }
        await this.#deps.workflowIssues.linkCheckpointAndMarkVerifying(workflowRef.issueId, checkpointId);
      }

      this.#fragmentBases.delete(runId);
      this.#sendControl(wc, {
        type: 'refactor-applied',
        runId,
        ...(workflowRef !== undefined ? { workflowRef } : {}),
        nodeId: anchor.node.id,
        acceptedHunkIds,
        ...(checkpointId !== undefined ? { checkpointId } : {}),
      });
    } catch (err) {
      this.#sendControl(wc, {
        type: 'refactor-apply-failed',
        runId,
        ...(workflowRef !== undefined ? { workflowRef } : {}),
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

  async #continueFactBackfill(
    run: ActiveRun,
    chapters: ReadonlyArray<ExtractionInput>,
    startOffset: number,
    resolver: ModelResolver,
    factStore: SqliteFactStore,
    modelTask: ModelTaskAttemptContext,
    supplement?: string,
  ): Promise<boolean> {
    for (let offset = startOffset; offset < chapters.length; offset += 1) {
      const chapter = chapters[offset];
      if (chapter === undefined) continue;
      const chapterId = chapter.location.id as string;
      if (run.controller.signal.aborted) throw new Error('事实补抽已中断');
      this.#sendControl(run.wc, {
        type: 'fact-extraction-started',
        runId: run.threadId,
        chapterId,
        textChars: chapter.text.length,
        index: offset + 1,
        total: chapters.length,
      });
      await this.#runFactExtractionPipeline(
        run.wc,
        run.threadId,
        chapter,
        resolver,
        factStore,
        run.controller.signal,
        { index: offset + 1, total: chapters.length },
        modelTask,
        supplement,
      );
      const task = Array.from(this.#factTasks.values()).find((item) => item.currentAttempt.runId === run.threadId);
      if (task !== undefined) task.currentOffset = offset;
      const pending = this.#pendingExtractionConflicts.get(run.threadId);
      if (pending !== undefined) {
        this.#pendingExtractionConflicts.set(run.threadId, {
          ...pending,
          backfill: { chapters, nextOffset: offset + 1 },
        });
        await this.#recordStageRun(run, 'interrupted', { reason: '事实抽取冲突等待作者裁决' });
        return false;
      }
    }
    return true;
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

    const run = this.#startUtilityRun(wc, params.runId, params.workflowRef);
    const modelTask = this.#createFactModelTask(params.runId, params.workflowRef);
    this.#factTasks.set(modelTask.taskId, {
      taskId: modelTask.taskId,
      wc,
      kind: 'backfill',
      inputs: params.chapters,
      ...(params.workflowRef === undefined ? {} : { workflowRef: params.workflowRef }),
      currentAttempt: modelTask,
      currentOffset: 0,
    });
    try {
      await this.#recordStageRun(run, 'started');
      const completed = await this.#continueFactBackfill(run, params.chapters, 0, resolver, factStore, modelTask);
      if (completed) {
        await this.#recordStageRun(run, 'completed');
        this.#completeModelTask(wc, modelTask, { chapters: params.chapters.length });
      }
    } catch (err) {
      this.#failModelTask(wc, modelTask, {
        category: run.controller.signal.aborted ? 'aborted' : 'model',
        message: err instanceof Error ? err.message : String(err),
      }, firstChapterId);
      await this.#recordStageRun(run, run.controller.signal.aborted ? 'interrupted' : 'failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
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
     workflowRef?: WorkflowRef,
   ): Promise<boolean> {
     const pending = this.#pendingExtractionConflicts.get(runId);
     if (pending === undefined) return false;
     const run = this.#runs.get(runId);
     if (run?.workflowRef !== undefined && workflowRef !== undefined && !sameWorkflowRef(run.workflowRef, workflowRef)) {
       this.#sendControl(wc, {
         type: 'fact-extraction-failed',
         runId,
         chapterId: pending.chapterId,
         error: { category: 'validation', message: '恢复被拒绝：workflowRef 与运行 ownership 不匹配' },
       });
       return true;
     }
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
     if (pending.backfill === undefined || run === undefined) {
       if (pending.modelTask !== undefined) {
         this.#sendModelTaskActivity(wc, pending.modelTask, 'completed', '冲突裁决已应用，事实任务完成', pending.chapterId, {
           conflicts: pending.conflicts.length,
         });
         this.#completeModelTask(wc, pending.modelTask, { conflicts: pending.conflicts.length }, pending.chapterId);
       }
       this.#runs.delete(runId);
       return true;
     }

     const resolver = this.#deps.getModelResolver();
     if (resolver === undefined) {
       if (pending.modelTask !== undefined) this.#failModelTask(wc, pending.modelTask, { category: 'io', message: '模型配置未就绪：无法继续事实补抽' }, pending.chapterId);
       await this.#recordStageRun(run, 'failed', { reason: '模型配置未就绪：无法继续事实补抽' });
       this.#runs.delete(runId);
       this.#sendControl(wc, {
         type: 'fact-extraction-failed',
         runId,
         chapterId: pending.chapterId,
         error: { category: 'io', message: '模型配置未就绪：无法继续事实补抽' },
       });
       return true;
     }

     try {
       await this.#recordStageRun(run, 'resumed');
       const completed = await this.#continueFactBackfill(
         run,
         pending.backfill.chapters,
         pending.backfill.nextOffset,
         resolver,
         factStore,
         pending.modelTask ?? this.#createFactModelTask(runId, run.workflowRef),
       );
       if (completed) {
         await this.#recordStageRun(run, 'completed');
         this.#runs.delete(runId);
       }
     } catch (err) {
       if (pending.modelTask !== undefined) this.#failModelTask(wc, pending.modelTask, {
         category: run.controller.signal.aborted ? 'aborted' : 'model',
         message: err instanceof Error ? err.message : String(err),
       }, pending.chapterId);
       await this.#recordStageRun(run, run.controller.signal.aborted ? 'interrupted' : 'failed', {
         reason: err instanceof Error ? err.message : String(err),
       });
       this.#runs.delete(runId);
       this.#sendControl(wc, {
         type: 'fact-extraction-failed',
         runId,
         chapterId: pending.chapterId,
         error: {
           category: run.controller.signal.aborted ? 'aborted' : 'model',
           message: err instanceof Error ? err.message : String(err),
         },
       });
     }
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

  async #resolveContinuationTarget(
    continuation: WorkflowContinuation,
    workflowRef: WorkflowRef | undefined,
  ): Promise<string | undefined> {
    switch (continuation.kind) {
      case 'resume-source-node': return continuation.sourceNode;
      case 'resume-stage':
        return workflowRef === undefined ? undefined :
          (await this.#deps.continuationRecords?.resolveStageTarget?.(
            workflowRef, continuation.targetTemplateStageId,
          )) ?? undefined;
      case 'resume-issue-fix': return 'editor';
      case 'resume-asset-maintenance': return 'writer';
    }
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
      let interruptSource = 'awaitDecision';

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
          this.#sendControl(wc, this.#withWorkflow(run, { type: 'graph-node-activated', runId, node: task.name, phase: 'enter' }));
        }
        if (Array.isArray(task.interrupts)) {
          interruptSource = task.name;
          interrupts.push(...task.interrupts as Array<{ value?: unknown }>);
        }
        if (task.result !== undefined) {
          this.#sendControl(wc, this.#withWorkflow(run, { type: 'graph-node-activated', runId, node: task.name, phase: 'exit' }));
        }
      }

      const state = latestState as { [INTERRUPT]?: Array<{ value?: unknown }> } | undefined;
      const pending = [...interrupts, ...(state?.[INTERRUPT] ?? [])].flatMap(
        (interrupt) => (interrupt.value ?? []) as ReadonlyArray<ConsistencyIssue>,
      );
      if (pending.length > 0) {
        // Persist before projecting events so every workflow review card carries its stable lifecycle identity.
        const projected = isReviewAgent
          ? await this.#projectReviewIssues(run, pending)
          : { dtos: pending.map((issue) => toIssueDto(issue)), issueIds: [] };
        // 挂起等待作者裁决：dialogue 轴结束一段，待裁决问题经 control-event 推强类型报告。
        this.#send(wc, this.#withWorkflow(run, { type: 'stream-end', runId, kind: 'dialogue', reason: 'completed' }));
        await this.#recordStageRun(run, 'interrupted', { sourceNode: interruptSource });
        if (isReviewAgent) {
          this.#sendControl(wc, this.#withWorkflow(run, {
            type: 'review-completed',
            runId,
            agent: run.assembly.agent,
            issues: projected.dtos,
          }));
        }
        if (run.workflowRef !== undefined && this.#deps.continuationRecords !== undefined) {
          await this.#deps.continuationRecords.save({
            interruptId: randomUUID(), scope: continuationScope(runId, run.workflowRef),
            sourceNode: interruptSource,
            continuation: run.workflowRef.issueId === undefined
              ? { kind: 'resume-source-node', sourceNode: run.assembly.agent }
              : { kind: 'resume-issue-fix', issueId: run.workflowRef.issueId },
            allowedDecisionKinds: ['approve', 'reject', 'correct', 'modify'],
            createdAt: new Date().toISOString(),
          });
        }
        this.#sendControl(wc, this.#withWorkflow(run, { type: 'interrupt-raised', runId, issues: projected.dtos }));
        return;
      }
      this.#send(wc, this.#withWorkflow(run, { type: 'stream-end', runId, kind: 'dialogue', reason: 'completed' }));
      const bugs = (latestState as { activeBugs?: ReadonlyArray<ConsistencyIssue> } | undefined)?.activeBugs ?? [];
      const projected = isReviewAgent
        ? await this.#projectReviewIssues(run, bugs)
        : { dtos: bugs.map((issue) => toIssueDto(issue)), issueIds: [] };
      await this.#recordStageRun(
        run,
        'completed',
        undefined,
        isReviewAgent ? { passed: bugs.length === 0, issueIds: projected.issueIds } : undefined,
      );
      // 审校类运行正常完成：若产出非空 activeBugs，经 control-event 下发结构化卡片清单。
      if (isReviewAgent) {
        if (bugs.length > 0) {
          this.#sendControl(wc, this.#withWorkflow(run, {
            type: 'review-completed',
            runId,
            agent: run.assembly.agent,
            issues: projected.dtos,
          }));
        }
      }
      this.#runs.delete(runId);
    } catch (err) {
      if (run.controller.signal.aborted) {
        this.#send(wc, this.#withWorkflow(run, { type: 'stream-end', runId, kind: 'dialogue', reason: 'aborted' }));
        await this.#recordStageRun(run, 'interrupted', { reason: 'aborted' });
      } else {
        await this.#recordStageRun(run, 'failed', { reason: err instanceof Error ? err.message : String(err) });
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
function sameWorkflowRef(left: WorkflowRef, right: WorkflowRef): boolean {
  return left.workflowId === right.workflowId && left.stageId === right.stageId && left.issueId === right.issueId;
}

function continuationScope(runId: RunId, workflowRef: WorkflowRef | undefined): ContinuationScope {
  if (workflowRef === undefined) return { kind: 'standalone', runId };
  return workflowRef.issueId === undefined
    ? { kind: 'workflow', workflowRef, runId }
    : { kind: 'issue', workflowRef, issueId: workflowRef.issueId, runId };
}

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
function toIssueDto(issue: ConsistencyIssue, workflowIssue?: WorkflowIssueRecord): ConsistencyIssueDto {
  return {
    type: issue.type,
    severity: issue.severity,
    anchors: issue.anchors.map((a) => ({ id: a.id as string, kind: a.kind })),
    description: issue.description,
    requiresHumanDecision: issue.requiresHumanDecision,
    ...(workflowIssue === undefined ? {} : {
      issueId: workflowIssue.issueId,
      workflowStatus: workflowIssue.status,
      checkpointIds: workflowIssue.checkpointIds,
      verificationRunIds: workflowIssue.verificationRunIds,
      ...(workflowIssue.resolutionReason === undefined ? {} : { resolutionReason: workflowIssue.resolutionReason }),
    }),
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
