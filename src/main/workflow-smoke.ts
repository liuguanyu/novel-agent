import assert from 'node:assert/strict';
import {
  LEGACY_BOOK_REVISION_TEMPLATE,
  NEW_BOOK_CREATION_TEMPLATE,
  buildLegacyRevisionDiagnosis,
  createWorkflowInstance,
  transitionWorkflow,
  transitionWorkflowIssue,
  type WorkflowCommand,
  type WorkflowIssueRecord,
} from '../core/workflow/index.js';
import { asEntityId, asFactVersionId, type FactView } from '../core/story-bible/index.js';
import { asNodeId } from '../core/manuscript/index.js';

const at = '2026-01-01T00:00:00.000Z';
let workflow = createWorkflowInstance(NEW_BOOK_CREATION_TEMPLATE, {
  workflowId: 'workflow-1', projectId: 'project-1', objective: 'write a book',
  scope: { kind: 'project', projectId: 'project-1' }, at,
});
let operation = 0;
const apply = (command: WorkflowCommand): ReturnType<typeof transitionWorkflow> => {
  operation += 1;
  const result = transitionWorkflow(workflow, NEW_BOOK_CREATION_TEMPLATE, {
    operationId: `operation-${operation}`, expectedVersion: workflow.version, at, command,
  });
  if (result.ok) workflow = result.workflow;
  return result;
};

// Illegal transition/skip leaves the original aggregate untouched.
const beforeSkip = workflow;
const illegalSkip = apply({ kind: 'skip-stage' });
assert.equal(illegalSkip.ok, false);
assert.equal(illegalSkip.ok ? '' : illegalSkip.reason, 'not-skippable');
assert.strictEqual(workflow, beforeSkip);

assert.equal(apply({ kind: 'start-stage' }).ok, true);
assert.equal(apply({ kind: 'attach-run', runId: 'run-1' }).ok, true);
assert.equal(apply({ kind: 'run-succeeded', runId: 'run-1' }).ok, true);
assert.equal(workflow.stages[0]?.status, 'awaiting-confirmation');
assert.equal(workflow.currentStageId, 'workflow-1:concept'); // Human gate does not auto-advance.
assert.equal(apply({ kind: 'confirm-stage', confirmationId: 'confirmation-1' }).ok, true);
assert.equal(workflow.currentStageId, 'workflow-1:worldbuilding');

// Loop decisions are explicit in the template (the runtime can choose continue vs finish).
assert.equal(
  NEW_BOOK_CREATION_TEMPLATE.stages.find((item) => item.id === 'chapter-finalization')?.transitions.some((item) => item.when === 'continue-loop'),
  true,
);
assert.equal(
  LEGACY_BOOK_REVISION_TEMPLATE.stages.find((item) => item.id === 'targeted-verification')?.transitions.some((item) => item.when === 'quality-failed'),
  true,
);

// Failure does not advance; retry appends, rather than replaces, run history.
assert.equal(apply({ kind: 'start-stage' }).ok, true);
assert.equal(apply({ kind: 'attach-run', runId: 'run-2' }).ok, true);
assert.equal(apply({ kind: 'run-failed', runId: 'run-2' }).ok, true);
assert.equal(workflow.currentStageId, 'workflow-1:worldbuilding');
assert.equal(apply({ kind: 'retry-stage', runId: 'run-3' }).ok, true);
assert.deepEqual(workflow.stages[1]?.runIds, ['run-2', 'run-3']);

// Replaying an operation is idempotent even if its expected version is old.
const idempotentEnvelope = { operationId: 'idempotent-impact', expectedVersion: workflow.version, at,
  command: { kind: 'set-impact', impactStatus: 'needs-review' } as const };
const impactResult = transitionWorkflow(workflow, NEW_BOOK_CREATION_TEMPLATE, idempotentEnvelope);
assert.equal(impactResult.ok, true);
assert.equal(impactResult.ok && impactResult.workflow.stages[1]?.status, 'running');
assert.equal(impactResult.ok && impactResult.workflow.stages[1]?.impactStatus, 'needs-review');
if (!impactResult.ok) throw new Error('unreachable');
const replay = transitionWorkflow(impactResult.workflow, NEW_BOOK_CREATION_TEMPLATE, idempotentEnvelope);
assert.equal(replay.ok && replay.idempotent, true);
assert.strictEqual(replay.workflow, impactResult.workflow);

// Issue can resolve only after checkpoint -> verifying -> structured verification, then reopen.
let issue: WorkflowIssueRecord = {
  issueId: 'issue-1', workflowId: workflow.workflowId, sourceAuditRunId: 'audit-1', status: 'open',
  anchorRefs: ['chapter-1:node-1'], refactorRunIds: [], checkpointIds: [], verificationRunIds: [],
  discoveryHistory: [{ at, actor: 'quality-gate', sourceRunId: 'audit-1', evidenceRefs: ['finding-1'] }],
  auditHistory: [], transitionHistory: [], resolutionHistory: [],
};
const premature = transitionWorkflowIssue(issue, { kind: 'verify', runId: 'verify-0', passed: true, equivalentConflict: false, evidenceRefs: [] }, at);
assert.equal(premature.ok, false);
const issueApply = (command: Parameters<typeof transitionWorkflowIssue>[1]): void => {
  const result = transitionWorkflowIssue(issue, command, at);
  assert.equal(result.ok, true);
  if (result.ok) issue = result.issue;
};
issueApply({ kind: 'start-fixing', actor: 'author', runId: 'refactor-1' });
issueApply({ kind: 'record-checkpoint', actor: 'system', checkpointId: 'checkpoint-1' });
issueApply({ kind: 'verify', runId: 'verify-1', passed: true, equivalentConflict: false, evidenceRefs: ['report-1'] });
assert.equal(issue.status, 'resolved');
issueApply({ kind: 'reopen', auditRunId: 'audit-2', evidenceRefs: ['recurrence-1'] });
assert.equal(issue.status, 'open');
assert.equal(issue.resolutionHistory.length, 2);
assert.equal(issue.transitionHistory.at(-1)?.from, 'resolved');

const diagnosisView: FactView = {
  version: asFactVersionId('fact-diagnosis'),
  entities: [{
    id: asEntityId('person-gu'), type: 'person', canonicalName: '顾长风',
    aliasSet: { aliases: ['顾长风'], status: 'inferred', provenance: { sources: [{ location: { id: asNodeId('chapter-1'), kind: 'chapter' }, quote: '顾长风没有发作。', confidence: 0.9 }] } },
    attributes: [{ key: 'personality', value: '克制', status: 'inferred', provenance: { sources: [{ location: { id: asNodeId('chapter-1'), kind: 'chapter' }, quote: '顾长风没有发作。', confidence: 0.9 }] } }],
    status: 'inferred', provenance: { sources: [{ location: { id: asNodeId('chapter-1'), kind: 'chapter' }, quote: '顾长风没有发作。', confidence: 0.9 }] },
  }],
  timeline: { events: [] }, relations: [], plotHooks: [],
};
const diagnosis = buildLegacyRevisionDiagnosis([
  { kind: 'preserve', text: '保留茶馆冲突' },
  { kind: 'extract', text: '提取顾长风的性格特征' },
  { kind: 'remove', text: '去掉前后矛盾' },
], diagnosisView, [{
  issueId: 'issue-contradiction',
  issue: { type: 'state-contradiction', severity: 'critical', anchors: [{ id: asNodeId('chapter-2'), kind: 'chapter' }], description: '八音盒持有人前后矛盾', requiresHumanDecision: false },
}], 1);
assert.equal(diagnosis.preservation[0]?.status, 'pending');
assert.equal(diagnosis.characterExtraction[0]?.matches[0]?.details?.[0]?.includes('克制'), true);
assert.deepEqual(diagnosis.removals[0]?.linkedIssueIds, ['issue-contradiction']);

// Built-in templates expose required key paths and explicit manual/quality boundaries.
const newPath = NEW_BOOK_CREATION_TEMPLATE.stages.map((item) => item.id);
assert.deepEqual(newPath.slice(0, 4), ['concept', 'worldbuilding', 'character-design', 'book-outline']);
assert.ok(newPath.indexOf('fact-extraction') < newPath.indexOf('automatic-review'));
assert.equal(NEW_BOOK_CREATION_TEMPLATE.stages.find((item) => item.id === 'chapter-finalization')?.actor, 'author');
const legacyPath = LEGACY_BOOK_REVISION_TEMPLATE.stages.map((item) => item.id);
assert.ok(legacyPath.indexOf('hunk-review') < legacyPath.indexOf('apply-checkpoint'));
assert.ok(legacyPath.indexOf('apply-checkpoint') < legacyPath.indexOf('targeted-verification'));
assert.equal(LEGACY_BOOK_REVISION_TEMPLATE.stages.find((item) => item.id === 'hunk-review')?.completionGate.kind, 'author-confirmation');

console.log('workflow smoke: ok');
