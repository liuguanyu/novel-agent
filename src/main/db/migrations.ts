/**
 * SQLite schema migrations (persistence-sqlite tasks 3.3, 4.1, 5.1–5.3)
 *
 * 每条 migration = { version, up }，按 version 升序幂等应用（见 sqlite-database.applyMigrations）。
 * 表结构承载：checkpoint（图状态快照）、事实版本/变更、类型化实体/别名/属性、时间线/关系/伏笔。
 *
 * 设计要点（见 design D4/D5）：
 *  - 可扩展字段以 `*_json` payload 承载，避免后续事实类型演进时破坏既有数据。
 *  - 事实变更增量非覆盖（fact-versioning「增量非覆盖写入」）：写入只追加，不改历史行。
 *  - checkpoint 与事实版本共用同一标识空间（story-bible CheckpointId 与 orchestration 对齐）。
 *
 * 本波只建 schema，不接 LangGraph/抽取运行时（那是 I3/I4）。
 */

/** 一条数据库迁移。 */
export interface Migration {
  /** 单调递增版本号 */
  version: number;
  /** 该版本的建表/变更 SQL（可含多条语句） */
  up: string;
}

/** 全部迁移（按 version 升序应用）。 */
export const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    up: `
      -- checkpoint：某节点边界的图状态快照 + 可查询标识（checkpointer 契约）
      CREATE TABLE checkpoints (
        id          TEXT PRIMARY KEY,
        parent_id   TEXT,
        at_node     TEXT NOT NULL,
        state_json  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (parent_id) REFERENCES checkpoints (id)
      );
      CREATE INDEX idx_checkpoints_parent ON checkpoints (parent_id);

      -- 事实版本链（fact-versioning：单向推进、可关联 checkpoint）
      CREATE TABLE fact_versions (
        id            TEXT PRIMARY KEY,
        parent_id     TEXT,
        checkpoint_id TEXT,
        created_at    INTEGER NOT NULL,
        FOREIGN KEY (parent_id) REFERENCES fact_versions (id),
        FOREIGN KEY (checkpoint_id) REFERENCES checkpoints (id)
      );
      CREATE INDEX idx_fact_versions_parent ON fact_versions (parent_id);

      -- 事实增量变更（增量非覆盖：只追加）
      CREATE TABLE fact_changes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id    TEXT NOT NULL,
        op            TEXT NOT NULL,   -- 'add' | 'update'
        kind          TEXT NOT NULL,   -- entity | attribute | alias | timeline-event | relation | plot-hook
        target_id     TEXT NOT NULL,
        checkpoint_id TEXT,
        payload_json  TEXT,
        created_at    INTEGER NOT NULL,
        FOREIGN KEY (version_id) REFERENCES fact_versions (id),
        FOREIGN KEY (checkpoint_id) REFERENCES checkpoints (id)
      );
      CREATE INDEX idx_fact_changes_version ON fact_changes (version_id);
      CREATE INDEX idx_fact_changes_target ON fact_changes (kind, target_id);

      -- 类型化实体（fact-model：稳定 id + 规范名 + 可扩展类型 + 状态 + 出处）
      CREATE TABLE entities (
        id                 TEXT PRIMARY KEY,
        type               TEXT NOT NULL,
        canonical_name     TEXT NOT NULL,
        status             TEXT NOT NULL,   -- confirmed | inferred | conflicting
        provenance_json    TEXT NOT NULL,
        introduced_version TEXT NOT NULL,
        updated_version    TEXT NOT NULL,
        FOREIGN KEY (introduced_version) REFERENCES fact_versions (id),
        FOREIGN KEY (updated_version) REFERENCES fact_versions (id)
      );

      -- 称呼别名（合法称呼集合）
      CREATE TABLE entity_aliases (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id          TEXT NOT NULL,
        alias              TEXT NOT NULL,
        status             TEXT NOT NULL,
        provenance_json    TEXT NOT NULL,
        introduced_version TEXT NOT NULL,
        FOREIGN KEY (entity_id) REFERENCES entities (id),
        FOREIGN KEY (introduced_version) REFERENCES fact_versions (id)
      );
      CREATE INDEX idx_entity_aliases_entity ON entity_aliases (entity_id);

      -- 键值属性事实（性格/能力/习惯/外貌…）
      CREATE TABLE entity_attributes (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id          TEXT NOT NULL,
        key                TEXT NOT NULL,
        value              TEXT NOT NULL,
        status             TEXT NOT NULL,
        provenance_json    TEXT NOT NULL,
        introduced_version TEXT NOT NULL,
        FOREIGN KEY (entity_id) REFERENCES entities (id),
        FOREIGN KEY (introduced_version) REFERENCES fact_versions (id)
      );
      CREATE INDEX idx_entity_attributes_entity ON entity_attributes (entity_id);

      -- 时间线事件（可扩展 payload）
      CREATE TABLE timeline_events (
        id                 TEXT PRIMARY KEY,
        seq                INTEGER NOT NULL,
        payload_json       TEXT NOT NULL,
        introduced_version TEXT NOT NULL,
        FOREIGN KEY (introduced_version) REFERENCES fact_versions (id)
      );
      CREATE INDEX idx_timeline_events_seq ON timeline_events (seq);

      -- 关系网（可随剧情演变，带 payload）
      CREATE TABLE relations (
        id                 TEXT PRIMARY KEY,
        from_entity        TEXT NOT NULL,
        to_entity          TEXT NOT NULL,
        payload_json       TEXT NOT NULL,
        introduced_version TEXT NOT NULL,
        FOREIGN KEY (from_entity) REFERENCES entities (id),
        FOREIGN KEY (to_entity) REFERENCES entities (id),
        FOREIGN KEY (introduced_version) REFERENCES fact_versions (id)
      );
      CREATE INDEX idx_relations_from ON relations (from_entity);
      CREATE INDEX idx_relations_to ON relations (to_entity);

      -- 伏笔状态机（planted/pending/paid_off/abandoned，可扩展 payload）
      CREATE TABLE plot_hooks (
        id                 TEXT PRIMARY KEY,
        state              TEXT NOT NULL,
        payload_json       TEXT NOT NULL,
        introduced_version TEXT NOT NULL,
        updated_version    TEXT NOT NULL,
        FOREIGN KEY (introduced_version) REFERENCES fact_versions (id),
        FOREIGN KEY (updated_version) REFERENCES fact_versions (id)
      );
    `,
  },
  {
    version: 2,
    up: `
      CREATE TABLE workflow_instances (
        workflow_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL,
        template_version TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL,
        current_stage_id TEXT, stages_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_workflow_active_project ON workflow_instances(project_id) WHERE status = 'active';
      CREATE INDEX idx_workflow_project ON workflow_instances(project_id, updated_at DESC);
      CREATE TABLE workflow_stages (
        stage_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, template_stage_id TEXT NOT NULL,
        status TEXT NOT NULL, actor TEXT NOT NULL, scope_json TEXT NOT NULL, run_ids_json TEXT NOT NULL DEFAULT '[]',
        artifact_refs_json TEXT NOT NULL DEFAULT '[]', impact_status TEXT, version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        FOREIGN KEY(workflow_id) REFERENCES workflow_instances(workflow_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_workflow_stages_workflow ON workflow_stages(workflow_id, updated_at);
      CREATE TABLE workflow_stage_runs (
        stage_id TEXT NOT NULL, run_id TEXT NOT NULL, status TEXT NOT NULL, evidence_json TEXT,
        started_at INTEGER, finished_at INTEGER, PRIMARY KEY(stage_id, run_id),
        FOREIGN KEY(stage_id) REFERENCES workflow_stages(stage_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_stage_runs_run ON workflow_stage_runs(run_id);
      CREATE TABLE workflow_artifacts (
        artifact_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, stage_id TEXT, kind TEXT NOT NULL,
        ref_id TEXT NOT NULL, ref_version INTEGER, metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
        FOREIGN KEY(workflow_id) REFERENCES workflow_instances(workflow_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_artifacts_stage ON workflow_artifacts(stage_id);
      CREATE TABLE creative_assets (
        asset_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, scope_json TEXT NOT NULL,
        current_version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_assets_project ON creative_assets(project_id, kind);
      CREATE TABLE creative_asset_versions (
        asset_id TEXT NOT NULL, version INTEGER NOT NULL, content_json TEXT NOT NULL, provenance_json TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, operation_id TEXT,
        PRIMARY KEY(asset_id, version), FOREIGN KEY(asset_id) REFERENCES creative_assets(asset_id) ON DELETE CASCADE
      );
      CREATE TABLE creative_asset_dependencies (
        asset_id TEXT NOT NULL, depends_on_asset_id TEXT NOT NULL, dependency_type TEXT NOT NULL,
        asset_version INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY(asset_id, depends_on_asset_id, dependency_type),
        FOREIGN KEY(asset_id) REFERENCES creative_assets(asset_id) ON DELETE CASCADE
      );
      CREATE TABLE creative_asset_change_sets (
        change_set_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, base_version INTEGER NOT NULL,
        operations_json TEXT NOT NULL, clarification TEXT NOT NULL, source_run_id TEXT, status TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(asset_id) REFERENCES creative_assets(asset_id) ON DELETE CASCADE
      );
      CREATE TABLE creative_asset_impacts (
        impact_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, asset_version INTEGER NOT NULL,
        stage_id TEXT, target_type TEXT NOT NULL, target_id TEXT NOT NULL, status TEXT NOT NULL,
        decision TEXT, created_at INTEGER NOT NULL, FOREIGN KEY(asset_id) REFERENCES creative_assets(asset_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_asset_impacts_target ON creative_asset_impacts(target_type, target_id);
      CREATE TABLE workflow_issues (
        issue_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, source_audit_run_id TEXT NOT NULL,
        status TEXT NOT NULL, anchor_refs_json TEXT NOT NULL DEFAULT '[]', refactor_run_ids_json TEXT NOT NULL DEFAULT '[]',
        checkpoint_ids_json TEXT NOT NULL DEFAULT '[]', verification_run_ids_json TEXT NOT NULL DEFAULT '[]',
        resolution_reason TEXT, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        FOREIGN KEY(workflow_id) REFERENCES workflow_instances(workflow_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_issues_workflow_status ON workflow_issues(workflow_id, status);
      CREATE TABLE workflow_issue_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT NOT NULL, kind TEXT NOT NULL,
        status TEXT, source_run_id TEXT, actor TEXT, evidence_json TEXT, reason TEXT, created_at INTEGER NOT NULL,
        FOREIGN KEY(issue_id) REFERENCES workflow_issues(issue_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_issue_history_issue ON workflow_issue_history(issue_id, created_at);
      CREATE TABLE workflow_issue_checkpoints (issue_id TEXT NOT NULL, checkpoint_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(issue_id, checkpoint_id));
      CREATE TABLE workflow_issue_verifications (issue_id TEXT NOT NULL, verification_run_id TEXT NOT NULL, result TEXT NOT NULL, evidence_json TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(issue_id, verification_run_id));
      CREATE TABLE continuations (
        continuation_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, stage_id TEXT NOT NULL, run_id TEXT NOT NULL,
        issue_id TEXT, source_node TEXT NOT NULL, continuation_kind TEXT NOT NULL, allowed_decisions_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, consumed_at INTEGER
      );
      CREATE INDEX idx_continuations_scope ON continuations(workflow_id, stage_id, status);
      CREATE TABLE operation_ids (operation_id TEXT PRIMARY KEY, scope TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX idx_operations_created ON operation_ids(created_at);
    `,
  },
  {
    version: 3,
    up: `
      ALTER TABLE workflow_issues ADD COLUMN fingerprint TEXT;
      CREATE UNIQUE INDEX idx_workflow_issue_fingerprint ON workflow_issues(workflow_id, fingerprint);
      CREATE TABLE creative_asset_candidates (
        candidate_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, base_version INTEGER NOT NULL,
        content_json TEXT NOT NULL, provenance_json TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        FOREIGN KEY(asset_id) REFERENCES creative_assets(asset_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_asset_candidates_asset_status ON creative_asset_candidates(asset_id, status);
    `,
  },
  {
    version: 4,
    up: `
      ALTER TABLE creative_asset_dependencies ADD COLUMN target_type TEXT NOT NULL DEFAULT 'asset';
      ALTER TABLE creative_asset_dependencies ADD COLUMN target_id TEXT;
      ALTER TABLE creative_asset_dependencies ADD COLUMN workflow_id TEXT;
      ALTER TABLE creative_asset_dependencies ADD COLUMN stage_id TEXT;
      ALTER TABLE creative_asset_dependencies ADD COLUMN scope_json TEXT NOT NULL DEFAULT '{}';
      CREATE INDEX idx_asset_dependencies_version ON creative_asset_dependencies(asset_id, asset_version);
      CREATE TABLE creative_asset_impact_analyses (
        analysis_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, from_version INTEGER NOT NULL,
        to_version INTEGER NOT NULL, impact_count INTEGER NOT NULL, created_at INTEGER NOT NULL,
        FOREIGN KEY(asset_id) REFERENCES creative_assets(asset_id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 5,
    up: `
      ALTER TABLE workflow_stages ADD COLUMN completion_evidence_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE workflow_stages ADD COLUMN blocking_reason_json TEXT;
      ALTER TABLE workflow_stages ADD COLUMN entered_at TEXT;
      ALTER TABLE workflow_stages ADD COLUMN completed_at TEXT;
    `,
  },
  {
    version: 6,
    up: `
      ALTER TABLE workflow_issues ADD COLUMN issue_payload_json TEXT;
    `,
  },
  {
    version: 7,
    up: `
      ALTER TABLE workflow_instances ADD COLUMN author_intents_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 8,
    up: `
      ALTER TABLE workflow_instances ADD COLUMN selected_issue_id TEXT;
    `,
  },
  {
    version: 9,
    up: `
      CREATE TABLE task_runs (
        task_run_id TEXT PRIMARY KEY, playbook_id TEXT NOT NULL, execution_run_id TEXT NOT NULL, task_kind TEXT NOT NULL,
        status TEXT NOT NULL, current_step_id TEXT, current_step_index INTEGER,
        project_id TEXT, book_id TEXT, manuscript_id TEXT, workflow_id TEXT, workflow_stage_id TEXT, issue_id TEXT,
        inputs_json TEXT NOT NULL DEFAULT '{}', artifacts_json TEXT NOT NULL DEFAULT '[]',
        author_decisions_json TEXT NOT NULL DEFAULT '[]', failure_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT,
        awaiting_author_at TEXT, paused_at TEXT, ended_at TEXT
      );
      CREATE INDEX idx_task_runs_workflow ON task_runs(workflow_id, updated_at DESC);
      CREATE INDEX idx_task_runs_status ON task_runs(status, updated_at DESC);
      CREATE TABLE task_activities (
        activity_id TEXT PRIMARY KEY, task_run_id TEXT NOT NULL, event_json TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(task_run_id) REFERENCES task_runs(task_run_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_task_activities_run ON task_activities(task_run_id, created_at);
      CREATE TABLE task_author_candidates (
        candidate_id TEXT PRIMARY KEY, task_run_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
        payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
        FOREIGN KEY(task_run_id) REFERENCES task_runs(task_run_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_task_candidates_run ON task_author_candidates(task_run_id, status, created_at);
    `,
  },
  {
    version: 10,
    up: `
      CREATE TABLE research_artifacts (
        artifact_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, content TEXT NOT NULL,
        source TEXT NOT NULL, source_version TEXT NOT NULL, run_id TEXT NOT NULL,
        workflow_id TEXT, stage_id TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_research_artifacts_project ON research_artifacts(project_id, created_at DESC);
    `,
  },
];
