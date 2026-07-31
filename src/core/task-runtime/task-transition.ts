import type { TaskRun, TaskRunFailure, TaskRunStatus } from './task-model.js';

const TERMINAL_STATUSES: ReadonlySet<TaskRunStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

const ALLOWED_TRANSITIONS: Readonly<Record<TaskRunStatus, ReadonlySet<TaskRunStatus>>> = {
  queued: new Set(['running']),
  running: new Set(['awaiting-author', 'paused', 'completed', 'failed', 'cancelled']),
  'awaiting-author': new Set(['running', 'paused', 'failed', 'cancelled']),
  paused: new Set(['running', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export interface TaskRunTransition {
  status: TaskRunStatus;
  occurredAt: string;
  /** Required when transitioning to failed; ignored for other targets. */
  failure?: TaskRunFailure;
}

export class InvalidTaskRunTransitionError extends Error {
  readonly from: TaskRunStatus;
  readonly to: TaskRunStatus;

  constructor(from: TaskRunStatus, to: TaskRunStatus) {
    super(`Invalid task run transition: ${from} -> ${to}`);
    this.name = 'InvalidTaskRunTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Returns a new run and never mutates the supplied run. */
export function transitionTaskRun(run: TaskRun, transition: TaskRunTransition): TaskRun {
  const { status: nextStatus, occurredAt } = transition;

  if (TERMINAL_STATUSES.has(run.status) || !ALLOWED_TRANSITIONS[run.status].has(nextStatus)) {
    throw new InvalidTaskRunTransitionError(run.status, nextStatus);
  }

  if (nextStatus === 'failed' && transition.failure === undefined) {
    throw new TypeError('A failed task run transition requires failure details');
  }

  return {
    ...run,
    status: nextStatus,
    failure: nextStatus === 'failed' ? transition.failure ?? null : null,
    timestamps: {
      ...run.timestamps,
      updatedAt: occurredAt,
      startedAt:
        nextStatus === 'running' && run.timestamps.startedAt === null
          ? occurredAt
          : run.timestamps.startedAt,
      awaitingAuthorAt:
        nextStatus === 'awaiting-author' ? occurredAt : run.timestamps.awaitingAuthorAt,
      pausedAt: nextStatus === 'paused' ? occurredAt : run.timestamps.pausedAt,
      endedAt: TERMINAL_STATUSES.has(nextStatus) ? occurredAt : run.timestamps.endedAt,
    },
  };
}
