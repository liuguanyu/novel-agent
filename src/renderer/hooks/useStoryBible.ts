/** Story Bible 面板数据与确认事实 hook。 */
import { subscribeControlEvent } from '../lib/ipc-event-bus.js';

import { useCallback, useEffect, useState } from 'react';
import type {
  BackendControlEvent,
  FrontendCommandMessage,
  RunId,
  StoryBibleDto,
  StoryBibleFactDeleteLocatorDto,
  StoryBibleFactEditDto,
  StoryBibleFactLocatorDto,
} from '../../shared/ipc/index.js';

export interface UseStoryBibleResult {
  bible: StoryBibleDto | undefined;
  loading: boolean;
  confirming: boolean;
  editing: boolean;
  deleting: boolean;
  merging: boolean;
  error: string | undefined;
  confirmationMessage: string | undefined;
  refresh(): void;
  confirmFact(target: StoryBibleFactLocatorDto): RunId;
  editFact(edit: StoryBibleFactEditDto): RunId;
  deleteFact(target: StoryBibleFactDeleteLocatorDto): RunId;
  mergeEntities(sourceEntityId: string, targetEntityId: string): RunId;
}

function newRunId(): RunId {
  return crypto.randomUUID() as RunId;
}

export function useStoryBible(autoLoad: boolean): UseStoryBibleResult {
  const [bible, setBible] = useState<StoryBibleDto | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [confirmingRunId, setConfirmingRunId] = useState<RunId | undefined>(undefined);
  const [editingRunId, setEditingRunId] = useState<RunId | undefined>(undefined);
  const [deletingRunId, setDeletingRunId] = useState<RunId | undefined>(undefined);
  const [mergingRunId, setMergingRunId] = useState<RunId | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmationMessage, setConfirmationMessage] = useState<string | undefined>(undefined);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(undefined);
    window.novelAgent
      .getStoryBible()
      .then((dto) => {
        setBible(dto);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  const send = useCallback((command: FrontendCommandMessage): void => {
    window.novelAgent.sendCommand(command);
  }, []);

  const confirmFact = useCallback((target: StoryBibleFactLocatorDto): RunId => {
    const runId = newRunId();
    setConfirmingRunId(runId);
    setError(undefined);
    setConfirmationMessage(undefined);
    send({ type: 'confirm-story-bible-fact', runId, target });
    return runId;
  }, [send]);

  const editFact = useCallback((edit: StoryBibleFactEditDto): RunId => {
    const runId = newRunId();
    setEditingRunId(runId);
    setError(undefined);
    setConfirmationMessage(undefined);
    send({ type: 'edit-story-bible-fact', runId, edit });
    return runId;
  }, [send]);

  const deleteFact = useCallback((target: StoryBibleFactDeleteLocatorDto): RunId => {
    const runId = newRunId();
    setDeletingRunId(runId);
    setError(undefined);
    setConfirmationMessage(undefined);
    send({ type: 'delete-story-bible-fact', runId, target });
    return runId;
  }, [send]);

  const mergeEntities = useCallback((sourceEntityId: string, targetEntityId: string): RunId => {
    const runId = newRunId();
    setMergingRunId(runId);
    setError(undefined);
    setConfirmationMessage(undefined);
    send({ type: 'merge-story-bible-entities', runId, sourceEntityId, targetEntityId });
    return runId;
  }, [send]);

  useEffect(() => {
    if (autoLoad && bible === undefined && !loading) refresh();
  }, [autoLoad, bible, loading, refresh]);

  useEffect(() => {
    const off = subscribeControlEvent((event: BackendControlEvent) => {
      // 事实抽取完成且有新版本落库时，Story Bible 是廉价 DB 读取，直接自动刷新。
      if (event.type === 'fact-extraction-completed' && event.factVersion !== undefined) {
        refresh();
        return;
      }
      if (confirmingRunId !== undefined && event.runId === confirmingRunId) {
        switch (event.type) {
          case 'story-bible-fact-confirmed':
            setConfirmingRunId(undefined);
            setConfirmationMessage(`已确认事实，版本 ${event.factVersion}`);
            refresh();
            return;
          case 'story-bible-fact-confirmation-failed':
            setConfirmingRunId(undefined);
            setError(event.error.message);
            return;
          default:
            return;
        }
      }
      if (editingRunId !== undefined && event.runId === editingRunId) {
        switch (event.type) {
          case 'story-bible-fact-edited':
            setEditingRunId(undefined);
            setConfirmationMessage(`已编辑事实并生成版本 ${event.factVersion}。原文未改变；既有诊断已标记为可能过期，建议重新运行全书诊断。`);
            refresh();
            return;
          case 'story-bible-fact-edit-failed':
            setEditingRunId(undefined);
            setError(event.error.message);
            return;
          default:
            return;
        }
      }
      if (deletingRunId !== undefined && event.runId === deletingRunId) {
        switch (event.type) {
          case 'story-bible-fact-deleted':
            setDeletingRunId(undefined);
            setConfirmationMessage(`已删除事实并生成版本 ${event.factVersion}。原文未改变；既有诊断已标记为可能过期，建议重新运行全书诊断。`);
            refresh();
            return;
          case 'story-bible-fact-delete-failed':
            setDeletingRunId(undefined);
            setError(event.error.message);
            return;
          default:
            return;
        }
      }
      if (mergingRunId !== undefined && event.runId === mergingRunId) {
        switch (event.type) {
          case 'story-bible-entities-merged':
            setMergingRunId(undefined);
            setConfirmationMessage(`已合并实体并生成版本 ${event.factVersion}。源实体引用已迁移后删除；原文未改变，建议重新运行全书诊断。`);
            refresh();
            return;
          case 'story-bible-entities-merge-failed':
            setMergingRunId(undefined);
            setError(event.error.message);
            return;
          default:
            return;
        }
      }
    });
    return off;
  }, [confirmingRunId, editingRunId, deletingRunId, mergingRunId, refresh]);

  return {
    bible,
    loading,
    confirming: confirmingRunId !== undefined,
    editing: editingRunId !== undefined,
    deleting: deletingRunId !== undefined,
    merging: mergingRunId !== undefined,
    error,
    confirmationMessage,
    refresh,
    confirmFact,
    editFact,
    deleteFact,
    mergeEntities,
  };
}
