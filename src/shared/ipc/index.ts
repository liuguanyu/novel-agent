/**
 * IPC 契约统一出口 (Task 2.5)
 *
 * 以 discriminated union 形式落定跨进程消息类型（类型定义，非业务实现）。
 * 三通道见 ./channels；后端流式消息见 ./stream-messages；前端命令见 ./command-messages。
 */

export * from './channels.js';
export * from './stream-messages.js';
export * from './command-messages.js';
export * from './control-messages.js';
export * from './query-messages.js';
export * from './bridge.js';

import type { BackendStreamMessage } from './stream-messages.js';
import type { FrontendCommandMessage } from './command-messages.js';
import type { BackendControlEvent } from './control-messages.js';

/**
 * 任意方向的 IPC 消息（供网关/路由层做穷尽收窄）。
 * 后端→前端为 BackendStreamMessage（内容流）与 BackendControlEvent（控制事件）；
 * 前端→后端为 FrontendCommandMessage。
 */
export type IpcMessage = BackendStreamMessage | BackendControlEvent | FrontendCommandMessage;
