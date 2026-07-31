import type { TaskPlaybook, TaskRun, TaskRunRefs } from './task-model.js';

/**
 * Domain references a caller may supply when instantiating a run. Every field is
 * optional so that new-book and temporary tasks can run without an existing
 * project, book, or manuscript — the base task model MUST NOT require prose.
 */
export type PartialTaskRunRefs = Partial<Omit<TaskRunRefs, 'playbookId'>>;

export interface CreateTaskRunOptions {
  id: string;
  executionRunId: string;
  /** Author-visible, auditable inputs. Hidden prompts/reasoning MUST NOT be stored here. */
  inputs?: Readonly<Record<string, unknown>>;
  refs?: PartialTaskRunRefs;
  now: string;
}

/**
 * Builds a queued {@link TaskRun} from a playbook without requiring any prose,
 * project, or manuscript. Pure and framework-independent: no clock, IO, or IDs
 * are generated here — the caller supplies them so callers stay deterministic.
 */
export function createTaskRunFromPlaybook(
  playbook: TaskPlaybook,
  options: CreateTaskRunOptions,
): TaskRun {
  const supplied = options.refs ?? {};
  const refs: TaskRunRefs = {
    playbookId: playbook.id,
    executionRunId: options.executionRunId,
    projectId: supplied.projectId ?? null,
    bookId: supplied.bookId ?? null,
    manuscriptId: supplied.manuscriptId ?? null,
    workflowId: supplied.workflowId ?? null,
    workflowStageId: supplied.workflowStageId ?? null,
    issueId: supplied.issueId ?? null,
  };

  return {
    id: options.id,
    kind: playbook.kind,
    refs,
    inputs: options.inputs ?? {},
    status: 'queued',
    currentStepId: null,
    currentStepIndex: null,
    artifacts: [],
    authorDecisions: [],
    timestamps: {
      createdAt: options.now,
      updatedAt: options.now,
      startedAt: null,
      awaitingAuthorAt: null,
      pausedAt: null,
      endedAt: null,
    },
    failure: null,
  };
}

/**
 * Positions a run at the playbook step with the given id, returning a new run.
 * Does not mutate the input or change status; step progression and status
 * convergence remain the caller's responsibility via {@link transitionTaskRun}.
 * Returns the run unchanged when the step id is not part of the playbook.
 */
export function positionTaskRunAtStep(
  run: TaskRun,
  playbook: TaskPlaybook,
  stepId: string,
  now: string,
): TaskRun {
  const stepIndex = playbook.steps.findIndex((step) => step.id === stepId);
  if (stepIndex === -1) return run;

  return {
    ...run,
    currentStepId: stepId,
    currentStepIndex: stepIndex,
    timestamps: { ...run.timestamps, updatedAt: now },
  };
}

/** Returns true when every declared required input has a defined value. */
export function taskRunHasRequiredInputs(playbook: TaskPlaybook, run: TaskRun): boolean {
  return playbook.inputs
    .filter((input) => input.required)
    .every((input) => run.inputs[input.key] !== undefined);
}
