import { useEffect, useState } from 'react';
import type { AssetImpactDto, BackendControlEvent, CreativeAssetCandidateDto, WorkflowSnapshotDto } from '../../shared/ipc/index.js';

export interface UseAssetReviewResult {
  readonly candidates: ReadonlyArray<CreativeAssetCandidateDto>;
  readonly currentAssets: Readonly<Record<string, Record<string, unknown>>>;
  readonly impacts: ReadonlyArray<AssetImpactDto>;
  readonly pendingIds: ReadonlySet<string>;
  readonly error: string | undefined;
  readonly confirmCandidate: (candidate: CreativeAssetCandidateDto) => void;
  readonly rejectCandidate: (candidate: CreativeAssetCandidateDto) => void;
  readonly resolveImpact: (impact: AssetImpactDto, intent: 'handle-now' | 'todo' | 'continue') => void;
}

/** 收集 Main 下发的待审资产事件；所有按钮只经 workflow command 上报意图。 */
export function useAssetReview(workflow: WorkflowSnapshotDto | null): UseAssetReviewResult {
  const [candidates, setCandidates] = useState<ReadonlyArray<CreativeAssetCandidateDto>>([]);
  const [currentAssets, setCurrentAssets] = useState<Readonly<Record<string, Record<string, unknown>>>>({});
  const [impacts, setImpacts] = useState<ReadonlyArray<AssetImpactDto>>([]);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  useEffect(() => {
    setCandidates([]);
    setCurrentAssets({});
    setImpacts([]);
    setPendingIds(new Set());
    setError(undefined);
  }, [workflow?.workflowId]);
  useEffect(() => window.novelAgent.onControlEvent((event: BackendControlEvent) => {
    if (workflow === null) return;
    if (event.type === 'creative-asset-change-proposed' && event.candidate.workflowRef?.workflowId === workflow.workflowId) {
      setCandidates((old) => old.some((item) => item.candidateId === event.candidate.candidateId) ? old : [...old, event.candidate]);
    }
    if (event.type === 'asset-impact-detected' && event.impact.workflowRef?.workflowId === workflow.workflowId) {
      setImpacts((old) => old.some((item) => item.impactId === event.impact.impactId) ? old : [...old, event.impact]);
    }
  }), [workflow]);
  useEffect(() => {
    if (workflow === null || candidates.length === 0) return;
    let active = true;
    void Promise.all(candidates.filter((candidate) => candidate.assetId).map(async (candidate) => {
      const response = await window.novelAgent.getWorkflowAsset({ assetId: candidate.assetId, projectId: workflow.projectId });
      if (response.asset === null) return undefined;
      const content = response.asset['content'];
      return [candidate.assetId, content !== null && typeof content === 'object' && !Array.isArray(content) ? content as Record<string, unknown> : { value: content }] as const;
    })).then((entries) => {
      if (!active) return;
      setCurrentAssets((old) => ({ ...old, ...Object.fromEntries(entries.filter((entry): entry is readonly [string, Record<string, unknown>] => entry !== undefined)) }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [candidates, workflow]);
  const finishPending = (id: string): void => setPendingIds((old) => {
    const next = new Set(old);
    next.delete(id);
    return next;
  });
  const sendCandidate = (candidate: CreativeAssetCandidateDto, action: 'confirm-asset-change' | 'reject-asset-change'): void => {
    if (workflow === null || pendingIds.has(candidate.candidateId)) return;
    const stageId = candidate.workflowRef?.stageId ?? workflow.currentStageId;
    setError(undefined);
    setPendingIds((old) => new Set(old).add(candidate.candidateId));
    void window.novelAgent.sendWorkflowCommand({ type: `workflow-${action}`, workflowId: workflow.workflowId, ...(stageId !== null && stageId !== undefined ? { stageId } : {}), candidateId: candidate.candidateId, requestId: crypto.randomUUID(), operationId: crypto.randomUUID(), expectedVersion: workflow.version }).then((response) => {
      if (response.failure !== undefined) { setError(response.failure.error.message); return; }
      if (response.snapshot !== null) setCandidates((old) => old.filter((item) => item.candidateId !== candidate.candidateId));
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => finishPending(candidate.candidateId));
  };
  return {
    candidates: candidates.filter((item) => item.status === undefined || item.status === 'pending'),
    currentAssets,
    impacts,
    pendingIds,
    error,
    confirmCandidate: (candidate) => sendCandidate(candidate, 'confirm-asset-change'),
    rejectCandidate: (candidate) => sendCandidate(candidate, 'reject-asset-change'),
    resolveImpact: (impact, intent) => {
      if (workflow === null || pendingIds.has(impact.impactId)) return;
      const stageId = impact.workflowRef?.stageId ?? workflow.currentStageId;
      setError(undefined);
      setPendingIds((old) => new Set(old).add(impact.impactId));
      void window.novelAgent.sendWorkflowCommand({ type: 'workflow-resolve-asset-impact', workflowId: workflow.workflowId, ...(stageId !== null && stageId !== undefined ? { stageId } : {}), assetId: impact.assetId, impactId: impact.impactId, result: intent, requestId: crypto.randomUUID(), operationId: crypto.randomUUID(), expectedVersion: workflow.version }).then((response) => {
        if (response.failure !== undefined) { setError(response.failure.error.message); return; }
        if (response.snapshot !== null) setImpacts((old) => old.filter((item) => item.impactId !== impact.impactId));
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => finishPending(impact.impactId));
    },
  };
}
