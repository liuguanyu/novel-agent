import type { InterruptContinuationRecord, WorkflowRef } from '../../core/workflow/index.js';
import type { ContinuationRecordService, StageRunEvidenceRecorder } from '../orchestration/runtime.js';
import type { SqliteDatabase } from './sqlite-database.js';
import { WorkflowRepository } from './workflow-repository.js';
import { getBuiltinWorkflowTemplate } from '../../core/workflow/templates.js';

async function assertWorkflowStage(db: SqliteDatabase, ref: WorkflowRef, requireCurrentStage = false): Promise<void> {
  const row = await db.get(
    `SELECT 1 FROM workflow_stages s JOIN workflow_instances w ON w.workflow_id=s.workflow_id
     WHERE w.workflow_id=? AND s.stage_id=?${requireCurrentStage ? ' AND w.current_stage_id=s.stage_id' : ''}`,
    ref.workflowId, ref.stageId,
  );
  if (row === null) throw new Error(requireCurrentStage ? 'workflowRef.stageId must equal current stage' : 'stage does not belong to workflow');
}

/** Durable, ownership-enforcing stage run evidence recorder. */
export class SqliteStageRunEvidenceRecorder implements StageRunEvidenceRecorder {
  constructor(private readonly db: SqliteDatabase) {}

  async record(input: Parameters<StageRunEvidenceRecorder['record']>[0]): Promise<void> {
    const now = Date.now();
    await this.db.transaction(async (tx) => {
      // Ownership and the evidence write are deliberately atomic: stage advancement can
      // never race a stale run into workflow_stage_runs.
      await assertWorkflowStage(tx, input.workflowRef, true);
      if (input.workflowRef.issueId !== undefined) {
        const issue = await tx.get('SELECT 1 FROM workflow_issues WHERE issue_id=? AND workflow_id=?', input.workflowRef.issueId, input.workflowRef.workflowId);
        if (issue === null) throw new Error('issue does not belong to workflow');
      }
      if (input.status === 'completed') {
        const workflowRow = await tx.get('SELECT kind,template_version FROM workflow_instances WHERE workflow_id=?', input.workflowRef.workflowId);
        if (workflowRow === null) throw new Error('unknown workflow');
        const template = getBuiltinWorkflowTemplate(String(workflowRow['kind']) as 'new-book-creation' | 'legacy-book-revision', Number(workflowRow['template_version']));
        const stageRow = await tx.get('SELECT template_stage_id FROM workflow_stages WHERE stage_id=?', input.workflowRef.stageId);
        const definition = template?.stages.find((stage) => stage.id === String(stageRow?.['template_stage_id']));
        if (definition?.completionGate.kind === 'quality' && input.completion === undefined) throw new Error('quality evidence required: completion outcome (passed and issueIds)');
      }
      await tx.run(
        `INSERT INTO workflow_stage_runs(stage_id,run_id,status,evidence_json,started_at,finished_at)
         VALUES(?,?,?,?,?,?) ON CONFLICT(stage_id,run_id) DO UPDATE SET
         status=excluded.status,evidence_json=excluded.evidence_json,
         finished_at=excluded.finished_at`,
        input.workflowRef.stageId, input.runId, input.status, JSON.stringify({ ...(input.evidence ?? {}), ...(input.completion === undefined ? {} : { completion: input.completion }) }),
        now, input.status === 'started' ? null : now,
      );
      const row = await tx.get('SELECT run_ids_json FROM workflow_stages WHERE stage_id=?', input.workflowRef.stageId);
      if (row === null) throw new Error('unknown stage');
      const ids = JSON.parse(String(row['run_ids_json'])) as string[];
      if (!ids.includes(input.runId)) {
        ids.push(input.runId);
        const update = await tx.run('UPDATE workflow_stages SET run_ids_json=?,version=version+1,updated_at=? WHERE stage_id=?', JSON.stringify(ids), now, input.workflowRef.stageId);
        if (update.changes !== 1) throw new Error('stage update conflict');
      }
    });
    const workflows = new WorkflowRepository(this.db);
    const workflow = await workflows.get(input.workflowRef.workflowId);
    if (workflow === null || workflow.currentStageId !== input.workflowRef.stageId) return;
    const template = getBuiltinWorkflowTemplate(
      workflow.kind as 'new-book-creation' | 'legacy-book-revision',
      Number(workflow.templateVersion),
    );
    if (template === undefined) return;
    const current = workflow.stages.find((stage) => stage.stageId === workflow.currentStageId);
    if (current === undefined) return;
    const kind = input.status === 'started'
      ? (current.status === 'ready' ? 'start-stage' : current.status === 'running' ? 'attach-run' : undefined)
      : input.status === 'resumed' ? 'resume-interrupted-run'
      : input.status === 'completed'
        ? (template.stages.find((stage) => stage.id === current.templateStageId)?.completionGate.kind === 'quality'
          ? 'quality-gate-result' : 'run-succeeded')
        : input.status === 'failed' ? 'run-failed' : 'run-interrupted';
    if (kind === undefined) return;
    await workflows.transition(input.workflowRef.workflowId, template, {
      operationId: `stage-run:${input.workflowRef.workflowId}:${input.workflowRef.stageId}:${input.runId}:${input.status}`,
      expectedVersion: workflow.version, at: new Date(now).toISOString(),
      command: kind === 'start-stage' || kind === 'attach-run' || kind === 'resume-interrupted-run'
        ? { kind, runId: input.runId }
        : kind === 'quality-gate-result'
          ? {
              kind,
              runId: input.runId,
              passed: input.completion?.passed ?? false,
              issueIds: input.completion?.issueIds ?? [],
              ...(input.completion?.passed === true
                ? {}
                : { transition: input.completion?.transition ?? ((input.completion?.issueIds?.length ?? 0) > 0 ? 'issues-found' as const : 'quality-failed' as const) }),
            }
          : { kind, runId: input.runId, ...(input.evidence?.reason !== undefined ? { message: input.evidence.reason } : {}) },
    });
  }
}

/** SQLite continuation store. Only workflow-scoped records are accepted by this workflow table. */
export class SqliteContinuationRecordService implements ContinuationRecordService {
  constructor(private readonly db: SqliteDatabase) {}

  async save(record: InterruptContinuationRecord): Promise<void> {
    if (record.scope.kind !== 'workflow' && record.scope.kind !== 'issue') throw new Error('unsupported continuation scope');
    const ref = record.scope.workflowRef;
    const issueId = record.scope.kind === 'issue' ? record.scope.issueId : ref.issueId;
    await this.db.transaction(async (tx) => {
      await assertWorkflowStage(tx, ref, true);
      if (issueId !== undefined) {
        const issue = await tx.get('SELECT 1 FROM workflow_issues WHERE issue_id=? AND workflow_id=?', issueId, ref.workflowId);
        if (issue === null) throw new Error('issue does not belong to workflow');
      }
      await tx.run(
        `INSERT OR REPLACE INTO continuations
         (continuation_id,workflow_id,stage_id,run_id,issue_id,source_node,continuation_kind,allowed_decisions_json,status,created_at,consumed_at)
         VALUES(?,?,?,?,?,?,?,?, 'pending',?,NULL)`,
        record.interruptId, ref.workflowId, ref.stageId, record.scope.runId, issueId ?? null,
        record.sourceNode, JSON.stringify(record.continuation), JSON.stringify(record.allowedDecisionKinds), Date.parse(record.createdAt),
      );
    });
  }

  async getByRunId(runId: string): Promise<InterruptContinuationRecord | null> {
    const row = await this.db.get("SELECT * FROM continuations WHERE run_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1", runId);
    if (row === null) return null;
    const workflowRef: WorkflowRef = {
      workflowId: String(row['workflow_id']), stageId: String(row['stage_id']),
      ...(row['issue_id'] === null ? {} : { issueId: String(row['issue_id']) }),
    };
    return {
      interruptId: String(row['continuation_id']),
      scope: row['issue_id'] === null
        ? { kind: 'workflow', workflowRef, runId }
        : { kind: 'issue', workflowRef, issueId: String(row['issue_id']), runId },
      sourceNode: String(row['source_node']),
      continuation: JSON.parse(String(row['continuation_kind'])) as InterruptContinuationRecord['continuation'],
      allowedDecisionKinds: JSON.parse(String(row['allowed_decisions_json'])) as string[],
      createdAt: new Date(Number(row['created_at'])).toISOString(),
    };
  }

  async remove(interruptId: string): Promise<void> {
    await this.db.run("UPDATE continuations SET status='consumed',consumed_at=? WHERE continuation_id=? AND status='pending'", Date.now(), interruptId);
  }

  async resolveStageTarget(ref: WorkflowRef, targetTemplateStageId: string): Promise<string | null> {
    await assertWorkflowStage(this.db, ref);
    const row = await this.db.get('SELECT stage_id FROM workflow_stages WHERE workflow_id=? AND template_stage_id=?', ref.workflowId, targetTemplateStageId);
    return row === null ? null : String(row['stage_id']);
  }
}

/** Shared exact ownership check used by runtime and IPC boundaries. */
export async function assertWorkflowRefOwnership(
  db: SqliteDatabase,
  ref: WorkflowRef,
  runId?: string,
  requireCurrentStage = false,
): Promise<void> {
  await assertWorkflowStage(db, ref, requireCurrentStage);
  if (ref.issueId !== undefined) {
    const issue = await db.get('SELECT status,refactor_run_ids_json FROM workflow_issues WHERE issue_id=? AND workflow_id=?', ref.issueId, ref.workflowId);
    if (issue === null) throw new Error('issue does not belong to workflow');
    if (runId !== undefined && (String(issue['status']) !== 'fixing' || !(JSON.parse(String(issue['refactor_run_ids_json'])) as string[]).includes(runId))) {
      throw new Error('issue is not fixing with this run');
    }
  }
}
