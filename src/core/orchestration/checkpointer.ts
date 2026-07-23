/**
 * checkpointer 契约 (agent-orchestration tasks 5.1–5.5)
 *
 * spec: checkpointer——SQLite 在节点边界(super-step)持久化图状态；中途 abort 不提交、
 * 最近 checkpoint 为节点开始前干净态；每个 checkpoint 产出可查询标识；I/O 归 Main 非阻塞（见 design D5）。
 *
 * 关键对齐 (task 5.5)：checkpoint 标识**复用 story-bible 的 CheckpointId 品牌类型**——
 * story-bible 早于本 change，无法反向依赖，故在 fact-versioning 先定义了 opaque CheckpointId；
 * 本 change 复用同一类型，使事实版本与编排 checkpoint 天然对齐（同一标识指同一时刻）。
 *
 * 本文件为类型契约（无 I/O；SQLite 读写由 main 侧实现层完成，core 仅声明契约）。
 */

import type { CheckpointId } from '../story-bible/versioning.js';
import type { NovelState } from './novel-state.js';

export type { CheckpointId } from '../story-bible/versioning.js';

/**
 * 一个 checkpoint：某节点边界持久化的图状态快照 + 可查询标识 (tasks 5.1, 5.2)。
 */
export interface Checkpoint {
  /** 可查询、可引用的标识（与 story-bible 事实版本共用同一标识空间） */
  id: CheckpointId;
  /** 前驱 checkpoint（初始为 null），构成 time-travel 的历史链 */
  parent: CheckpointId | null;
  /** 该 checkpoint 完成时所在的节点名（哪个节点边界） */
  atNode: string;
  /** 持久化的图状态快照 */
  state: NovelState;
  /** 创建时刻（epoch ms），供排序与呈现 */
  createdAt: number;
}

/**
 * checkpointer 的异步契约 (tasks 5.1–5.4)。Main 侧实现，SQLite 异步 I/O 非阻塞。
 * core 仅声明签名类型，不含实现（无 sqlite import）。
 */
export interface Checkpointer {
  /**
   * 在节点边界提交一个 checkpoint (task 5.1)。
   * 仅在节点执行**完成**时调用；中途 abort MUST NOT 调用（task 5.3）。
   */
  readonly commit: (atNode: string, state: NovelState, parent: CheckpointId | null) => Promise<Checkpoint>;
  /** 按标识查询某 checkpoint (task 5.2) */
  readonly get: (id: CheckpointId) => Promise<Checkpoint | null>;
  /** 列出 checkpoint 历史链（供 time-travel 选择回滚点） */
  readonly history: (from: CheckpointId) => Promise<ReadonlyArray<Checkpoint>>;
}

/**
 * abort 干净态约定 (task 5.3 / spec「中途未提交」)。
 * 由于持久化仅发生在节点边界完成时，节点执行中途被 abort 时其产出不提交，
 * 最近 checkpoint 天然表示该节点开始前的干净态。此常量为该性质的显式契约标记，
 * 供 human-in-the-loop 的 abort 语义引用。
 */
export const ABORT_LEAVES_CLEAN_CHECKPOINT = true as const;
