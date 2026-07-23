/**
 * 时间旅行（time-travel）契约 (human-in-the-loop tasks 3.1–3.4)
 *
 * spec: time-travel——查询 checkpoint 历史、回退到指定 checkpoint、从指定 checkpoint 分叉；
 * 回退/分叉 MUST 与 story-bible 事实版本联动（还原到某 checkpoint 时事实库呈现该时刻视图）；
 * 与 abort 语义明确区分（见 design D4、D5）。
 *
 * 本文件为类型契约 + 纯联动 helper（无 I/O；checkpoint 读写与图状态还原由 Main 运行层完成）。
 * 复用 orchestration 的 Checkpoint/CheckpointId 与 story-bible 的 RestoreViewRequest。
 */

import type { RunId } from '../../shared/ipc/stream-messages.js';
import type { Checkpoint, CheckpointId } from '../orchestration/checkpointer.js';
import type { RestoreViewRequest } from '../story-bible/versioning.js';

/** checkpoint 历史查询请求 (task 3.1)。 */
export interface HistoryQuery {
  runId: RunId;
  /** 从哪个 checkpoint 起回溯（通常为当前最新） */
  from: CheckpointId;
}

/** 回退请求 (task 3.2)：将运行状态还原到指定 checkpoint。 */
export interface RollbackRequest {
  runId: RunId;
  /** 目标历史 checkpoint（如「三步前那版大纲」） */
  target: CheckpointId;
}

/**
 * 分叉请求 (task 3.2)：从指定历史 checkpoint 分叉出新分支，不破坏原分支历史。
 */
export interface ForkRequest {
  runId: RunId;
  /** 分叉起点 checkpoint */
  from: CheckpointId;
}

/**
 * time-travel 的异步契约 (tasks 3.1, 3.2)。Main 侧实现，基于 checkpointer 之上。
 * core 仅声明签名类型，不含实现。
 */
export interface TimeTravel {
  /** 查询可回溯的 checkpoint 序列（task 3.1） */
  readonly history: (query: HistoryQuery) => Promise<ReadonlyArray<Checkpoint>>;
  /** 回退到目标 checkpoint，返回还原后的 checkpoint（task 3.2） */
  readonly rollback: (request: RollbackRequest) => Promise<Checkpoint>;
  /** 从指定 checkpoint 分叉出新分支的首个 checkpoint（task 3.2） */
  readonly fork: (request: ForkRequest) => Promise<Checkpoint>;
}

/**
 * 事实版本联动 (task 3.3 / spec「事实版本联动回滚」)。纯函数。
 * 回退/分叉到某 checkpoint 时，据其标识构造 story-bible 的 RestoreViewRequest，
 * 使事实库呈现该 checkpoint 时刻视图（MUST NOT 保留回退点之后才引入的事实）。
 * checkpoint 标识与事实版本共用同一标识空间（见 orchestration/checkpointer 与 fact-versioning）。
 */
export function toFactRestoreRequest(checkpoint: CheckpointId): RestoreViewRequest {
  return { checkpoint };
}
