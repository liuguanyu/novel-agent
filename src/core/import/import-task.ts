/**
 * 导入解析的 Main ↔ utilityProcess 任务契约 (story-workspace task 3.5)
 *
 * spec: project-import「大文档在 utilityProcess 解析」——大文档解析属 CPU 密集，
 * MUST 在 worker 执行，不阻塞主进程事件循环。
 *
 * 遵循 docs/conventions.md §4「强类型 + 判别字段(type) + 关联 id(taskId) + 错误即消息」。
 * 本文件仅为跨进程消息类型契约（与 IPC 消息同层，无实现）。
 *
 * 置于 core/ 而非 shared/：本任务消息携带 core 域类型（ImportParseResult），
 * 且仅 Main↔worker 可见、renderer 不涉；shared/ 为依赖叶子不得依赖 core，故归 core。
 */

import type { ImportParseResult } from './import-contract.js';
import type { IpcError } from '../../shared/ipc/stream-messages.js';

/** 关联一次 worker 任务的请求与其所有响应。 */
export type TaskId = string;

/** Main → worker：请求解析某导入源目录。 */
export interface ParseImportTaskRequest {
  type: 'parse-import';
  taskId: TaskId;
  sourceDir: string;
  includeExtensions: ReadonlyArray<string>;
}

/** Main → worker：请求中止某解析任务。 */
export interface AbortImportTaskRequest {
  type: 'abort-import';
  taskId: TaskId;
}

/** Main → worker 的请求判别联合。 */
export type ImportTaskRequest = ParseImportTaskRequest | AbortImportTaskRequest;

/** worker → Main：解析进度（大目录分批扫描时可选上报）。 */
export interface ImportProgressMessage {
  type: 'import-progress';
  taskId: TaskId;
  /** 已扫描文件数 */
  scanned: number;
  /** 已知总数（未知时为 null） */
  total: number | null;
}

/** worker → Main：解析成功，回传推断结果（含歧义与未分类文件）。 */
export interface ImportDoneMessage {
  type: 'import-done';
  taskId: TaskId;
  result: ImportParseResult;
}

/** worker → Main：解析失败（错误即消息，不抛异常穿越进程边界）。 */
export interface ImportErrorMessage {
  type: 'import-error';
  taskId: TaskId;
  error: IpcError;
}

/** worker → Main 的响应判别联合。 */
export type ImportTaskResponse =
  | ImportProgressMessage
  | ImportDoneMessage
  | ImportErrorMessage;
