import { subscribeControlEvent } from '../lib/ipc-event-bus.js';
import { useCallback, useEffect, useState } from 'react';
import type { BackendControlEvent, WorkflowSnapshotDto } from '../../shared/ipc/index.js';

// workflowStageView / WorkflowStageView 已迁往纯投影层 ../lib/workbench-view-contracts.ts（供组件与 node 冲烟复用）。

export interface UseWorkflowSnapshotResult {
  readonly snapshot: WorkflowSnapshotDto | null;
  readonly failure: string | undefined;
  readonly loading: boolean;
  readonly reload: () => void;
  readonly acceptSnapshot: (snapshot: WorkflowSnapshotDto) => void;
}

/** 按项目读取持久化 workflow，并以 control event 增量更新；没有 projectId 时保持 standalone。 */
export function useWorkflowSnapshot(projectId: string | undefined): UseWorkflowSnapshotResult {
  const [snapshot, setSnapshot] = useState<WorkflowSnapshotDto | null>(null);
  const [failure, setFailure] = useState<string>();
  const [loading, setLoading] = useState(false);
  const reload = useCallback(() => {
    if (projectId === undefined) { setSnapshot(null); return; }
    setLoading(true);
    window.novelAgent.getActiveWorkflow(projectId).then((response) => { setSnapshot(response.snapshot); setFailure(undefined); }).catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error))).finally(() => setLoading(false));
  }, [projectId]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const off = subscribeControlEvent((event: BackendControlEvent) => {
      if (event.type === 'workflow-snapshot' && (projectId === undefined || event.snapshot.projectId === projectId)) { setSnapshot(event.snapshot); setFailure(undefined); }
      if (event.type === 'workflow-failure' && (projectId === undefined || event.snapshot?.projectId === projectId)) { setFailure(event.error.message); if (event.snapshot !== undefined) setSnapshot(event.snapshot); }
    });
    return off;
  }, [projectId]);
  const acceptSnapshot = useCallback((next: WorkflowSnapshotDto): void => {
    if (projectId !== undefined && next.projectId !== projectId) return;
    setSnapshot(next);
    setFailure(undefined);
  }, [projectId]);
  return { snapshot, failure, loading, reload, acceptSnapshot };
}
