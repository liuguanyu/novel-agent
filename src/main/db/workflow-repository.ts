import type { SqliteDatabase, SqlRow } from './sqlite-database.js';
import { transitionWorkflow } from '../../core/workflow/state-machine.js';
import type { WorkflowCommandEnvelope } from '../../core/workflow/state-machine.js';
import type { AuthorIntent, WorkflowInstance, WorkflowTemplate, WorkflowStageInstance } from '../../core/workflow/types.js';

export interface WorkflowStageRecord {
  readonly stageId: string;
  readonly templateStageId: string;
  readonly status: string;
  readonly actor: string;
  readonly scope: unknown;
  readonly runIds?: ReadonlyArray<string>;
  readonly artifactRefs?: ReadonlyArray<unknown>;
  readonly impactStatus?: string | null;
  readonly completionEvidence?: ReadonlyArray<unknown>;
  readonly blockingReason?: unknown;
  readonly enteredAt?: string;
  readonly completedAt?: string;
  readonly version?: number;
}

export interface WorkflowRecord {
  readonly workflowId: string;
  readonly projectId: string;
  readonly kind: string;
  readonly templateVersion: string;
  readonly objective: string;
  readonly authorIntents: ReadonlyArray<AuthorIntent>;
  readonly status: string;
  readonly currentStageId: string | null;
  readonly selectedIssueId?: string;
  readonly stages: ReadonlyArray<WorkflowStageRecord>;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateWorkflowInput extends Omit<WorkflowRecord, 'version' | 'createdAt' | 'updatedAt' | 'authorIntents'> {
  readonly authorIntents?: ReadonlyArray<AuthorIntent>;
  readonly version?: number;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export class OptimisticVersionConflictError extends Error {
  constructor(readonly entity: string, readonly expectedVersion: number) {
    super(`${entity} version conflict (expected ${expectedVersion})`);
    this.name = 'OptimisticVersionConflictError';
  }
}

function json(value: unknown): string { return JSON.stringify(value); }
function parseArray(value: unknown): ReadonlyArray<unknown> { return JSON.parse(String(value)) as unknown[]; }

function rowToStage(row: SqlRow): WorkflowStageRecord {
  return {
    stageId: String(row['stage_id']), templateStageId: String(row['template_stage_id']),
    status: String(row['status']), actor: String(row['actor']),
    scope: JSON.parse(String(row['scope_json'])) as unknown,
    runIds: parseArray(row['run_ids_json']).map(String), artifactRefs: parseArray(row['artifact_refs_json']),
    impactStatus: row['impact_status'] === null ? null : String(row['impact_status']),
    completionEvidence: parseArray(row['completion_evidence_json'] ?? '[]'),
    blockingReason: row['blocking_reason_json'] === null ? undefined : JSON.parse(String(row['blocking_reason_json'])),
    ...(row['entered_at'] === null ? {} : { enteredAt: String(row['entered_at']) }),
    ...(row['completed_at'] === null ? {} : { completedAt: String(row['completed_at']) }), version: Number(row['version']),
  };
}

export class WorkflowRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async create(input: CreateWorkflowInput, operationId?: string): Promise<WorkflowRecord> {
    return this.db.transaction(async (tx) => {
      if (operationId !== undefined) {
        const prior = await this.operationResult(tx, operationId);
        if (prior !== null) return prior as WorkflowRecord;
      }
      const now = Date.now(); const createdAt = input.createdAt ?? now; const updatedAt = input.updatedAt ?? now;
      const version = input.version ?? 1;
      await tx.run(`INSERT INTO workflow_instances
        (workflow_id,project_id,kind,template_version,objective,author_intents_json,status,current_stage_id,stages_json,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, input.workflowId, input.projectId, input.kind, input.templateVersion,
        input.objective, json(input.authorIntents ?? []), input.status, input.currentStageId, json(input.stages), version, createdAt, updatedAt);
      for (const stage of input.stages) await this.insertStage(tx, input.workflowId, stage, createdAt);
      const record: WorkflowRecord = { ...input, authorIntents: input.authorIntents ?? [], version, createdAt, updatedAt };
      if (operationId !== undefined) await this.saveOperation(tx, operationId, `workflow:${input.workflowId}`, record);
      return record;
    });
  }

  async get(workflowId: string): Promise<WorkflowRecord | null> {
    const row = await this.db.get('SELECT * FROM workflow_instances WHERE workflow_id = ?', workflowId);
    if (row === null) return null;
    const stages = await this.db.all('SELECT * FROM workflow_stages WHERE workflow_id = ? ORDER BY created_at, stage_id', workflowId);
    return this.toRecord(row, stages.map(rowToStage));
  }

  async getActive(projectId: string): Promise<WorkflowRecord | null> {
    const row = await this.db.get("SELECT * FROM workflow_instances WHERE project_id = ? AND status = 'active'", projectId);
    return row === null ? null : this.get(String(row['workflow_id']));
  }

  async update(workflowId: string, expectedVersion: number, patch: Partial<Pick<WorkflowRecord, 'status' | 'currentStageId' | 'objective' | 'authorIntents'>>, operationId?: string): Promise<WorkflowRecord> {
    return this.db.transaction(async (tx) => {
      if (operationId !== undefined) {
        const prior = await this.operationResult(tx, operationId);
        if (prior !== null) return prior as WorkflowRecord;
      }
      const current = await tx.get('SELECT * FROM workflow_instances WHERE workflow_id = ?', workflowId);
      if (current === null || Number(current['version']) !== expectedVersion) throw new OptimisticVersionConflictError(`workflow:${workflowId}`, expectedVersion);
      const status = patch.status ?? String(current['status']);
      const stage = patch.currentStageId === undefined ? (current['current_stage_id'] === null ? null : String(current['current_stage_id'])) : patch.currentStageId;
      const objective = patch.objective ?? String(current['objective']);
      const authorIntents = patch.authorIntents ?? (current['author_intents_json'] === undefined || current['author_intents_json'] === null
        ? []
        : JSON.parse(String(current['author_intents_json'])) as ReadonlyArray<AuthorIntent>);
      const updatedAt = Date.now();
      const result = await tx.run(`UPDATE workflow_instances SET status=?,current_stage_id=?,objective=?,author_intents_json=?,version=version+1,updated_at=? WHERE workflow_id=? AND version=?`, status, stage, objective, json(authorIntents), updatedAt, workflowId, expectedVersion);
      if (result.changes !== 1) throw new OptimisticVersionConflictError(`workflow:${workflowId}`, expectedVersion);
      const rows = await tx.all('SELECT * FROM workflow_stages WHERE workflow_id = ? ORDER BY created_at, stage_id', workflowId);
      const updatedRow = await tx.get('SELECT * FROM workflow_instances WHERE workflow_id = ?', workflowId);
      if (updatedRow === null) throw new Error(`workflow ${workflowId} disappeared`);
      const record = this.toRecord(updatedRow, rows.map(rowToStage));
      if (operationId !== undefined) await this.saveOperation(tx, operationId, `workflow:${workflowId}`, record);
      return record;
    });
  }

  async transition(workflowId: string, template: WorkflowTemplate, envelope: WorkflowCommandEnvelope): Promise<WorkflowRecord> {
    return this.db.transaction(async (tx) => {
      const prior = await this.operationResult(tx, envelope.operationId);
      if (prior !== null) return prior as WorkflowRecord;
      const row = await tx.get('SELECT * FROM workflow_instances WHERE workflow_id=?', workflowId);
      if (row === null) throw new Error('workflow not found');
      const stageRows = await tx.all('SELECT * FROM workflow_stages WHERE workflow_id=? ORDER BY created_at, stage_id', workflowId);
      const operationRows = await tx.all("SELECT operation_id FROM operation_ids WHERE scope=?", `workflow:${workflowId}`);
      const current = this.toCore(row, stageRows.map(rowToStage), operationRows.map((item) => String(item['operation_id'])));
      const result = transitionWorkflow(current, template, envelope);
      if (!result.ok) throw new Error(`workflow transition rejected: ${result.reason}`);
      const next = result.workflow;
      const now = Date.now();
      const workflowUpdate = await tx.run('UPDATE workflow_instances SET status=?,current_stage_id=?,stages_json=?,version=?,updated_at=? WHERE workflow_id=? AND version=?', next.status, next.currentStageId, json(next.stages), next.version, now, workflowId, envelope.expectedVersion);
      if (workflowUpdate.changes !== 1) throw new OptimisticVersionConflictError(`workflow:${workflowId}`, envelope.expectedVersion);
      for (const stage of next.stages) await this.updateStage(tx, stage, now);
      const fresh = await tx.get('SELECT * FROM workflow_instances WHERE workflow_id=?', workflowId);
      if (fresh === null) throw new Error('workflow disappeared');
      const record = this.toRecord(fresh, (await tx.all('SELECT * FROM workflow_stages WHERE workflow_id=? ORDER BY created_at, stage_id', workflowId)).map(rowToStage));
      await this.saveOperation(tx, envelope.operationId, `workflow:${workflowId}`, record);
      return record;
    });
  }

  async selectIssue(workflowId: string, issueId: string): Promise<WorkflowRecord> {
    const result = await this.db.run(
      'UPDATE workflow_instances SET selected_issue_id=?,updated_at=? WHERE workflow_id=?',
      issueId,
      Date.now(),
      workflowId,
    );
    if (result.changes !== 1) throw new Error(`unknown workflow ${workflowId}`);
    const record = await this.get(workflowId);
    if (record === null) throw new Error(`workflow ${workflowId} disappeared`);
    return record;
  }

  async setStageImpactStatus(stageId: string, impactStatus: string): Promise<void> {
    const result = await this.db.run('UPDATE workflow_stages SET impact_status=?,version=version+1,updated_at=? WHERE stage_id=?', impactStatus, Date.now(), stageId);
    if (result.changes !== 1) throw new Error(`unknown stage ${stageId}`);
  }

  async getStage(stageId: string): Promise<WorkflowStageRecord | null> {
    const row = await this.db.get('SELECT * FROM workflow_stages WHERE stage_id=?', stageId);
    return row === null ? null : rowToStage(row);
  }

  async attachRun(stageId: string, runId: string, status: string, evidence: unknown = null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run(`INSERT INTO workflow_stage_runs(stage_id,run_id,status,evidence_json,started_at) VALUES(?,?,?,?,?)
        ON CONFLICT(stage_id,run_id) DO UPDATE SET status=excluded.status,evidence_json=excluded.evidence_json`, stageId, runId, status, json(evidence), Date.now());
      const row = await tx.get('SELECT run_ids_json FROM workflow_stages WHERE stage_id=?', stageId);
      if (row === null) throw new Error(`unknown stage ${stageId}`);
      const ids = parseArray(row['run_ids_json']).map(String); if (!ids.includes(runId)) ids.push(runId);
      await tx.run('UPDATE workflow_stages SET run_ids_json=?,version=version+1,updated_at=? WHERE stage_id=?', json(ids), Date.now(), stageId);
    });
  }

  private async insertStage(tx: SqliteDatabase, workflowId: string, stage: WorkflowStageRecord, now: number): Promise<void> {
    await tx.run(`INSERT INTO workflow_stages(stage_id,workflow_id,template_stage_id,status,actor,scope_json,run_ids_json,artifact_refs_json,impact_status,completion_evidence_json,blocking_reason_json,entered_at,completed_at,version,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, stage.stageId, workflowId, stage.templateStageId, stage.status, stage.actor, json(stage.scope), json(stage.runIds ?? []), json(stage.artifactRefs ?? []), stage.impactStatus ?? null, json(stage.completionEvidence ?? []), stage.blockingReason === undefined ? null : json(stage.blockingReason), stage.enteredAt ?? null, stage.completedAt ?? null, stage.version ?? 1, now, now);
  }
  private toCore(row: SqlRow, stages: ReadonlyArray<WorkflowStageRecord>, appliedOperationIds: ReadonlyArray<string> = []): WorkflowInstance {
    return { ...this.toRecord(row, stages), status: String(row['status']) as WorkflowInstance['status'], kind: String(row['kind']) as WorkflowInstance['kind'], templateVersion: Number(row['template_version']), currentStageId: String(row['current_stage_id']), appliedOperationIds, createdAt: new Date(Number(row['created_at'])).toISOString(), updatedAt: new Date(Number(row['updated_at'])).toISOString(), stages: stages.map((s) => ({ ...s, impactStatus: (s.impactStatus ?? 'none') as WorkflowStageInstance['impactStatus'], actor: s.actor as WorkflowStageInstance['actor'], scope: s.scope as WorkflowStageInstance['scope'], runIds: s.runIds ?? [], artifactRefs: (s.artifactRefs ?? []) as WorkflowStageInstance['artifactRefs'], completionEvidence: (s.completionEvidence ?? []) as WorkflowStageInstance['completionEvidence'], blockingReason: s.blockingReason as WorkflowStageInstance['blockingReason'] })) as WorkflowStageInstance[] };
  }
  private async updateStage(tx: SqliteDatabase, stage: WorkflowStageInstance, now: number): Promise<void> {
    await tx.run(`UPDATE workflow_stages SET status=?,run_ids_json=?,artifact_refs_json=?,impact_status=?,completion_evidence_json=?,blocking_reason_json=?,entered_at=?,completed_at=?,version=version+1,updated_at=? WHERE stage_id=?`, stage.status, json(stage.runIds), json(stage.artifactRefs), stage.impactStatus, json(stage.completionEvidence), stage.blockingReason === undefined ? null : json(stage.blockingReason), stage.enteredAt ?? null, stage.completedAt ?? null, now, stage.stageId);
  }
  private toRecord(row: SqlRow, stages: ReadonlyArray<WorkflowStageRecord>): WorkflowRecord {
    return { workflowId:String(row['workflow_id']), projectId:String(row['project_id']), kind:String(row['kind']), templateVersion:String(row['template_version']), objective:String(row['objective']), authorIntents: row['author_intents_json'] === undefined || row['author_intents_json'] === null ? [] : JSON.parse(String(row['author_intents_json'])) as ReadonlyArray<AuthorIntent>, status:String(row['status']), currentStageId:row['current_stage_id']===null?null:String(row['current_stage_id']), ...(row['selected_issue_id'] === undefined || row['selected_issue_id'] === null ? {} : { selectedIssueId: String(row['selected_issue_id']) }), stages, version:Number(row['version']), createdAt:Number(row['created_at']), updatedAt:Number(row['updated_at']) };
  }
  private async operationResult(tx: SqliteDatabase, id: string): Promise<unknown | null> { const row=await tx.get('SELECT result_json FROM operation_ids WHERE operation_id=?',id); return row===null?null:JSON.parse(String(row['result_json'])) as unknown; }
  private async saveOperation(tx: SqliteDatabase,id:string,scope:string,result:unknown):Promise<void>{ await tx.run('INSERT INTO operation_ids(operation_id,scope,result_json,created_at) VALUES(?,?,?,?)',id,scope,json(result),Date.now()); }
}
