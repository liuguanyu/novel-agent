export type WorkflowIssueStatus = 'open' | 'fixing' | 'verifying' | 'resolved' | 'dismissed';
export type WorkflowIssueActor = 'system' | 'expert' | 'author' | 'quality-gate';

export interface WorkflowIssueHistoryEntry {
  readonly at: string;
  readonly actor: WorkflowIssueActor;
  readonly sourceRunId?: string;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly note?: string;
}

export interface WorkflowIssueTransitionEntry extends WorkflowIssueHistoryEntry {
  readonly from: WorkflowIssueStatus;
  readonly to: WorkflowIssueStatus;
}

export interface WorkflowIssueRecord {
  readonly issueId: string;
  readonly workflowId: string;
  readonly sourceAuditRunId: string;
  readonly status: WorkflowIssueStatus;
  readonly anchorRefs: ReadonlyArray<string>;
  readonly refactorRunIds: ReadonlyArray<string>;
  readonly checkpointIds: ReadonlyArray<string>;
  readonly verificationRunIds: ReadonlyArray<string>;
  readonly discoveryHistory: ReadonlyArray<WorkflowIssueHistoryEntry>;
  readonly auditHistory: ReadonlyArray<WorkflowIssueHistoryEntry>;
  readonly transitionHistory: ReadonlyArray<WorkflowIssueTransitionEntry>;
  readonly resolutionHistory: ReadonlyArray<WorkflowIssueHistoryEntry>;
  readonly resolutionReason?: string;
}

export type WorkflowIssueCommand =
  | { readonly kind: 'record-audit'; readonly runId: string; readonly actor: WorkflowIssueActor; readonly evidenceRefs?: ReadonlyArray<string>; readonly note?: string }
  | { readonly kind: 'start-fixing'; readonly runId?: string; readonly actor: 'author' | 'system' }
  | { readonly kind: 'record-checkpoint'; readonly checkpointId: string; readonly actor: 'author' | 'system' }
  | { readonly kind: 'verify'; readonly runId: string; readonly passed: boolean; readonly equivalentConflict: boolean; readonly evidenceRefs: ReadonlyArray<string> }
  | { readonly kind: 'dismiss'; readonly reason: string; readonly actor: 'author' }
  | { readonly kind: 'reopen'; readonly auditRunId: string; readonly evidenceRefs: ReadonlyArray<string> };

export type WorkflowIssueTransitionResult =
  | { readonly ok: true; readonly issue: WorkflowIssueRecord }
  | { readonly ok: false; readonly reason: 'invalid-transition' | 'missing-reason' | 'verification-required' };

const appendTransition = (issue: WorkflowIssueRecord, to: WorkflowIssueStatus, entry: WorkflowIssueHistoryEntry): WorkflowIssueRecord => ({
  ...issue,
  status: to,
  transitionHistory: [...issue.transitionHistory, { ...entry, from: issue.status, to }],
});

export function transitionWorkflowIssue(issue: WorkflowIssueRecord, command: WorkflowIssueCommand, now: string): WorkflowIssueTransitionResult {
  const base = { at: now, evidenceRefs: [] as ReadonlyArray<string> };
  if (command.kind === 'record-audit') {
    const entry: WorkflowIssueHistoryEntry = { ...base, actor: command.actor, sourceRunId: command.runId, evidenceRefs: command.evidenceRefs ?? [], ...(command.note === undefined ? {} : { note: command.note }) };
    return { ok: true, issue: { ...issue, auditHistory: [...issue.auditHistory, entry] } };
  }
  if (command.kind === 'start-fixing') {
    if (issue.status !== 'open' && issue.status !== 'fixing') return { ok: false, reason: 'invalid-transition' };
    const entry = { ...base, actor: command.actor, ...(command.runId === undefined ? {} : { sourceRunId: command.runId }) };
    let next = issue.status === 'open' ? appendTransition(issue, 'fixing', entry) : issue;
    if (command.runId !== undefined && !next.refactorRunIds.includes(command.runId)) {
      next = { ...next, refactorRunIds: [...next.refactorRunIds, command.runId] };
    }
    return { ok: true, issue: next };
  }
  if (command.kind === 'record-checkpoint') {
    if (issue.status !== 'fixing') return { ok: false, reason: 'invalid-transition' };
    const next = appendTransition({ ...issue, checkpointIds: [...issue.checkpointIds, command.checkpointId] }, 'verifying', { ...base, actor: command.actor, evidenceRefs: [command.checkpointId] });
    return { ok: true, issue: next };
  }
  if (command.kind === 'verify') {
    if (issue.status !== 'verifying') return { ok: false, reason: 'verification-required' };
    const evidence = { ...base, actor: 'quality-gate' as const, sourceRunId: command.runId, evidenceRefs: command.evidenceRefs };
    const target = command.passed && !command.equivalentConflict ? 'resolved' : 'fixing';
    let next = appendTransition({ ...issue, verificationRunIds: [...issue.verificationRunIds, command.runId] }, target, evidence);
    if (target === 'resolved') next = { ...next, resolutionReason: 'targeted-verification-passed', resolutionHistory: [...next.resolutionHistory, evidence] };
    return { ok: true, issue: next };
  }
  if (command.kind === 'dismiss') {
    if (command.reason.trim() === '') return { ok: false, reason: 'missing-reason' };
    if (!['open', 'fixing', 'verifying'].includes(issue.status)) return { ok: false, reason: 'invalid-transition' };
    const entry = { ...base, actor: command.actor, note: command.reason };
    return { ok: true, issue: { ...appendTransition(issue, 'dismissed', entry), resolutionReason: command.reason, resolutionHistory: [...issue.resolutionHistory, entry] } };
  }
  if (issue.status !== 'resolved') return { ok: false, reason: 'invalid-transition' };
  const entry = { ...base, actor: 'quality-gate' as const, sourceRunId: command.auditRunId, evidenceRefs: command.evidenceRefs, note: 'reopened' };
  const reopened = appendTransition(issue, 'open', entry);
  const { resolutionReason: _resolutionReason, ...withoutResolutionReason } = reopened;
  void _resolutionReason;
  return { ok: true, issue: { ...withoutResolutionReason, auditHistory: [...reopened.auditHistory, entry], resolutionHistory: [...reopened.resolutionHistory, entry] } };
}
