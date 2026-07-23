/**
 * diff 计算的 Main ↔ utilityProcess 任务契约 (surgical-refactor task 2.4)
 *
 * spec: diff-engine「diff 计算在 utilityProcess」——diff 计算属 CPU 密集，MUST 在 worker 执行，
 * 主进程事件循环 MUST NOT 阻塞（见 design D6）。
 *
 * 遵循 docs/conventions.md §4「强类型 + 判别字段(type) + 关联 id(taskId) + 错误即消息」。
 * 置于 core/ 而非 shared/:携带 core 域类型（RefactorFragment/DiffResult），仅 Main↔worker 可见。
 * 本文件仅为跨进程消息类型契约（无实现）。
 */

import type { RefactorFragment } from './fragment.js';
import type { DiffResult } from './diff-engine.js';
import type { IpcError } from '../../shared/ipc/stream-messages.js';

/** 关联一次 diff 任务的请求与响应。 */
export type DiffTaskId = string;

/** Main → worker:请求对「原片段 vs 改写」计算 diff 并拆 hunk。 */
export interface DiffTaskRequest {
  type: 'compute-diff';
  taskId: DiffTaskId;
  /** 原片段（含锚点） */
  fragment: RefactorFragment;
  /** 重构 agent 产出的改写片段全文 */
  rewrittenFragment: string;
}

/** Main → worker:请求中止某 diff 任务。 */
export interface AbortDiffTaskRequest {
  type: 'abort-diff';
  taskId: DiffTaskId;
}

/** Main → worker 请求判别联合。 */
export type DiffTaskCommand = DiffTaskRequest | AbortDiffTaskRequest;

/** worker → Main:diff 完成，回传 hunk 拆分结果。 */
export interface DiffDoneMessage {
  type: 'diff-done';
  taskId: DiffTaskId;
  result: DiffResult;
}

/** worker → Main:diff 失败（错误即消息，不抛异常穿越进程边界）。 */
export interface DiffErrorMessage {
  type: 'diff-error';
  taskId: DiffTaskId;
  error: IpcError;
}

/** worker → Main 响应判别联合。 */
export type DiffTaskResponse = DiffDoneMessage | DiffErrorMessage;
