/**
 * 事实抽取 UI 状态 hook (fact-extraction-ui)
 *
 * Renderer 只发送抽取/补库/恢复/中断命令，并订阅 Main 下发的 control-event；
 * 不读取正文文件、不调用模型、不写事实库。
 */
import { subscribeControlEvent } from '../lib/ipc-event-bus.js';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BackendControlEvent,
  ConsistencyIssueDto,
  FactExtractionCompletedEvent,
  FactExtractionFailedEvent,
  FactExtractionStartedEvent,
  FrontendCommandMessage,
  RunId,
} from '../../shared/ipc/index.js';

type ExtractionMode = 'chapter' | 'backfill';
type ExtractionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'interrupted' | 'aborted';

export interface FactExtractionState {
  readonly runId: RunId | undefined;
  readonly mode: ExtractionMode | undefined;
  readonly status: ExtractionStatus;
  readonly currentChapterId: string | undefined;
  readonly textChars: number | undefined;
  readonly index: number | undefined;
  readonly total: number | undefined;
  readonly chunks: number | undefined;
  readonly candidateObjects: number;
  readonly validCandidates: number;
  readonly invalidCandidates: number;
  readonly autoIngested: number;
  readonly conflicts: number;
  readonly skipped: number;
  readonly factVersion: string | undefined;
  readonly error: string | undefined;
  readonly issues: ReadonlyArray<ConsistencyIssueDto>;
}

export interface UseFactExtractionResult {
  readonly state: FactExtractionState;
  readonly busy: boolean;
  extractCurrentChapter(nodeId: string): RunId;
  backfillAll(workflowRef?: import('../../shared/ipc/index.js').WorkflowRefDto): RunId;
  abort(): void;
  resolveConflict(optionId: string): void;
  rejectConflict(): void;
  clear(): void;
}

const INITIAL_STATE: FactExtractionState = {
  runId: undefined,
  mode: undefined,
  status: 'idle',
  currentChapterId: undefined,
  textChars: undefined,
  index: undefined,
  total: undefined,
  chunks: undefined,
  candidateObjects: 0,
  validCandidates: 0,
  invalidCandidates: 0,
  autoIngested: 0,
  conflicts: 0,
  skipped: 0,
  factVersion: undefined,
  error: undefined,
  issues: [],
};

function newRunId(): RunId {
  return crypto.randomUUID() as RunId;
}

function fromStarted(event: FactExtractionStartedEvent, mode: ExtractionMode): FactExtractionState {
  return {
    ...INITIAL_STATE,
    runId: event.runId,
    mode,
    status: 'running',
    currentChapterId: event.chapterId,
    textChars: event.textChars,
    ...(event.index !== undefined ? { index: event.index } : {}),
    ...(event.total !== undefined ? { total: event.total } : {}),
  };
}

function applyCompleted(prev: FactExtractionState, event: FactExtractionCompletedEvent): FactExtractionState {
  return {
    ...prev,
    runId: event.runId,
    status: event.conflicts > 0 ? 'interrupted' : 'completed',
    currentChapterId: event.chapterId,
    candidateObjects: prev.candidateObjects + event.candidateObjects,
    validCandidates: prev.validCandidates + event.validCandidates,
    invalidCandidates: prev.invalidCandidates + event.invalidCandidates,
    autoIngested: prev.autoIngested + event.autoIngested,
    conflicts: prev.conflicts + event.conflicts,
    skipped: prev.skipped + event.skipped,
    factVersion: event.factVersion,
    error: undefined,
    ...(event.chunks !== undefined ? { chunks: event.chunks } : {}),
    ...(event.index !== undefined ? { index: event.index } : {}),
    ...(event.total !== undefined ? { total: event.total } : {}),
  };
}

function applyFailed(prev: FactExtractionState, event: FactExtractionFailedEvent): FactExtractionState {
  return {
    ...prev,
    runId: event.runId,
    status: event.error.category === 'aborted' ? 'aborted' : 'failed',
    ...(event.chapterId !== undefined ? { currentChapterId: event.chapterId } : {}),
    error: event.error.message,
  };
}

export function useFactExtraction(): UseFactExtractionResult {
  const [state, setState] = useState<FactExtractionState>(INITIAL_STATE);

  const send = useCallback((command: FrontendCommandMessage): void => {
    window.novelAgent.sendCommand(command);
  }, []);

  const extractCurrentChapter = useCallback((nodeId: string): RunId => {
    const runId = newRunId();
    setState({ ...INITIAL_STATE, runId, mode: 'chapter', status: 'running', currentChapterId: nodeId });
    send({ type: 'extract-facts', runId, nodeId });
    return runId;
  }, [send]);

  const backfillAll = useCallback((workflowRef?: import('../../shared/ipc/index.js').WorkflowRefDto): RunId => {
    const runId = newRunId();
    setState({ ...INITIAL_STATE, runId, mode: 'backfill', status: 'running' });
    send({ type: 'backfill-facts', runId, ...(workflowRef === undefined ? {} : { workflowRef }) });
    return runId;
  }, [send]);

  const abort = useCallback((): void => {
    if (state.runId === undefined) return;
    send({ type: 'abort-run', runId: state.runId });
  }, [send, state.runId]);

  const resolveConflict = useCallback((optionId: string): void => {
    if (state.runId === undefined) return;
    send({ type: 'resume-run', runId: state.runId, decision: { kind: 'correct', optionId } });
    setState((prev) => ({ ...prev, status: 'running', issues: [] }));
  }, [send, state.runId]);

  const rejectConflict = useCallback((): void => {
    if (state.runId === undefined) return;
    send({ type: 'resume-run', runId: state.runId, decision: { kind: 'reject' } });
    setState((prev) => ({ ...prev, status: 'running', issues: [] }));
  }, [send, state.runId]);

  const clear = useCallback((): void => {
    setState(INITIAL_STATE);
  }, []);

  useEffect(() => {
    const off = subscribeControlEvent((event: BackendControlEvent) => {
      setState((prev) => {
        if (event.type === 'fact-extraction-started') {
          const mode = prev.runId === event.runId && prev.mode !== undefined ? prev.mode : 'chapter';
          const next = fromStarted(event, mode);
          return prev.runId === event.runId && prev.mode === 'backfill'
            ? {
                ...next,
                mode: 'backfill',
                candidateObjects: prev.candidateObjects,
                validCandidates: prev.validCandidates,
                invalidCandidates: prev.invalidCandidates,
                autoIngested: prev.autoIngested,
                conflicts: prev.conflicts,
                skipped: prev.skipped,
              }
            : next;
        }
        if (prev.runId !== event.runId) return prev;
        switch (event.type) {
          case 'fact-extraction-completed':
            return applyCompleted(prev, event);
          case 'fact-extraction-failed':
            return applyFailed(prev, event);
          case 'interrupt-raised':
            return { ...prev, status: 'interrupted', issues: event.issues };
          default:
            return prev;
        }
      });
    });
    return off;
  }, []);

  const busy = useMemo(() => state.status === 'running' || state.status === 'interrupted', [state.status]);

  return { state, busy, extractCurrentChapter, backfillAll, abort, resolveConflict, rejectConflict, clear };
}
