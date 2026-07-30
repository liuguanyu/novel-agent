import type { StageImpactStatus, WorkflowArtifactRef, WorkflowBlockingReason, WorkflowInstance, WorkflowStageInstance, WorkflowTemplate } from './types.js';

export type WorkflowCommand =
  | { readonly kind: 'start-stage'; readonly runId?: string }
  | { readonly kind: 'attach-run'; readonly runId: string }
  | { readonly kind: 'run-succeeded'; readonly runId: string; readonly artifactRefs?: ReadonlyArray<WorkflowArtifactRef> }
  | { readonly kind: 'run-failed'; readonly runId: string; readonly message?: string }
  | { readonly kind: 'run-interrupted'; readonly runId: string; readonly message?: string }
  | { readonly kind: 'resume-interrupted-run'; readonly runId: string }
  | { readonly kind: 'confirm-stage'; readonly confirmationId: string; readonly transition?: 'completed' | 'continue-loop' | 'finish-loop' }
  | { readonly kind: 'quality-gate-result'; readonly runId: string; readonly passed: boolean; readonly issueIds?: ReadonlyArray<string>; readonly transition?: 'quality-failed' | 'issues-found' }
  | { readonly kind: 'retry-stage'; readonly runId: string }
  | { readonly kind: 'skip-stage' }
  | { readonly kind: 'set-impact'; readonly impactStatus: StageImpactStatus; readonly blockingReason?: WorkflowBlockingReason }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'complete-workflow' };

export interface WorkflowCommandEnvelope {
  readonly operationId: string;
  readonly expectedVersion: number;
  readonly at: string;
  readonly command: WorkflowCommand;
}

export type WorkflowTransitionError = 'version-conflict' | 'invalid-transition' | 'stage-not-found' | 'run-not-attached' | 'not-skippable' | 'confirmation-required' | 'quality-evidence-required';
export type WorkflowTransitionResult =
  | { readonly ok: true; readonly workflow: WorkflowInstance; readonly idempotent: boolean }
  | { readonly ok: false; readonly reason: WorkflowTransitionError; readonly workflow: WorkflowInstance };

export function createWorkflowInstance(
  template: WorkflowTemplate,
  input: { workflowId: string; projectId: string; objective: string; authorIntents?: import('./types.js').AuthorIntent[]; scope: WorkflowStageInstance['scope']; at: string },
): WorkflowInstance {
  const stages = template.stages.map((definition, index): WorkflowStageInstance => ({
    stageId: `${input.workflowId}:${definition.id}`,
    templateStageId: definition.id,
    status: index === 0 ? 'ready' : 'pending', impactStatus: 'none', actor: definition.actor,
    scope: input.scope, runIds: [], artifactRefs: [], completionEvidence: [],
  }));
  const first = stages[0];
  if (first === undefined) throw new Error('Workflow template must contain a stage');
  return { workflowId: input.workflowId, projectId: input.projectId, kind: template.kind, templateVersion: template.version,
    objective: input.objective, authorIntents: input.authorIntents ?? [], status: 'active', currentStageId: first.stageId, stages, version: 0,
    appliedOperationIds: [], createdAt: input.at, updatedAt: input.at };
}

const replaceCurrent = (workflow: WorkflowInstance, stage: WorkflowStageInstance): WorkflowInstance => ({
  ...workflow, stages: workflow.stages.map((item) => item.stageId === stage.stageId ? stage : item),
});

export function transitionWorkflow(workflow: WorkflowInstance, template: WorkflowTemplate, envelope: WorkflowCommandEnvelope): WorkflowTransitionResult {
  if (workflow.appliedOperationIds.includes(envelope.operationId)) return { ok: true, workflow, idempotent: true };
  if (workflow.version !== envelope.expectedVersion) return { ok: false, reason: 'version-conflict', workflow };
  const current = workflow.stages.find((item) => item.stageId === workflow.currentStageId);
  const definition = current === undefined ? undefined : template.stages.find((item) => item.id === current.templateStageId);
  if (current === undefined || definition === undefined) return { ok: false, reason: 'stage-not-found', workflow };
  const fail = (reason: WorkflowTransitionError): WorkflowTransitionResult => ({ ok: false, reason, workflow });
  const command = envelope.command;
  let next = workflow;

  if (command.kind === 'pause' || command.kind === 'resume' || command.kind === 'cancel' || command.kind === 'complete-workflow') {
    if (command.kind === 'pause' && workflow.status === 'active') next = { ...workflow, status: 'paused' };
    else if (command.kind === 'resume' && workflow.status === 'paused') next = { ...workflow, status: 'active' };
    else if (command.kind === 'cancel' && ['active', 'paused'].includes(workflow.status)) next = { ...workflow, status: 'cancelled' };
    else if (command.kind === 'complete-workflow' && current.status === 'completed' && definition.transitions.length === 0) next = { ...workflow, status: 'completed' };
    else return fail('invalid-transition');
  } else if (workflow.status !== 'active') return fail('invalid-transition');
  else if (command.kind === 'start-stage') {
    if (current.status !== 'ready') return fail('invalid-transition');
    next = replaceCurrent(workflow, { ...current, status: 'running', enteredAt: envelope.at,
      ...(command.runId !== undefined && !current.runIds.includes(command.runId) ? { runIds: [...current.runIds, command.runId] } : {}) });
  } else if (command.kind === 'attach-run') {
    if (!['running', 'awaiting-confirmation'].includes(current.status)) return fail('invalid-transition');
    next = replaceCurrent(workflow, current.runIds.includes(command.runId) ? current : { ...current, runIds: [...current.runIds, command.runId] });
  } else if (command.kind === 'run-failed') {
    if (!current.runIds.includes(command.runId) || current.status !== 'running') return fail('run-not-attached');
    const reason: WorkflowBlockingReason = { kind: 'failed-run', runId: command.runId, ...(command.message === undefined ? {} : { message: command.message }) };
    next = replaceCurrent(workflow, { ...current, status: 'failed', blockingReason: reason });
  } else if (command.kind === 'run-interrupted') {
    if (!current.runIds.includes(command.runId) || current.status !== 'running') return fail('run-not-attached');
    next = replaceCurrent(workflow, { ...current, status: 'blocked', blockingReason: { kind: 'interrupted-run', runId: command.runId, ...(command.message === undefined ? {} : { message: command.message }) } });
  } else if (command.kind === 'resume-interrupted-run') {
    if (current.status !== 'blocked' || current.blockingReason?.kind !== 'interrupted-run' || current.blockingReason.runId !== command.runId || !current.runIds.includes(command.runId)) return fail('invalid-transition');
    const { blockingReason: _blockingReason, ...resumedStage } = current;
    void _blockingReason;
    next = replaceCurrent(workflow, { ...resumedStage, status: 'running' });
  } else if (command.kind === 'retry-stage') {
    if (current.status !== 'failed' || !definition.retryable) return fail('invalid-transition');
    const { blockingReason: _blockingReason, ...retryStage } = current;
    void _blockingReason;
    next = replaceCurrent(workflow, { ...retryStage, status: 'running', runIds: current.runIds.includes(command.runId) ? current.runIds : [...current.runIds, command.runId] });
  } else if (command.kind === 'skip-stage') {
    if (!definition.skippable) return fail('not-skippable');
    if (!['ready', 'blocked', 'failed'].includes(current.status)) return fail('invalid-transition');
    next = advance(replaceCurrent(workflow, { ...current, status: 'skipped', completedAt: envelope.at }), template, envelope.at);
  } else if (command.kind === 'set-impact') {
    next = replaceCurrent(workflow, { ...current, impactStatus: command.impactStatus, ...(command.blockingReason === undefined ? {} : { blockingReason: command.blockingReason }) });
  } else if (command.kind === 'run-succeeded') {
    if (current.status !== 'running' || !current.runIds.includes(command.runId)) return fail('run-not-attached');
    const succeeded = { ...current, artifactRefs: [...current.artifactRefs, ...(command.artifactRefs ?? [])], completionEvidence: [...current.completionEvidence, { kind: 'run-succeeded' as const, runId: command.runId }] };
    if (definition.completionGate.kind === 'author-confirmation') next = replaceCurrent(workflow, { ...succeeded, status: 'awaiting-confirmation' });
    else if (definition.completionGate.kind === 'quality') return fail('quality-evidence-required');
    else next = advance(replaceCurrent(workflow, { ...succeeded, status: 'completed', completedAt: envelope.at }), template, envelope.at);
  } else if (command.kind === 'quality-gate-result') {
    if (current.status !== 'running' || definition.completionGate.kind !== 'quality' || !current.runIds.includes(command.runId)) return fail('quality-evidence-required');
    const assessed = { ...current, completionEvidence: [...current.completionEvidence, { kind: 'quality-gate' as const, runId: command.runId, passed: command.passed }] };
    if (command.passed) {
      next = advance(
        replaceCurrent(workflow, { ...assessed, status: 'completed', completedAt: envelope.at }),
        template,
        envelope.at,
        'completed',
      );
    } else {
      const transition = command.transition ?? (command.issueIds !== undefined && command.issueIds.length > 0 ? 'issues-found' : 'quality-failed');
      const targetId = definition.transitions.find((item) => item.when === transition)?.to;
      next = targetId === undefined
        ? replaceCurrent(workflow, { ...assessed, status: 'blocked', blockingReason: { kind: 'quality-gate', issueIds: command.issueIds ?? [] } })
        : moveToTarget(replaceCurrent(workflow, { ...assessed, status: 'completed', completedAt: envelope.at }), targetId, template, envelope.at);
    }
  } else {
    const authorCompletingOwnStep =
      current.status === 'running' &&
      current.actor === 'author' &&
      definition.completionGate.kind === 'author-confirmation';
    const confirmingExpertOutput =
      current.status === 'awaiting-confirmation' &&
      definition.completionGate.kind === 'author-confirmation';
    if (!authorCompletingOwnStep && !confirmingExpertOutput) return fail('confirmation-required');
    const completed = { ...current, status: 'completed' as const, completedAt: envelope.at, completionEvidence: [...current.completionEvidence, { kind: 'author-confirmation' as const, confirmationId: command.confirmationId }] };
    next = advance(replaceCurrent(workflow, completed), template, envelope.at, command.transition ?? 'completed');
  }
  return { ok: true, idempotent: false, workflow: { ...next, version: next.version + 1, updatedAt: envelope.at, appliedOperationIds: [...next.appliedOperationIds, envelope.operationId] } };
}

function advance(
  workflow: WorkflowInstance,
  template: WorkflowTemplate,
  at: string,
  condition: 'completed' | 'continue-loop' | 'finish-loop' | 'quality-failed' | 'issues-found' = 'completed',
): WorkflowInstance {
  const current = workflow.stages.find((item) => item.stageId === workflow.currentStageId);
  const definition = template.stages.find((item) => item.id === current?.templateStageId);
  const targetId = definition?.transitions.find((item) => item.when === condition)?.to;
  if (targetId === undefined) return { ...workflow, status: 'completed' };
  return moveToTarget(workflow, targetId, template, at);
}

function moveToTarget(workflow: WorkflowInstance, targetId: string, template: WorkflowTemplate, at: string): WorkflowInstance {
  const targetDefinition = template.stages.find((item) => item.id === targetId);
  const target = workflow.stages.find((item) => item.templateStageId === targetId);
  if (targetDefinition === undefined || target === undefined) return { ...workflow, status: 'completed' };
  return { ...replaceCurrent(workflow, { ...target, status: 'ready', enteredAt: at }), currentStageId: target.stageId };
}
