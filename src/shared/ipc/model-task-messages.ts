import type { RunId } from './stream-messages.js';
import type { WorkflowRefDto } from './workflow-messages.js';

export type ModelTaskKind =
  | 'fact-extraction'
  | 'global-audit'
  | 'targeted-verification'
  | 'refactor-generation';

export type ModelTaskActivityPhase =
  | 'reading'
  | 'model'
  | 'validation'
  | 'ingest'
  | 'conflict'
  | 'completed'
  | 'failed';

export type ModelTaskSupplementScope =
  | 'current-chapter'
  | 'remaining-chapters'
  | 'workflow-goal';

export interface ModelTaskSupplementDto {
  readonly text: string;
  readonly scope: ModelTaskSupplementScope;
}

export type ModelTaskAttemptStatus =
  | 'queued'
  | 'running'
  | 'awaiting-author'
  | 'completed'
  | 'failed'
  | 'aborted';

export type ModelTaskDisplayValue = string | number | boolean | null;
export type ModelTaskDisplayMetadata = Readonly<Record<string, ModelTaskDisplayValue>>;

export interface ModelTaskRefDto {
  readonly taskId: string;
  readonly attemptId: string;
  readonly kind: ModelTaskKind;
  readonly runId: RunId;
  readonly workflowRef?: WorkflowRefDto;
  readonly chapterId?: string;
}

export interface ModelTaskConflictCandidateDto {
  readonly conflictId: string;
  readonly candidateSummary: string;
  readonly existingSummary: string;
  readonly evidenceQuote?: string;
  readonly allowedActions: ReadonlyArray<'accept-candidate' | 'keep-existing' | 'ignore-candidate'>;
}

export interface ModelTaskActivityDto {
  readonly activityId: string;
  readonly phase: ModelTaskActivityPhase;
  /** 只允许 Main 生成面向作者的活动摘要，不承载 prompt、原始回复或隐藏思维链。 */
  readonly message: string;
  readonly metadata?: ModelTaskDisplayMetadata;
  readonly conflicts?: ReadonlyArray<ModelTaskConflictCandidateDto>;
  readonly createdAt: string;
}

export interface ModelTaskActivityEvent extends ModelTaskRefDto {
  readonly type: 'model-task-activity';
  readonly attemptStatus: 'running' | 'awaiting-author';
  readonly activity: ModelTaskActivityDto;
}

export interface ModelTaskCompletedEvent extends ModelTaskRefDto {
  readonly type: 'model-task-completed';
  readonly attemptStatus: 'completed';
  readonly summary: ModelTaskDisplayMetadata;
  readonly completedAt: string;
}

export interface ModelTaskFailedEvent extends ModelTaskRefDto {
  readonly type: 'model-task-failed';
  readonly attemptStatus: 'failed' | 'aborted';
  readonly error: {
    readonly category: 'model' | 'validation' | 'aborted' | 'io' | 'internal';
    readonly message: string;
  };
  readonly failedAt: string;
}

export type BackendModelTaskEvent =
  | ModelTaskActivityEvent
  | ModelTaskCompletedEvent
  | ModelTaskFailedEvent;
