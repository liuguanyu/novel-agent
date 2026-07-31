/** Framework-independent contracts for defining and tracking roadmap task runs. */

/** Coarse task families; individual workflows are identified by their playbook id. */
export type TaskKind = 'legacy-book' | 'new-book' | 'temporary';

export type TaskRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting-author'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'file-reference';

export interface TaskInputDefinition<TKey extends string = string> {
  key: TKey;
  label: string;
  valueType: TaskValueType;
  required: boolean;
  description: string;
}

export interface TaskStepDefinition<TStepId extends string = string> {
  id: TStepId;
  title: string;
  description: string;
  /** Marks a step whose result must be accepted or amended by the author. */
  requiresAuthorDecision: boolean;
}

export interface TaskOutputDefinition<TKey extends string = string> {
  key: TKey;
  label: string;
  valueType: TaskValueType;
  description: string;
}

/**
 * Declarative workflow contract. Its generic keys make fixture and consumer
 * definitions precise without coupling execution to a framework.
 */
export interface TaskPlaybook<
  TInputKey extends string = string,
  TStepId extends string = string,
  TOutputKey extends string = string,
> {
  id: string;
  version: number;
  kind: TaskKind;
  title: string;
  description: string;
  inputs: ReadonlyArray<TaskInputDefinition<TInputKey>>;
  steps: ReadonlyArray<TaskStepDefinition<TStepId>>;
  outputs: ReadonlyArray<TaskOutputDefinition<TOutputKey>>;
}

/** Domain references are nullable where a task can validly run without them. */
export interface TaskRunRefs {
  playbookId: string;
  executionRunId: string;
  projectId: string | null;
  bookId: string | null;
  manuscriptId: string | null;
  workflowId: string | null;
  workflowStageId: string | null;
  issueId: string | null;
}

export interface TaskRunArtifact {
  id: string;
  outputKey: string;
  value: unknown;
  createdAt: string;
}

export interface TaskAuthorDecision {
  id: string;
  stepId: string;
  prompt: string;
  decision: unknown;
  decidedAt: string;
}

export interface TaskRunTimestamps {
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  awaitingAuthorAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
}

export interface TaskRunFailure {
  code: string;
  message: string;
}

export interface TaskRun {
  id: string;
  kind: TaskKind;
  refs: TaskRunRefs;
  /** Auditable, author-visible task inputs. Hidden prompts/reasoning must never be stored here. */
  inputs: Readonly<Record<string, unknown>>;
  status: TaskRunStatus;
  /** Null while queued or after all playbook steps have been consumed. */
  currentStepId: string | null;
  currentStepIndex: number | null;
  artifacts: ReadonlyArray<TaskRunArtifact>;
  authorDecisions: ReadonlyArray<TaskAuthorDecision>;
  timestamps: TaskRunTimestamps;
  failure: TaskRunFailure | null;
}
