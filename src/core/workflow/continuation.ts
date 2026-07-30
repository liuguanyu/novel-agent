import type { WorkflowRef } from './types.js';

export type ContinuationScope =
  | { readonly kind: 'standalone'; readonly runId: string }
  | { readonly kind: 'workflow'; readonly workflowRef: WorkflowRef; readonly runId: string }
  | { readonly kind: 'issue'; readonly workflowRef: WorkflowRef; readonly issueId: string; readonly runId: string }
  | { readonly kind: 'asset'; readonly assetId: string; readonly changeSetId?: string; readonly runId: string };

export type WorkflowContinuation =
  | { readonly kind: 'resume-source-node'; readonly sourceNode: string }
  | { readonly kind: 'resume-stage'; readonly targetTemplateStageId: string }
  | { readonly kind: 'resume-issue-fix'; readonly issueId: string }
  | { readonly kind: 'resume-asset-maintenance'; readonly assetId: string };

export interface InterruptContinuationRecord {
  readonly interruptId: string;
  readonly scope: ContinuationScope;
  readonly sourceNode: string;
  readonly continuation: WorkflowContinuation;
  readonly allowedDecisionKinds: ReadonlyArray<string>;
  readonly createdAt: string;
}

export type ContinuationValidationResult =
  | { readonly ok: true; readonly continuation: WorkflowContinuation }
  | { readonly ok: false; readonly reason: 'decision-not-allowed' | 'scope-mismatch' };

function sameScope(left: ContinuationScope, right: ContinuationScope): boolean {
  if (left.kind !== right.kind || left.runId !== right.runId) return false;
  if (left.kind === 'standalone' || right.kind === 'standalone') return left.kind === right.kind;
  if (left.kind === 'asset' || right.kind === 'asset') {
    return left.kind === 'asset' && right.kind === 'asset'
      && left.assetId === right.assetId && left.changeSetId === right.changeSetId;
  }
  if (left.workflowRef.workflowId !== right.workflowRef.workflowId
    || left.workflowRef.stageId !== right.workflowRef.stageId
    || left.workflowRef.issueId !== right.workflowRef.issueId) return false;
  if (left.kind === 'issue' || right.kind === 'issue') {
    return left.kind === 'issue' && right.kind === 'issue' && left.issueId === right.issueId;
  }
  return true;
}

/** Core continuation resolver: validates decision and exact persisted ownership before exposing the route. */
export function resolveContinuation(
  record: InterruptContinuationRecord,
  decisionKind: string,
  scope: ContinuationScope,
): ContinuationValidationResult {
  if (!record.allowedDecisionKinds.includes(decisionKind)) return { ok: false, reason: 'decision-not-allowed' };
  if (!sameScope(record.scope, scope)) return { ok: false, reason: 'scope-mismatch' };
  return { ok: true, continuation: record.continuation };
}

/** Backward-compatible name. */
export const validateContinuation = resolveContinuation;
