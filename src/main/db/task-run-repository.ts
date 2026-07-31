import type {
  TaskAuthorDecision,
  TaskRun,
  TaskRunArtifact,
  TaskRunFailure,
  TaskRunStatus,
} from '../../core/task-runtime/index.js';
import type { BackendTaskActivityEvent, TaskRunSummaryDto } from '../../shared/ipc/index.js';
import type { SqliteDatabase, SqlParam, SqlRow } from './sqlite-database.js';

export interface TaskAuthorCandidateRecord {
  readonly candidateId: string;
  readonly taskRunId: string;
  readonly kind: 'source-location';
  readonly label: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: 'pending' | 'selected' | 'rejected';
  readonly createdAt: string;
}

function parse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return JSON.parse(String(value)) as T;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function rowToTaskRun(row: SqlRow): TaskRun {
  return {
    id: String(row['task_run_id']),
    kind: String(row['task_kind']) as TaskRun['kind'],
    refs: {
      playbookId: String(row['playbook_id']),
      executionRunId: String(row['execution_run_id']),
      projectId: nullableText(row['project_id']),
      bookId: nullableText(row['book_id']),
      manuscriptId: nullableText(row['manuscript_id']),
      workflowId: nullableText(row['workflow_id']),
      workflowStageId: nullableText(row['workflow_stage_id']),
      issueId: nullableText(row['issue_id']),
    },
    inputs: parse<Readonly<Record<string, unknown>>>(row['inputs_json'], {}),
    status: String(row['status']) as TaskRunStatus,
    currentStepId: nullableText(row['current_step_id']),
    currentStepIndex: row['current_step_index'] === null ? null : Number(row['current_step_index']),
    artifacts: parse<ReadonlyArray<TaskRunArtifact>>(row['artifacts_json'], []),
    authorDecisions: parse<ReadonlyArray<TaskAuthorDecision>>(row['author_decisions_json'], []),
    timestamps: {
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
      startedAt: nullableText(row['started_at']),
      awaitingAuthorAt: nullableText(row['awaiting_author_at']),
      pausedAt: nullableText(row['paused_at']),
      endedAt: nullableText(row['ended_at']),
    },
    failure: parse<TaskRunFailure | null>(row['failure_json'], null),
  };
}

function rowToCandidate(row: SqlRow): TaskAuthorCandidateRecord {
  return {
    candidateId: String(row['candidate_id']),
    taskRunId: String(row['task_run_id']),
    kind: String(row['kind']) as 'source-location',
    label: String(row['label']),
    payload: parse<Readonly<Record<string, unknown>>>(row['payload_json'], {}),
    status: String(row['status']) as TaskAuthorCandidateRecord['status'],
    createdAt: String(row['created_at']),
  };
}

/** Durable Main-only storage for task runs, author-visible activity, candidates and decisions. */
export class TaskRunRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async create(run: TaskRun): Promise<TaskRun> {
    await this.db.run(
      `INSERT INTO task_runs(
        task_run_id,playbook_id,execution_run_id,task_kind,status,current_step_id,current_step_index,
        project_id,book_id,manuscript_id,workflow_id,workflow_stage_id,issue_id,
        inputs_json,artifacts_json,author_decisions_json,failure_json,
        created_at,updated_at,started_at,awaiting_author_at,paused_at,ended_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      run.id, run.refs.playbookId, run.refs.executionRunId, run.kind, run.status, run.currentStepId, run.currentStepIndex,
      run.refs.projectId, run.refs.bookId, run.refs.manuscriptId, run.refs.workflowId,
      run.refs.workflowStageId, run.refs.issueId, JSON.stringify(run.inputs), JSON.stringify(run.artifacts),
      JSON.stringify(run.authorDecisions), run.failure === null ? null : JSON.stringify(run.failure),
      run.timestamps.createdAt, run.timestamps.updatedAt, run.timestamps.startedAt,
      run.timestamps.awaitingAuthorAt, run.timestamps.pausedAt, run.timestamps.endedAt,
    );
    return run;
  }

  async get(taskRunId: string): Promise<TaskRun | null> {
    const row = await this.db.get('SELECT * FROM task_runs WHERE task_run_id=?', taskRunId);
    return row === null ? null : rowToTaskRun(row);
  }

  async save(run: TaskRun): Promise<TaskRun> {
    const result = await this.db.run(
      `UPDATE task_runs SET status=?,current_step_id=?,current_step_index=?,artifacts_json=?,
       author_decisions_json=?,failure_json=?,updated_at=?,started_at=?,awaiting_author_at=?,paused_at=?,ended_at=?
       WHERE task_run_id=?`,
      run.status, run.currentStepId, run.currentStepIndex, JSON.stringify(run.artifacts),
      JSON.stringify(run.authorDecisions), run.failure === null ? null : JSON.stringify(run.failure),
      run.timestamps.updatedAt, run.timestamps.startedAt, run.timestamps.awaitingAuthorAt,
      run.timestamps.pausedAt, run.timestamps.endedAt, run.id,
    );
    if (result.changes !== 1) throw new Error(`unknown task run ${run.id}`);
    return run;
  }

  async appendEvent(event: BackendTaskActivityEvent): Promise<void> {
    const activityId = event.type === 'task-activity'
      ? event.activityId
      : `${event.type}:${event.taskRunId}:${event.type === 'task-run-completed' ? event.completedAt : event.failedAt}`;
    const createdAt = event.type === 'task-activity'
      ? event.createdAt
      : event.type === 'task-run-completed' ? event.completedAt : event.failedAt;
    await this.db.run(
      'INSERT OR IGNORE INTO task_activities(activity_id,task_run_id,event_json,created_at) VALUES(?,?,?,?)',
      activityId, event.taskRunId, JSON.stringify(event), createdAt,
    );
  }

  async appendEventForOperation(
    event: BackendTaskActivityEvent,
    operationId: string,
    scope: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const old = await tx.get('SELECT scope FROM operation_ids WHERE operation_id=?', operationId);
      if (old !== null) {
        if (String(old['scope']) !== scope) throw new Error('操作标识已用于其他任务');
        return false;
      }
      const activityId = event.type === 'task-activity'
        ? event.activityId
        : `${event.type}:${event.taskRunId}:${event.type === 'task-run-completed' ? event.completedAt : event.failedAt}`;
      const createdAt = event.type === 'task-activity'
        ? event.createdAt
        : event.type === 'task-run-completed' ? event.completedAt : event.failedAt;
      await tx.run(
        'INSERT INTO task_activities(activity_id,task_run_id,event_json,created_at) VALUES(?,?,?,?)',
        activityId, event.taskRunId, JSON.stringify(event), createdAt,
      );
      await tx.run(
        'INSERT INTO operation_ids(operation_id,scope,result_json,created_at) VALUES(?,?,?,?)',
        operationId, scope, JSON.stringify({ activityId }), Date.now(),
      );
      return true;
    });
  }

  async replaceCandidates(taskRunId: string, candidates: ReadonlyArray<TaskAuthorCandidateRecord>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run("UPDATE task_author_candidates SET status='rejected' WHERE task_run_id=? AND status='pending'", taskRunId);
      for (const candidate of candidates) {
        await tx.run(
          `INSERT INTO task_author_candidates(candidate_id,task_run_id,kind,label,payload_json,status,created_at)
           VALUES(?,?,?,?,?,?,?) ON CONFLICT(candidate_id) DO UPDATE SET label=excluded.label,payload_json=excluded.payload_json,status=excluded.status`,
          candidate.candidateId, candidate.taskRunId, candidate.kind, candidate.label,
          JSON.stringify(candidate.payload), candidate.status, candidate.createdAt,
        );
      }
    });
  }

  async listPendingCandidates(taskRunId: string): Promise<ReadonlyArray<TaskAuthorCandidateRecord>> {
    const rows = await this.db.all(
      "SELECT * FROM task_author_candidates WHERE task_run_id=? AND status='pending' ORDER BY created_at,candidate_id",
      taskRunId,
    );
    return rows.map(rowToCandidate);
  }

  async getSelectedCandidateOperation(
    taskRunId: string,
    candidateId: string,
    operationId: string,
  ): Promise<TaskAuthorCandidateRecord | null> {
    const row = await this.db.get('SELECT scope,result_json FROM operation_ids WHERE operation_id=?', operationId);
    if (row === null) return null;
    if (String(row['scope']) !== `task-run:${taskRunId}:choose-source`) throw new Error('操作标识已用于其他任务');
    const candidate = parse<TaskAuthorCandidateRecord>(row['result_json'], {} as TaskAuthorCandidateRecord);
    if (candidate.candidateId !== candidateId) throw new Error('重复操作与原候选不一致');
    return candidate;
  }

  async selectCandidate(
    taskRunId: string,
    candidateId: string,
    operationId: string,
  ): Promise<{ readonly candidate: TaskAuthorCandidateRecord; readonly duplicate: boolean }> {
    return this.db.transaction(async (tx) => {
      const old = await tx.get('SELECT scope,result_json FROM operation_ids WHERE operation_id=?', operationId);
      if (old !== null) {
        if (String(old['scope']) !== `task-run:${taskRunId}:choose-source`) throw new Error('操作标识已用于其他任务');
        const candidate = parse<TaskAuthorCandidateRecord>(old['result_json'], {} as TaskAuthorCandidateRecord);
        if (candidate.candidateId !== candidateId) throw new Error('重复操作与原候选不一致');
        return { candidate, duplicate: true };
      }
      const row = await tx.get(
        "SELECT * FROM task_author_candidates WHERE task_run_id=? AND candidate_id=? AND status='pending'",
        taskRunId, candidateId,
      );
      if (row === null) throw new Error('定位候选不存在或已处理');
      await tx.run(
        "UPDATE task_author_candidates SET status=CASE WHEN candidate_id=? THEN 'selected' ELSE 'rejected' END WHERE task_run_id=? AND status='pending'",
        candidateId, taskRunId,
      );
      const candidate = { ...rowToCandidate(row), status: 'selected' as const };
      await tx.run(
        'INSERT INTO operation_ids(operation_id,scope,result_json,created_at) VALUES(?,?,?,?)',
        operationId, `task-run:${taskRunId}:choose-source`, JSON.stringify(candidate), Date.now(),
      );
      return { candidate, duplicate: false };
    });
  }

  async listEvents(taskRunId: string): Promise<ReadonlyArray<BackendTaskActivityEvent>> {
    const rows = await this.db.all('SELECT event_json FROM task_activities WHERE task_run_id=? ORDER BY created_at,rowid', taskRunId);
    return rows.map((row) => parse<BackendTaskActivityEvent>(row['event_json'], {} as BackendTaskActivityEvent));
  }

  async listRecent(
    filter: { readonly projectId?: string; readonly workflowId?: string; readonly limit: number },
  ): Promise<ReadonlyArray<TaskRunSummaryDto>> {
    const clauses: string[] = [];
    const params: SqlParam[] = [];
    if (filter.projectId !== undefined) {
      clauses.push('project_id=?');
      params.push(filter.projectId);
    }
    if (filter.workflowId !== undefined) {
      clauses.push('workflow_id=?');
      params.push(filter.workflowId);
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    const rows = await this.db.all(
      `SELECT task_run_id,task_kind,playbook_id,status,workflow_id,workflow_stage_id,issue_id,current_step_id,created_at,updated_at
       FROM task_runs${where} ORDER BY updated_at DESC,task_run_id DESC LIMIT ?`,
      ...params,
      filter.limit,
    );
    return rows.map((row) => ({
      taskRunId: String(row['task_run_id']),
      kind: String(row['task_kind']) as TaskRunSummaryDto['kind'],
      playbookId: String(row['playbook_id']),
      status: String(row['status']) as TaskRunSummaryDto['status'],
      workflowId: nullableText(row['workflow_id']),
      workflowStageId: nullableText(row['workflow_stage_id']),
      issueId: nullableText(row['issue_id']),
      currentStepId: nullableText(row['current_step_id']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    }));
  }

  async listEventsForRuns(taskRunIds: ReadonlyArray<string>): Promise<ReadonlyArray<BackendTaskActivityEvent>> {
    if (taskRunIds.length === 0) return [];
    const placeholders = taskRunIds.map(() => '?').join(',');
    const rows = await this.db.all(
      `SELECT event_json FROM task_activities WHERE task_run_id IN (${placeholders}) ORDER BY created_at,rowid`,
      ...taskRunIds,
    );
    return rows.map((row) => parse<BackendTaskActivityEvent>(row['event_json'], {} as BackendTaskActivityEvent));
  }
}
