/**
 * 质量仪表盘 hook：Renderer 仅发送总检/中断命令并消费 Main 下发的控制事件。
 */
import { subscribeControlEvent } from '../lib/ipc-event-bus.js';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BackendControlEvent,
  FrontendCommandMessage,
  GlobalAuditFailedEvent,
  GlobalAuditProgressEvent,
  GlobalAuditStartedEvent,
  QualityDashboardDto,
  RunId,
} from '../../shared/ipc/index.js';

type DashboardStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted';

export interface DashboardState {
  readonly runId: RunId | undefined;
  readonly status: DashboardStatus;
  readonly factVersion: string | undefined;
  readonly totalItems: number;
  readonly completedItems: number;
  readonly phase: GlobalAuditProgressEvent['phase'] | undefined;
  readonly dashboard: QualityDashboardDto | undefined;
  readonly error: string | undefined;
  readonly stale: boolean;
}

export interface UseDashboardResult {
  readonly state: DashboardState;
  readonly busy: boolean;
  runGlobalAudit(workflowRef?: import('../../shared/ipc/index.js').WorkflowRefDto): RunId;
  runTargetedVerification(issue: import('../../shared/ipc/index.js').ConsistencyIssueDto, workflowRef: import('../../shared/ipc/index.js').WorkflowRefDto): RunId | undefined;
  abort(): void;
  clear(): void;
}

const INITIAL_STATE: DashboardState = {
  runId: undefined,
  status: 'idle',
  factVersion: undefined,
  totalItems: 0,
  completedItems: 0,
  phase: undefined,
  dashboard: undefined,
  error: undefined,
  stale: false,
};

function newRunId(): RunId {
  return crypto.randomUUID() as RunId;
}

function fromStarted(event: GlobalAuditStartedEvent): DashboardState {
  return {
    ...INITIAL_STATE,
    runId: event.runId,
    status: 'running',
    factVersion: event.factVersion,
    totalItems: event.totalItems,
  };
}

function applyProgress(prev: DashboardState, event: GlobalAuditProgressEvent): DashboardState {
  return {
    ...prev,
    status: 'running',
    phase: event.phase,
    completedItems: event.completedItems,
    totalItems: event.totalItems,
  };
}

function applyFailed(prev: DashboardState, event: GlobalAuditFailedEvent): DashboardState {
  return {
    ...prev,
    runId: event.runId,
    status: event.error.category === 'aborted' ? 'aborted' : 'failed',
    error: event.error.message,
  };
}

/**
 * 事实底座发生变化的事件：已完成的体检结果应标记为过期。
 * 抽取事件仅在携带新 factVersion（确实有东西落库）时算变化。
 */
function isFactChangeEvent(event: BackendControlEvent): boolean {
  switch (event.type) {
    case 'fact-extraction-completed':
      return event.factVersion !== undefined;
    case 'story-bible-fact-confirmed':
    case 'story-bible-fact-edited':
    case 'story-bible-fact-deleted':
    case 'story-bible-entities-merged':
      return true;
    default:
      return false;
  }
}

export function useDashboard(): UseDashboardResult {
  const [state, setState] = useState<DashboardState>(INITIAL_STATE);

  const send = useCallback((command: FrontendCommandMessage): void => {
    window.novelAgent.sendCommand(command);
  }, []);

  const runGlobalAudit = useCallback((workflowRef?: import('../../shared/ipc/index.js').WorkflowRefDto): RunId => {
    const runId = newRunId();
    setState({ ...INITIAL_STATE, runId, status: 'running' });
    send({ type: 'run-global-audit', runId, ...(workflowRef === undefined ? {} : { workflowRef }) });
    return runId;
  }, [send]);

  const runTargetedVerification = useCallback((issue: import('../../shared/ipc/index.js').ConsistencyIssueDto, workflowRef: import('../../shared/ipc/index.js').WorkflowRefDto): RunId | undefined => {
    if (issue.issueId === undefined) return undefined;
    const runId = newRunId();
    send({ type: 'run-targeted-verification', runId, workflowRef: { ...workflowRef, issueId: issue.issueId } });
    return runId;
  }, [send]);

  const abort = useCallback((): void => {
    if (state.runId === undefined) return;
    send({ type: 'abort-run', runId: state.runId });
  }, [send, state.runId]);

  const clear = useCallback((): void => {
    setState(INITIAL_STATE);
  }, []);

  useEffect(() => {
    const off = subscribeControlEvent((event: BackendControlEvent) => {
      setState((prev) => {
        if (event.type === 'global-audit-started') return fromStarted(event);
        if (event.type === 'targeted-verification-completed' && prev.dashboard !== undefined) {
          return {
            ...prev,
            dashboard: {
              ...prev.dashboard,
              issues: prev.dashboard.issues.map((issue) => issue.issueId === event.issue.issueId ? event.issue : issue),
            },
          };
        }
        if (event.type === 'targeted-verification-failed') return { ...prev, error: event.error.message };
        // 事实变化事件的 runId 与总检 runId 不同，需在 runId 守卫之前处理。
        if (isFactChangeEvent(event)) {
          if (prev.status === 'completed' && !prev.stale) return { ...prev, stale: true };
          return prev;
        }
        if (prev.runId !== event.runId) return prev;
        switch (event.type) {
          case 'global-audit-progress':
            return applyProgress(prev, event);
          case 'global-audit-completed':
            return {
              ...prev,
              status: 'completed',
              dashboard: event.dashboard,
              factVersion: event.dashboard.factVersion,
              totalItems: event.dashboard.totalItems,
              completedItems: event.dashboard.totalItems,
              error: undefined,
              stale: false,
            };
          case 'global-audit-failed':
            return applyFailed(prev, event);
          default:
            return prev;
        }
      });
    });
    return off;
  }, []);

  const busy = useMemo(() => state.status === 'running', [state.status]);

  return { state, busy, runGlobalAudit, runTargetedVerification, abort, clear };
}
