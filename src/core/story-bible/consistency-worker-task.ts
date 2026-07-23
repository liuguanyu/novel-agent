/**
 * 反向检查的 Main ↔ utilityProcess 任务契约 (story-bible task 4.4)
 *
 * spec: consistency-check「大规模比对不阻塞 UI」——反向检查涉及大规模检索/比对且属 CPU 密集时，
 * MUST 在 utilityProcess/worker 执行，主进程事件循环与 UI/IPC MUST NOT 被阻塞；
 * SQLite 读写作为异步 I/O 归 Main（见 docs/conventions.md §3–§4）。
 *
 * 遵循 §4「强类型 + 判别字段(type) + 关联 id(taskId) + 错误即消息」。
 * 置于 core/（非 shared/）：携带 core 域类型（ReverseCheckInput/Output），仅 Main↔worker 可见。
 * 本文件仅为跨进程消息类型契约（无实现）。
 */

import type { ReverseCheckInput, ReverseCheckOutput } from './consistency-check.js';
import type { IpcError } from '../../shared/ipc/stream-messages.js';

/** 关联一次反向检查任务的请求与响应。 */
export type ReverseCheckTaskId = string;

/** Main → worker：请求执行一次反向检查（大规模比对）。 */
export interface ReverseCheckTaskRequest {
  type: 'reverse-check';
  taskId: ReverseCheckTaskId;
  input: ReverseCheckInput;
}

/** Main → worker：请求中止某反向检查任务。 */
export interface AbortReverseCheckTaskRequest {
  type: 'abort-reverse-check';
  taskId: ReverseCheckTaskId;
}

/** Main → worker 请求判别联合。 */
export type ReverseCheckTaskCommand = ReverseCheckTaskRequest | AbortReverseCheckTaskRequest;

/** worker → Main：进度（已比对候选章节数）。 */
export interface ReverseCheckProgressMessage {
  type: 'reverse-check-progress';
  taskId: ReverseCheckTaskId;
  compared: number;
  total: number | null;
}

/** worker → Main：完成，回传问题列表。 */
export interface ReverseCheckDoneMessage {
  type: 'reverse-check-done';
  taskId: ReverseCheckTaskId;
  output: ReverseCheckOutput;
}

/** worker → Main：失败（错误即消息）。 */
export interface ReverseCheckErrorMessage {
  type: 'reverse-check-error';
  taskId: ReverseCheckTaskId;
  error: IpcError;
}

/** worker → Main 响应判别联合。 */
export type ReverseCheckTaskResponse =
  | ReverseCheckProgressMessage
  | ReverseCheckDoneMessage
  | ReverseCheckErrorMessage;
