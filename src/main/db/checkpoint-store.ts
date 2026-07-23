/**
 * Checkpointer 的 SQLite 实现 (persistence-sqlite tasks 4.1–4.4)
 *
 * spec: checkpointer——在节点边界持久化 NovelState 快照；每个 checkpoint 可查询标识；
 * 沿 parent 链查询历史。实现 core/orchestration 的 Checkpointer 契约。
 *
 * 本波只提供存储原子操作（commit/get/history/getLatest）；「abort 中途不提交」由 I3 调用层保证
 *（本层不主动写入即为干净态，见 ABORT_LEAVES_CLEAN_CHECKPOINT）。
 *
 * NovelState 含 NodeRef/ConsistencyIssue 等复合结构，本波以 JSON 序列化整存整取；
 * 读回时经最小结构校验（isNovelStateShape），非法则抛错由上层结构化处理。禁 any。
 */

import { randomUUID } from 'node:crypto';
import type { Checkpoint, CheckpointId, Checkpointer } from '../../core/orchestration/index.js';
import type { NovelState } from '../../core/orchestration/index.js';
import { asCheckpointId } from '../../core/story-bible/index.js';
import type { SqliteDatabase, SqlRow } from './sqlite-database.js';

/** 最小结构校验：确认读回的 JSON 具备 NovelState 关键字段形状（不做深校验，够安全收窄）。 */
function isNovelStateShape(value: unknown): value is NovelState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    'currentDraft' in v &&
    'chatHistory' in v &&
    Array.isArray(v['chatHistory']) &&
    'activeBugs' in v &&
    Array.isArray(v['activeBugs']) &&
    'contextRefs' in v
  );
}

function rowToCheckpoint(row: SqlRow): Checkpoint {
  const stateRaw: unknown = JSON.parse(String(row['state_json']));
  if (!isNovelStateShape(stateRaw)) {
    throw new Error(`checkpoint ${String(row['id'])} 的 state_json 结构非法`);
  }
  const parent = row['parent_id'];
  return {
    id: asCheckpointId(String(row['id'])),
    parent: parent === null ? null : asCheckpointId(String(parent)),
    atNode: String(row['at_node']),
    state: stateRaw,
    createdAt: Number(row['created_at']),
  };
}

/** 基于 SqliteDatabase 的 Checkpointer 实现。 */
export class SqliteCheckpointer implements Checkpointer {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  readonly commit = async (
    atNode: string,
    state: NovelState,
    parent: CheckpointId | null,
  ): Promise<Checkpoint> => {
    const id = asCheckpointId(randomUUID());
    const createdAt = Date.now();
    await this.#db.run(
      'INSERT INTO checkpoints (id, parent_id, at_node, state_json, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      parent,
      atNode,
      JSON.stringify(state),
      createdAt,
    );
    return { id, parent, atNode, state, createdAt };
  };

  readonly get = async (id: CheckpointId): Promise<Checkpoint | null> => {
    const row = await this.#db.get('SELECT * FROM checkpoints WHERE id = ?', id);
    return row === null ? null : rowToCheckpoint(row);
  };

  readonly history = async (from: CheckpointId): Promise<ReadonlyArray<Checkpoint>> => {
    // 沿 parent 链从 from 回溯到根，返回 [from, ..., root]。
    const chain: Checkpoint[] = [];
    let cursor: CheckpointId | null = from;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (seen.has(cursor)) break; // 防御性：避免异常环导致死循环
      seen.add(cursor);
      const row: SqlRow | null = await this.#db.get(
        'SELECT * FROM checkpoints WHERE id = ?',
        cursor,
      );
      if (row === null) break;
      const cp = rowToCheckpoint(row);
      chain.push(cp);
      cursor = cp.parent;
    }
    return chain;
  };

  /** 取最近一次 commit 的 checkpoint（按 created_at 降序第一条）。无记录时返回 null。 */
  readonly getLatest = async (): Promise<Checkpoint | null> => {
    const row = await this.#db.get(
      'SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT 1',
    );
    return row === null ? null : rowToCheckpoint(row);
  };
}
