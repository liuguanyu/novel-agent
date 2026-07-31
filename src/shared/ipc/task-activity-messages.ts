import type { RunId } from './stream-messages.js';
import type { WorkflowRefDto } from './workflow-messages.js';

export type TaskKind =
  | 'locate-source'
  | 'fact-extraction'
  | 'global-audit'
  | 'targeted-verification'
  | 'refactor-generation'
  | 'manuscript-write'
  | 'new-book-planning'
  | 'chapter-drafting'
  | 'temporary-task';

export type TaskRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting-author'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskActivityPhase =
  | 'input'
  | 'retrieval'
  | 'model'
  | 'validation'
  | 'ui-effect'
  | 'output'
  | 'awaiting-author'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'heartbeat';

export interface TaskEvidenceRefDto {
  readonly kind: 'issue' | 'chapter' | 'quote' | 'fact' | 'diagnosis';
  readonly label: string;
  readonly ref: string;
}

export interface TaskArtifactRefDto {
  readonly kind: 'source-location' | 'source-location-candidates' | 'diff' | 'checkpoint' | 'fact-sheet' | 'diagnosis' | 'draft';
  readonly label: string;
  readonly ref: string;
}

export interface TaskAuthorCandidateDto {
  readonly candidateId: string;
  readonly kind: 'source-location';
  readonly label: string;
  readonly chapterId: string;
  readonly preview: string;
}

/**
 * 模型交互可审计 DTO（任务驱动工作台 3.5 / design 决策 5：`task-run-model-interaction` 白名单）。
 *
 * 只承载作者可理解、可追溯的字段：任务目标、可见输入摘要、上下文/证据引用、
 * 作者/系统业务约束、输出摘要、结构化结果、工具结果、验证结果与采用/拒绝/待确认决定。
 * MUST NOT 包含 hidden chain-of-thought、不可追溯解释或未脱敏的内部 prompt。Main 以白名单重建后方可发布/持久化。
 */
export interface TaskModelAuditDto {
  /** 本次模型交互的任务目标（作者可读）。 */
  readonly goal: string;
  /** 参与本次交互的专家/角色标识（如 writer/editor/fact-checker）。 */
  readonly agent: string;
  /** 模型能力档位（如 prose/reasoning/cheap-fast），供作者判断成本/质量。 */
  readonly tier: string;
  /** 可见输入摘要（作者可读，非原始 prompt）。 */
  readonly inputSummary: string;
  /** 使用的上下文/证据引用（人物/设定/上文产物等）。 */
  readonly contextRefs?: ReadonlyArray<string>;
  /** 作者与系统业务约束（如“不得改写全文”、作者补充约束）。 */
  readonly constraints?: ReadonlyArray<string>;
  /** 输出摘要（作者可读结论，非原始回复）。 */
  readonly outputSummary: string;
  /** 结构化结果（如篇幅/数量/候选项等可展示标量）。 */
  readonly structuredResult?: Readonly<Record<string, string | number | boolean | null>>;
  /** 工具/检索等外部调用结果摘要。 */
  readonly toolResults?: ReadonlyArray<string>;
  /** 验证结果摘要（如格式校验/一致性校验）。 */
  readonly validation?: string;
  /** 采用状态：系统已采用 / 作者已拒绝 / 等待作者确认。 */
  readonly adoption: 'adopted' | 'rejected' | 'pending';
}

/**
 * 统一心跳契约（任务驱动工作台 2.4 / requirement §2.4）。
 *
 * 心跳只在超过 2 秒无新活动且任务仍 running 时下发，且 MUST 携带至少一项真实
 * 进展信号（当前步骤 / 已处理量 / 当前处理对象 / 最近子步骤 / 外部等待中），
 * 禁止虚假进度。字段均为可选，但发送方 MUST 至少提供其中一项（Main 以守卫拦住空心跳）。
 */
export interface TaskHeartbeatDto {
  /** 当前正在执行的步骤（作者可读）。 */
  readonly step?: string;
  /** 已处理量（如已扫描章节数）。 */
  readonly processedCount?: number;
  /** 总处理量（与 processedCount 配合展现进度）。 */
  readonly totalCount?: number;
  /** 当前处理对象（如目标章节/实体）。 */
  readonly currentObject?: string;
  /** 最近完成的子步骤。 */
  readonly recentSubStep?: string;
  /** 正在等待的外部依赖（如模型/磁盘 IO）。 */
  readonly waitingOnExternal?: string;
}

interface TaskUiEffectBaseDto {
  /** Main 生成的稳定标识，用于校验和幂等记录 Renderer 执行结果。 */
  readonly effectId: string;
}

export type TaskUiEffectDto =
  | (TaskUiEffectBaseDto & { readonly kind: 'select-chapter'; readonly chapterId: string; readonly reason: string })
  | (TaskUiEffectBaseDto & { readonly kind: 'highlight-quote'; readonly chapterId: string; readonly quote: string; readonly reason: string })
  | (TaskUiEffectBaseDto & { readonly kind: 'scroll-to-evidence'; readonly chapterId: string; readonly quote: string })
  | (TaskUiEffectBaseDto & { readonly kind: 'show-diff'; readonly nodeId: string; readonly diffId: string })
  | (TaskUiEffectBaseDto & { readonly kind: 'show-hunk-review'; readonly refactorRunId: string })
  | (TaskUiEffectBaseDto & { readonly kind: 'show-checkpoint'; readonly checkpointId: string })
  | (TaskUiEffectBaseDto & { readonly kind: 'open-fact-sheet'; readonly taskId: string })
  | (TaskUiEffectBaseDto & { readonly kind: 'open-dashboard'; readonly auditRunId: string });

export interface TaskUiEffectResultDto {
  readonly taskRunId: string;
  readonly activityId: string;
  readonly effectId: string;
  readonly effectKind: TaskUiEffectDto['kind'];
  readonly status: 'applied' | 'failed';
  /** 作者可读结果，不含内部异常堆栈。 */
  readonly message: string;
}

export interface TaskRunRefDto {
  readonly taskRunId: string;
  readonly taskId: string;
  readonly kind: TaskKind;
  readonly runId: RunId;
  readonly workflowRef?: WorkflowRefDto;
  readonly issueId?: string;
  readonly chapterId?: string;
}

export interface TaskActivityEvent extends TaskRunRefDto {
  readonly type: 'task-activity';
  readonly activityId: string;
  readonly status: TaskRunStatus;
  readonly phase: TaskActivityPhase;
  readonly title: string;
  readonly message: string;
  readonly inputSummary?: string;
  readonly outputSummary?: string;
  readonly feedback?: string;
  readonly nextAction?: string;
  readonly evidenceRefs?: ReadonlyArray<TaskEvidenceRefDto>;
  readonly artifactRefs?: ReadonlyArray<TaskArtifactRefDto>;
  readonly authorCandidates?: ReadonlyArray<TaskAuthorCandidateDto>;
  /** 模型交互可审计记录（仅白名单字段，MUST NOT 含 hidden CoT）。 */
  readonly modelAudit?: TaskModelAuditDto;
  /** 结构化心跳进展（仅 phase==='heartbeat' 时携带，至少一项真实信号）。 */
  readonly heartbeat?: TaskHeartbeatDto;
  readonly uiEffects?: ReadonlyArray<TaskUiEffectDto>;
  /** Main 持久化的 Renderer 执行结果；用于审计及重连时避免重复执行。 */
  readonly uiEffectResult?: TaskUiEffectResultDto;
  readonly createdAt: string;
}

export interface TaskRunCompletedEvent extends TaskRunRefDto {
  readonly type: 'task-run-completed';
  readonly status: 'completed';
  readonly title: string;
  readonly summary: string;
  readonly artifactRefs?: ReadonlyArray<TaskArtifactRefDto>;
  readonly completedAt: string;
}

export interface TaskRunFailedEvent extends TaskRunRefDto {
  readonly type: 'task-run-failed';
  readonly status: 'failed' | 'cancelled';
  readonly title: string;
  readonly error: {
    readonly category: 'validation' | 'io' | 'model' | 'aborted' | 'internal';
    readonly message: string;
    readonly recovery?: string;
  };
  readonly failedAt: string;
}

export type BackendTaskActivityEvent = TaskActivityEvent | TaskRunCompletedEvent | TaskRunFailedEvent;
