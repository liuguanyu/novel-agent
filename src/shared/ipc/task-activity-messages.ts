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
