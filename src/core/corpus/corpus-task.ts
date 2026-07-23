/**
 * 素材 embedding 的 Main ↔ utilityProcess 任务契约 (corpus-library tasks 2.3, 3.3)
 *
 * spec: corpus-extraction/corpus-retrieval「进程归属」——embedding 计算属 CPU 密集，
 * MUST 在 utilityProcess/worker 执行，不阻塞主进程事件循环。向量库读写 I/O 归 Main
 * （不在本任务契约内；本契约只覆盖 embedding 计算的派发）。
 *
 * 遵循 docs/conventions.md §4「强类型 + 判别字段(type) + 关联 id(taskId) + 错误即消息」。
 * 本文件仅为跨进程消息类型契约（无实现）。
 *
 * 置于 core/ 而非 shared/：本任务消息携带 core 域类型（CorpusCandidate 等），
 * 且仅 Main↔worker 可见、renderer 不涉；shared/ 为依赖叶子不得依赖 core，故归 core。
 */

import type { IpcError } from '../../shared/ipc/stream-messages.js';
import type { CorpusCandidate } from './corpus-extraction.js';

/** 关联一次 worker 任务的请求与其所有响应。 */
export type TaskId = string;

/** 一段 embedding 向量（浮点分量数组）。 */
export type EmbeddingVector = ReadonlyArray<number>;

/**
 * Main → worker：为一批文本计算 embedding。
 * 用于两类场景：提炼后为候选条目建向量、检索时为查询建向量。
 * `texts` 顺序与回传 `vectors` 顺序一一对应。
 */
export interface EmbedTextsTaskRequest {
  type: 'embed-texts';
  taskId: TaskId;
  /** 待向量化的文本（保持顺序） */
  texts: ReadonlyArray<string>;
}

/**
 * Main → worker：为一批提炼候选计算 embedding（携带 core 域类型）。
 * 与 embed-texts 的区别：直接对候选内容向量化，便于落库时与候选对齐。
 */
export interface EmbedCandidatesTaskRequest {
  type: 'embed-candidates';
  taskId: TaskId;
  /** 待向量化的候选（对其 content 计算 embedding，保持顺序） */
  candidates: ReadonlyArray<CorpusCandidate>;
}

/** Main → worker：请求中止某 embedding 任务。 */
export interface AbortEmbedTaskRequest {
  type: 'abort-embed';
  taskId: TaskId;
}

/** Main → worker 的请求判别联合。 */
export type CorpusTaskRequest =
  | EmbedTextsTaskRequest
  | EmbedCandidatesTaskRequest
  | AbortEmbedTaskRequest;

/** worker → Main：embedding 进度（大批量分批计算时可选上报）。 */
export interface EmbedProgressMessage {
  type: 'embed-progress';
  taskId: TaskId;
  /** 已完成向量化的条数 */
  completed: number;
  /** 总条数 */
  total: number;
}

/**
 * worker → Main：embedding 成功。
 * `vectors` 顺序与请求中的 texts/candidates 顺序一一对应。
 */
export interface EmbedDoneMessage {
  type: 'embed-done';
  taskId: TaskId;
  vectors: ReadonlyArray<EmbeddingVector>;
}

/** worker → Main：embedding 失败（错误即消息，不抛异常穿越进程边界）。 */
export interface EmbedErrorMessage {
  type: 'embed-error';
  taskId: TaskId;
  error: IpcError;
}

/** worker → Main 的响应判别联合。 */
export type CorpusTaskResponse =
  | EmbedProgressMessage
  | EmbedDoneMessage
  | EmbedErrorMessage;
