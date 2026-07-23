/**
 * 控制面与 control-event 通道映射 (human-in-the-loop tasks 1.5, 2.3；design D6)
 *
 * spec: 所有控制语义（interrupt 通知、resume 命令、abort 命令、time-travel 操作、状态变更、错误）
 * MUST 经 ipc-contract 的 control-event 通道传递，携带 runId，错误作为一等消息（见 design D6）。
 *
 * 本文件为类型契约（无 I/O）。把控制面语义类型收敛为「经 control-event 通道」的强类型事件，
 * 并声明与 ipc-contract 占位命令的对接点（ResumeRunCommand.decision 的强类型化目标）。
 */

import type { RunId } from '../../shared/ipc/stream-messages.js';
import type { InterruptNotice } from './interrupt.js';
import type { ResumeDecision } from './resume.js';
import type { AbortRequest } from './abort.js';
import type { RollbackRequest, ForkRequest, HistoryQuery } from './time-travel.js';

/**
 * 后端 → 作者 的控制事件（经 control-event 通道下行）。
 * 与 ipc-contract 的后端流式消息正交：内容走 manuscript/dialogue，控制走此处（见 channels.ts）。
 */
export type BackendControlEvent =
  | { type: 'interrupt'; notice: InterruptNotice }
  | { type: 'run-status'; runId: RunId; status: 'suspended' | 'resumed' | 'aborted' };

/**
 * 作者 → 后端 的控制命令（经 control-event 通道上行）。
 * 强类型化 ipc-contract 中 ResumeRunCommand.decision(unknown)：Main 侧以 resumeDecisionSchema
 * 校验后得 ResumeDecision，再包装为此处的 resume 命令（占位替换，见 resume.ts）。
 */
export type AuthorControlCommand =
  | { type: 'resume'; runId: RunId; decision: ResumeDecision }
  | { type: 'abort'; request: AbortRequest }
  | { type: 'time-travel-history'; query: HistoryQuery }
  | { type: 'time-travel-rollback'; request: RollbackRequest }
  | { type: 'time-travel-fork'; request: ForkRequest };

/**
 * 控制面消息 MUST 携带 runId 关联运行 (tasks 1.5, 2.3)。
 * 此常量为该约束的显式契约标记（与 ipc-contract 的 runId 关联一致）。
 */
export const CONTROL_EVENTS_CARRY_RUN_ID = true as const;
