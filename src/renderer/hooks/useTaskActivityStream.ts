import { useEffect, useMemo, useState } from 'react';
import type { BackendTaskActivityEvent, TaskActivityEvent } from '../../shared/ipc/index.js';

const MAX_EVENTS = 200;

function eventId(event: BackendTaskActivityEvent): string {
  return event.type === 'task-activity'
    ? event.activityId
    : `${event.type}:${event.taskRunId}:${event.type === 'task-run-completed' ? event.completedAt : event.failedAt}`;
}

function eventTime(event: BackendTaskActivityEvent): string {
  return event.type === 'task-activity'
    ? event.createdAt
    : event.type === 'task-run-completed' ? event.completedAt : event.failedAt;
}

function mergeEvents(
  previous: ReadonlyArray<BackendTaskActivityEvent>,
  incoming: ReadonlyArray<BackendTaskActivityEvent>,
): ReadonlyArray<BackendTaskActivityEvent> {
  const merged = new Map(previous.map((event) => [eventId(event), event]));
  for (const event of incoming) merged.set(eventId(event), event);
  return [...merged.values()]
    .sort((left, right) => eventTime(left).localeCompare(eventTime(right)) || eventId(left).localeCompare(eventId(right)))
    .slice(-MAX_EVENTS);
}

export interface TaskActivityStreamState {
  readonly events: ReadonlyArray<BackendTaskActivityEvent>;
  readonly activities: ReadonlyArray<TaskActivityEvent>;
  readonly activeTaskRunId: string | undefined;
}

export function useTaskActivityStream(projectId?: string): TaskActivityStreamState {
  const [events, setEvents] = useState<ReadonlyArray<BackendTaskActivityEvent>>([]);

  useEffect(() => {
    let disposed = false;
    setEvents([]);
    const unsubscribe = window.novelAgent.onTaskActivityEvent((event) => {
      if (!disposed) setEvents((previous) => mergeEvents(previous, [event]));
    });
    void window.novelAgent.getTaskCenter(projectId === undefined ? {} : { projectId }).then(
      (snapshot) => {
        if (!disposed) setEvents((previous) => mergeEvents(previous, snapshot.events));
      },
      () => {
        // Real-time activity remains available when history restoration fails.
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [projectId]);

  const activities = useMemo(
    () => events.filter((event): event is TaskActivityEvent => event.type === 'task-activity'),
    [events],
  );
  let activeTaskRunId: string | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.status === 'running' || event?.status === 'awaiting-author' || event?.status === 'paused') {
      activeTaskRunId = event.taskRunId;
      break;
    }
  }
  return { events, activities, activeTaskRunId };
}
