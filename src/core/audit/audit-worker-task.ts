/**
 * 全书总检的 Main ↔ utilityProcess 任务契约 (global-audit task 1.4)
 *
 * spec: map-reduce-audit「总检在 utilityProcess」「离线可中断」——Map-Reduce 属 CPU 密集且量大，
 * MUST 在 worker 执行;总检可手动触发、可中断，已完成分片结果 SHOULD 可保留（见 design D2、D6）。
 *
 * 遵循 docs/conventions.md §4「强类型 + 判别字段(type) + 关联 id(taskId) + 错误即消息」。
 * 置于 core/ 而非 shared/:携带 core 域类型（FactView/AuditTaskResult），仅 Main↔worker 可见。
 * 本文件仅为跨进程消息类型契约（无实现）。
 */

import type { AuditRun } from './map-reduce.js';
import type { AuditTaskResult } from './audit-task-runner.js';
import type { FactView } from '../story-bible/fact-store.js';
import type { IpcError } from '../../shared/ipc/stream-messages.js';

/** 关联一次总检任务的请求与响应。 */
export type AuditTaskId = string;

/**
 * Main → worker:请求启动一次全书总检（Map-Reduce）。
 * 携带事实库快照（FactView，纯可序列化）——worker 读不到 SQLite，故由 Main 供快照自足计算
 * （见 audit-worker-runtime spec「worker 读不到数据库故由 Main 供快照」）。
 */
export interface StartAuditTaskRequest {
  type: 'start-audit';
  taskId: AuditTaskId;
  run: AuditRun;
  /** Main 读出的最新事实库快照，worker 只据此对撞。 */
  snapshot: FactView;
}

/** Main → worker:请求中止某总检任务（长任务可中断）。 */
export interface AbortAuditTaskRequest {
  type: 'abort-audit';
  taskId: AuditTaskId;
}

/** Main → worker 请求判别联合。 */
export type AuditTaskCommand = StartAuditTaskRequest | AbortAuditTaskRequest;

/** worker → Main:Reduce 完成，回传总检对撞结果（评分/计数在 Main 或结果内均可，纯计算）。 */
export interface AuditDoneMessage {
  type: 'audit-done';
  taskId: AuditTaskId;
  result: AuditTaskResult;
}

/** worker → Main:总检失败（错误即消息，不抛异常穿越进程边界）。 */
export interface AuditErrorMessage {
  type: 'audit-error';
  taskId: AuditTaskId;
  error: IpcError;
}

/** worker → Main 响应判别联合。 */
export type AuditTaskResponse = AuditDoneMessage | AuditErrorMessage;
