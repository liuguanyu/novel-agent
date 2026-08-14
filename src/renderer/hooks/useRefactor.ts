/**
 * 局部重构改写审阅 UI 状态 hook (refactor-review-ui)
 *
 * Renderer 只发送 compute-refactor-diff / apply-hunk-decisions 命令并订阅 Main 下发的
 * refactor-* control-event；不读取正文文件、不计算 diff、不写入正文（accept/reject 只上报意图）。
 */
import { subscribeControlEvent } from '../lib/ipc-event-bus.js';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BackendControlEvent,
  DiffHunkDto,
  FragmentAnchorDto,
  FrontendCommandMessage,
  HunkDecisionDto,
  IssueAnchorDto,
  RefactorAppliedEvent,
  RefactorApplyFailedEvent,
  RefactorDiffComputedEvent,
  RefactorDiffFailedEvent,
  RunId,
  WorkflowRefDto,
} from '../../shared/ipc/index.js';

type RefactorStatus = 'idle' | 'computing' | 'reviewing' | 'applying' | 'applied' | 'failed';

type HunkDecisionValue = 'accept' | 'reject';

export interface RefactorState {
  readonly runId: RunId | undefined;
  readonly status: RefactorStatus;
  readonly anchor: FragmentAnchorDto | undefined;
  readonly resultAnchor: IssueAnchorDto | undefined;
  readonly originalFragment: string;
  readonly rewrittenFragment: string;
  readonly hunks: ReadonlyArray<DiffHunkDto>;
  /** 逐 hunk 本地裁决意图（hunkId → accept/reject），默认 accept。 */
  readonly decisions: Readonly<Record<string, HunkDecisionValue>>;
  readonly checkpointId: string | undefined;
  readonly acceptedHunkIds: ReadonlyArray<string>;
  readonly failedHunkIds: ReadonlyArray<string>;
  readonly error: string | undefined;
}

export interface UseRefactorResult {
  readonly state: RefactorState;
  readonly busy: boolean;
  computeDiff(anchor: FragmentAnchorDto, rewrittenFragment: string): RunId;
  setDecision(hunkId: string, decision: HunkDecisionValue): void;
  apply(): void;
  clear(): void;
}

const INITIAL_STATE: RefactorState = {
  runId: undefined,
  status: 'idle',
  anchor: undefined,
  resultAnchor: undefined,
  originalFragment: '',
  rewrittenFragment: '',
  hunks: [],
  decisions: {},
  checkpointId: undefined,
  acceptedHunkIds: [],
  failedHunkIds: [],
  error: undefined,
};

function newRunId(): RunId {
  return crypto.randomUUID() as RunId;
}

/** 默认全部 accept：diff 计算完成后，逐 hunk 初始裁决意图。 */
function defaultDecisions(hunks: ReadonlyArray<DiffHunkDto>): Record<string, HunkDecisionValue> {
  const map: Record<string, HunkDecisionValue> = {};
  for (const hunk of hunks) map[hunk.id] = 'accept';
  return map;
}

function applyDiffComputed(prev: RefactorState, event: RefactorDiffComputedEvent): RefactorState {
  return {
    ...prev,
    runId: event.runId,
    status: 'reviewing',
    resultAnchor: event.anchor,
    originalFragment: event.originalFragment,
    rewrittenFragment: event.rewrittenFragment,
    hunks: event.hunks,
    decisions: defaultDecisions(event.hunks),
    checkpointId: undefined,
    acceptedHunkIds: [],
    failedHunkIds: [],
    error: undefined,
  };
}

function applyDiffFailed(prev: RefactorState, event: RefactorDiffFailedEvent): RefactorState {
  return { ...prev, status: 'failed', error: event.error.message };
}

function applyApplied(prev: RefactorState, event: RefactorAppliedEvent): RefactorState {
  return {
    ...prev,
    status: 'applied',
    acceptedHunkIds: event.acceptedHunkIds,
    error: undefined,
    ...(event.checkpointId !== undefined ? { checkpointId: event.checkpointId } : {}),
  };
}

function applyApplyFailed(prev: RefactorState, event: RefactorApplyFailedEvent): RefactorState {
  return {
    ...prev,
    status: 'failed',
    error: event.error.message,
    failedHunkIds: event.hunkIds ?? [],
  };
}

/**
 * 消费 refactor-* 控制事件并维护改写审阅状态。
 * onApplied 在 refactor-applied 时回调（供 App 重载当前章节正文，呈现磁盘变更）。
 */
export function useRefactor(
  onApplied?: (nodeId: string) => void,
  workflowRef?: WorkflowRefDto,
  issueId?: string,
  workflowVersion?: number,
): UseRefactorResult {
  const [state, setState] = useState<RefactorState>(INITIAL_STATE);

  const send = useCallback((command: FrontendCommandMessage): void => {
    window.novelAgent.sendCommand(command);
  }, []);

  const computeDiff = useCallback(
    (anchor: FragmentAnchorDto, rewrittenFragment: string): RunId => {
      const runId = newRunId();
      setState({
        ...INITIAL_STATE,
        runId,
        status: 'computing',
        anchor,
        rewrittenFragment,
      });
      const command: FrontendCommandMessage = {
        type: 'compute-refactor-diff',
        runId,
        anchor,
        rewrittenFragment,
        ...(workflowRef !== undefined
          ? { workflowRef: { ...workflowRef, ...(issueId !== undefined ? { issueId } : {}) } }
          : {}),
      };
      if (workflowRef === undefined || issueId === undefined) {
        send(command);
      } else if (workflowVersion === undefined) {
        setState((previous) => ({ ...previous, status: 'failed', error: '工作流版本不可用，无法开始问题修复' }));
      } else {
        void window.novelAgent.sendWorkflowCommand({
          type: 'workflow-select-issue',
          requestId: crypto.randomUUID(),
          operationId: crypto.randomUUID(),
          expectedVersion: workflowVersion,
          workflowId: workflowRef.workflowId,
          stageId: workflowRef.stageId,
          issueId,
          runId,
          workflowRef: { ...workflowRef, issueId },
        }).then((response) => {
          if (response.failure !== undefined || response.snapshot === null) {
            setState((previous) => previous.runId === runId
              ? { ...previous, status: 'failed', error: response.failure?.error.message ?? '无法开始问题修复' }
              : previous);
            return;
          }
          send(command);
        });
      }
      return runId;
    },
    [issueId, send, workflowRef, workflowVersion],
  );

  const setDecision = useCallback((hunkId: string, decision: HunkDecisionValue): void => {
    setState((prev) => ({ ...prev, decisions: { ...prev.decisions, [hunkId]: decision } }));
  }, []);

  const apply = useCallback((): void => {
    setState((prev) => {
      if (prev.runId === undefined || prev.anchor === undefined || prev.status !== 'reviewing') {
        return prev;
      }
      const decisions: ReadonlyArray<HunkDecisionDto> = prev.hunks.map((hunk) => ({
        hunkId: hunk.id,
        decision: prev.decisions[hunk.id] ?? 'accept',
      }));
      send({
        type: 'apply-hunk-decisions',
        runId: prev.runId,
        anchor: prev.anchor,
        rewrittenFragment: prev.rewrittenFragment,
        decisions,
        ...(workflowRef !== undefined
          ? { workflowRef: { ...workflowRef, ...(issueId !== undefined ? { issueId } : {}) } }
          : {}),
      });
      return { ...prev, status: 'applying', error: undefined };
    });
  }, [issueId, send, workflowRef]);

  const clear = useCallback((): void => {
    setState(INITIAL_STATE);
  }, []);

  useEffect(() => {
    const off = subscribeControlEvent((event: BackendControlEvent) => {
      setState((prev) => {
        if (prev.runId !== event.runId) return prev;
        switch (event.type) {
          case 'refactor-diff-computed':
            return applyDiffComputed(prev, event);
          case 'refactor-diff-failed':
            return applyDiffFailed(prev, event);
          case 'refactor-applied':
            onApplied?.(event.nodeId);
            return applyApplied(prev, event);
          case 'refactor-apply-failed':
            return applyApplyFailed(prev, event);
          default:
            return prev;
        }
      });
    });
    return off;
  }, [onApplied]);

  const busy = useMemo(
    () => state.status === 'computing' || state.status === 'applying',
    [state.status],
  );

  return { state, busy, computeDiff, setDecision, apply, clear };
}
