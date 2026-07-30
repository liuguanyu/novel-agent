import { useCallback, useEffect, useState } from 'react';
import type { BackendControlEvent, WorkflowSnapshotDto } from '../../shared/ipc/index.js';

export interface WorkflowStageView {
  readonly id: string;
  readonly name: string;
  readonly actor: string | undefined;
  readonly status: string | undefined;
  readonly impactStatus: string | undefined;
  readonly nextStep: string | undefined;
  readonly blocking: string | undefined;
  readonly allowedActions: ReadonlyArray<string>;
}

export function workflowStageView(stage: Record<string, unknown>): WorkflowStageView {
  const text = (key: string): string | undefined => typeof stage[key] === 'string' ? stage[key] as string : undefined;
  const actions = stage['allowedActions'];
  return { id: text('stageId') ?? text('id') ?? 'stage', name: text('name') ?? text('label') ?? text('stageId') ?? '阶段', actor: text('actor'), status: text('status'), impactStatus: text('impactStatus'), nextStep: text('nextStep') ?? text('next'), blocking: text('blocking') ?? text('blockedBy'), allowedActions: Array.isArray(actions) ? actions.filter((x): x is string => typeof x === 'string') : [] };
}

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
    const off = window.novelAgent.onControlEvent((event: BackendControlEvent) => {
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
