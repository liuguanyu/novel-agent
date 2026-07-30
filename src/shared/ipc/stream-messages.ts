/**
 * 后端 → 前端 流式消息类型 (Task 2.2) 与 错误消息 (Task 2.4)
 *
 * 所有消息为 discriminated union（以 `type` 判别），携带 `runId` 关联同一次运行
 * （见 spec: ipc-contract「强类型消息与运行关联」「流式、中断与错误语义」）。
 * 本文件仅为类型定义（跨进程契约），无实现逻辑。
 */

import type { StreamChannel } from './channels.js';
import type { WorkflowRefDto } from './workflow-messages.js';

/** 一次运行的唯一标识（关联同一 run 的所有消息，避免边写边聊串台） */
export type RunId = string;

/** 流式内容的种类（决定走哪条内容通道） */
export type StreamKind = 'manuscript' | 'dialogue';

/** 错误分类（作为一等控制事件传递，不用异常穿透 IPC） */
export type IpcErrorCategory =
  | 'model' // 模型/provider 调用失败
  | 'validation' // schema 校验失败（结构化输出不合法）
  | 'aborted' // 被用户中断
  | 'io' // 文件/数据库 I/O 失败
  | 'internal'; // 其他内部错误

/** 结构化错误负载 */
export interface IpcError {
  category: IpcErrorCategory;
  message: string;
  /** 可选的机器可读细节（已收窄，非 any） */
  detail?: Readonly<Record<string, string | number | boolean>>;
}

/** 运行开始 */
export interface StreamStartMessage {
  type: 'stream-start';
  runId: RunId;
  kind: StreamKind;
  workflowRef?: WorkflowRefDto;
}

/** 增量分片 */
export interface StreamChunkMessage {
  type: 'stream-chunk';
  runId: RunId;
  kind: StreamKind;
  /** 本次增量文本 */
  delta: string;
  /** 分片序号，用于前端按序拼接与去重 */
  seq: number;
  workflowRef?: WorkflowRefDto;
}

/** 运行正常结束 */
export interface StreamEndMessage {
  type: 'stream-end';
  runId: RunId;
  kind: StreamKind;
  /** 结束原因 */
  reason: 'completed' | 'aborted';
  workflowRef?: WorkflowRefDto;
}

/** 运行出错（错误即消息，Task 2.4） */
export interface StreamErrorMessage {
  type: 'stream-error';
  runId: RunId;
  kind: StreamKind;
  error: IpcError;
  workflowRef?: WorkflowRefDto;
}

/**
 * 后端 → 前端 的流式消息判别联合。
 * 接收方通过 `type` 收窄到精确负载，无需使用 any。
 */
export type BackendStreamMessage =
  | StreamStartMessage
  | StreamChunkMessage
  | StreamEndMessage
  | StreamErrorMessage;

/** 把 StreamKind 映射到具体通道名的编译期约束（供路由层参考，非运行时逻辑） */
export type ChannelForKind<K extends StreamKind> = K extends 'manuscript'
  ? Extract<StreamChannel, 'manuscript-stream'>
  : Extract<StreamChannel, 'dialogue-stream'>;
