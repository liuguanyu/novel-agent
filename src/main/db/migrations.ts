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
];
