import { subscribeModelTaskEvent } from '../lib/ipc-event-bus.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BackendModelTaskEvent,
  ModelTaskActivityDto,
  ModelTaskConflictCandidateDto,
  ModelTaskAttemptStatus,
  ModelTaskDisplayMetadata,
  ModelTaskKind,
  RunId,
  WorkflowRefDto,
} from '../../shared/ipc/index.js';

export interface ModelTaskAttemptView {
  readonly taskId: string;
  readonly attemptId: string;
  readonly kind: ModelTaskKind;
  readonly runId: RunId;
  readonly workflowRef?: WorkflowRefDto;
  readonly chapterId?: string;
  readonly status: ModelTaskAttemptStatus;
  readonly activities: ReadonlyArray<ModelTaskActivityDto>;
  readonly conflicts: ReadonlyArray<ModelTaskConflictCandidateDto>;
  readonly summary?: ModelTaskDisplayMetadata;
  readonly error?: string;
}

export interface UseModelTaskSessionsResult {
  readonly attempts: ReadonlyArray<ModelTaskAttemptView>;
  readonly activeAttempt: ModelTaskAttemptView | undefined;
  selectAttempt(attemptId: string): void;
  dismissActiveAttempt(): void;
  retry(attempt: ModelTaskAttemptView): void;
  abort(attempt: ModelTaskAttemptView): void;
  supplement(attempt: ModelTaskAttemptView, text: string, scope: 'current-chapter' | 'remaining-chapters' | 'workflow-goal'): void;
}

function createAttempt(event: BackendModelTaskEvent): ModelTaskAttemptView {
  return {
    taskId: event.taskId,
    attemptId: event.attemptId,
    kind: event.kind,
    runId: event.runId,
    status: event.attemptStatus,
    activities: event.type === 'model-task-activity' ? [event.activity] : [],
    conflicts: event.type === 'model-task-activity' ? (event.activity.conflicts ?? []) : [],
    ...(event.workflowRef === undefined ? {} : { workflowRef: event.workflowRef }),
    ...(event.chapterId === undefined ? {} : { chapterId: event.chapterId }),
    ...(event.type === 'model-task-completed' ? { summary: event.summary } : {}),
    ...(event.type === 'model-task-failed' ? { error: event.error.message } : {}),
  };
}

function applyEvent(prev: ModelTaskAttemptView, event: BackendModelTaskEvent): ModelTaskAttemptView {
  const activities = event.type === 'model-task-activity' && !prev.activities.some((item) => item.activityId === event.activity.activityId)
    ? [...prev.activities, event.activity]
    : prev.activities;
  const conflicts = event.type === 'model-task-activity'
    ? [...prev.conflicts, ...(event.activity.conflicts ?? []).filter((item) => !prev.conflicts.some((existing) => existing.conflictId === item.conflictId))]
    : prev.conflicts;
  return {
    ...prev,
    status: event.attemptStatus,
    activities,
    conflicts,
    ...(event.chapterId === undefined ? {} : { chapterId: event.chapterId }),
    ...(event.type === 'model-task-completed' ? { summary: event.summary } : {}),
    ...(event.type === 'model-task-failed' ? { error: event.error.message } : {}),
  };
}

export function useModelTaskSessions(): UseModelTaskSessionsResult {
  const [attempts, setAttempts] = useState<ReadonlyArray<ModelTaskAttemptView>>([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | undefined>(undefined);

  useEffect(() => subscribeModelTaskEvent((event) => {
    setAttempts((prev) => {
      const existingIndex = prev.findIndex((attempt) => attempt.attemptId === event.attemptId);
      if (existingIndex < 0) return [...prev, createAttempt(event)];
      return prev.map((attempt, index) => index === existingIndex ? applyEvent(attempt, event) : attempt);
    });
    setSelectedAttemptId((current) => current ?? event.attemptId);
  }), []);

  const activeAttempt = useMemo(() => {
    if (selectedAttemptId !== undefined) {
      const selected = attempts.find((attempt) => attempt.attemptId === selectedAttemptId);
      if (selected !== undefined) return selected;
    }
    return attempts.at(-1);
  }, [attempts, selectedAttemptId]);

  const selectAttempt = useCallback((attemptId: string): void => setSelectedAttemptId(attemptId), []);
  const dismissActiveAttempt = useCallback((): void => setSelectedAttemptId(undefined), []);
  const retry = useCallback((attempt: ModelTaskAttemptView): void => {
    window.novelAgent.sendCommand({ type: 'retry-model-task', taskId: attempt.taskId, attemptId: attempt.attemptId, runId: attempt.runId });
  }, []);
  const abort = useCallback((attempt: ModelTaskAttemptView): void => {
    window.novelAgent.sendCommand({ type: 'abort-model-task', taskId: attempt.taskId, attemptId: attempt.attemptId, runId: attempt.runId });
  }, []);
  const supplement = useCallback((attempt: ModelTaskAttemptView, text: string, scope: 'current-chapter' | 'remaining-chapters' | 'workflow-goal'): void => {
    window.novelAgent.sendCommand({
      type: 'workflow-supplement-model-task',
      taskId: attempt.taskId,
      attemptId: attempt.attemptId,
      runId: attempt.runId,
      supplement: { text, scope },
    });
  }, []);

  return { attempts, activeAttempt, selectAttempt, dismissActiveAttempt, retry, abort, supplement };
}
