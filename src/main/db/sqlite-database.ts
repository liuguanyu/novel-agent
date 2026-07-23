/**
 * SQLite 数据库服务 — Main-only (persistence-sqlite tasks 3.1–3.5)
 *
 * spec: sqlite-persistence——用 Node 内置 `node:sqlite`（无 native 依赖）初始化数据库、
 * 幂等应用 migrations、对上层暴露 Promise API；Renderer MUST NOT 直接访问 SQLite/Node 能力。
 *
 * node:sqlite 的 DatabaseSync 是同步 API。本波持久化操作轻量，用 Promise 薄封装保持上层异步一致，
 * 短事务不长时间阻塞事件循环（重负载 worker 迁移到 utility process 属后续波次）。
 *
 * feature detect：`node:sqlite` 不可用时返回结构化错误，不因裸异常白屏/崩溃（task 3.5）。
 */

import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.js';

/** 数据库打开结果（一等结果，不抛裸异常穿透边界）。 */
export type OpenDbResult =
  | { ok: true; db: SqliteDatabase }
  | { ok: false; reason: 'unavailable' | 'io'; message: string };

/** 绑定参数（node:sqlite 接受的输入标量）。 */
export type SqlParam = null | number | bigint | string | Uint8Array;

/** 一行查询结果（列名 → 值）。 */
export type SqlRow = Record<string, null | number | bigint | string | Uint8Array>;

/**
 * 对 DatabaseSync 的 Promise 封装。所有方法 async，即便底层同步——
 * 保持上层调用风格一致，并为未来迁移到 worker/utility process 预留接口形状。
 */
export class SqliteDatabase {
  readonly #db: DatabaseSync;
  readonly #stmtCache = new Map<string, StatementSync>();

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  #prepare(sql: string): StatementSync {
    const cached = this.#stmtCache.get(sql);
    if (cached !== undefined) return cached;
    const stmt = this.#db.prepare(sql);
    this.#stmtCache.set(sql, stmt);
    return stmt;
  }

  /** 执行无结果 SQL（DDL / 批量语句）。 */
  async exec(sql: string): Promise<void> {
    this.#db.exec(sql);
  }

  /** 执行写语句，返回受影响行数与最后插入 rowid。 */
  async run(
    sql: string,
    ...params: SqlParam[]
  ): Promise<{ changes: number; lastInsertRowid: number }> {
    const r = this.#prepare(sql).run(...params);
    return {
      changes: typeof r.changes === 'bigint' ? Number(r.changes) : r.changes,
      lastInsertRowid:
        typeof r.lastInsertRowid === 'bigint' ? Number(r.lastInsertRowid) : r.lastInsertRowid,
    };
  }

  /** 查询首行（无结果返回 null）。 */
  async get(sql: string, ...params: SqlParam[]): Promise<SqlRow | null> {
    const row = this.#prepare(sql).get(...params);
    return row === undefined ? null : (row as SqlRow);
  }

  /** 查询全部行。 */
  async all(sql: string, ...params: SqlParam[]): Promise<SqlRow[]> {
    return this.#prepare(sql).all(...params) as SqlRow[];
  }

  /** 在单个事务中执行一组操作；异常则回滚。 */
  async transaction<T>(fn: (db: SqliteDatabase) => Promise<T>): Promise<T> {
    this.#db.exec('BEGIN');
    try {
      const result = await fn(this);
      this.#db.exec('COMMIT');
      return result;
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  /** 关闭连接。 */
  async close(): Promise<void> {
    this.#stmtCache.clear();
    this.#db.close();
  }
}

/** 幂等应用 migrations：建 schema_migrations 表，按 version 顺序补齐未应用项。 */
async function applyMigrations(db: SqliteDatabase): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );
  const rows = await db.all('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => Number(r['version'])));
  const ordered = [...MIGRATIONS].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(migration.up);
      await tx.run(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        migration.version,
        Date.now(),
      );
    });
  }
}

/**
 * 打开数据库并应用 migrations。
 * @param dbPath 数据库文件路径（`:memory:` 亦可，用于测试/smoke）。
 */
export async function openDatabase(dbPath: string): Promise<OpenDbResult> {
  let DatabaseSyncCtor: typeof DatabaseSync;
  try {
    // 动态导入以便 feature detect：环境不支持 node:sqlite 时进 catch。
    const mod = await import('node:sqlite');
    DatabaseSyncCtor = mod.DatabaseSync;
  } catch (err) {
    return {
      ok: false,
      reason: 'unavailable',
      message: `当前运行环境不支持 node:sqlite：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const raw = new DatabaseSyncCtor(dbPath);
    const db = new SqliteDatabase(raw);
    await db.exec('PRAGMA journal_mode = WAL');
    await db.exec('PRAGMA foreign_keys = ON');
    await applyMigrations(db);
    return { ok: true, db };
  } catch (err) {
    return {
      ok: false,
      reason: 'io',
      message: `打开数据库失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
