/**
 * 条件性动态中断（interrupt）契约 (human-in-the-loop tasks 1.1, 1.4)
 *
 * spec: interrupt-resume「条件性动态中断」——节点内以条件方式挂起（仅在需作者介入时），
 * 把强类型 payload 推给作者；静态断点仅作调试兜底（见 design D1）。
 *
 * 本文件为类型契约 + 纯判定 helper（无 I/O；实际 interrupt(payload) 由运行层节点内调用）。
 * 复用 story-bible 的 ConsistencyIssue 作为审稿报告 payload，避免重复定义。
 */

import type { RunId } from '../../shared/ipc/stream-messages.js';
import type { ConsistencyIssue } from '../story-bible/consistency-issue.js';

/**
 * 中断 payload（强类型判别联合，task 1.1）。
 * `kind` 判别；预置审稿报告，`refactor-plan` 等由后续 change（surgical-refactor）扩展其 plan 结构。
 * MUST NOT 使用 any（spec「payload 强类型」）。
 */
export type InterruptPayload =
  | { kind: 'review-report'; issues: ReadonlyArray<ConsistencyIssue> }
  | { kind: 'refactor-plan'; planRef: string }
  | { kind: string & Record<never, never>; [extra: string]: unknown };

/**
 * 一次中断通知（后端 → 作者）：携带 runId、挂起所在节点、强类型 payload。
 * 经 control-event 通道传递（task 1.5，见 control-event.ts）。
 */
export interface InterruptNotice {
  runId: RunId;
  /** 挂起点所在节点名（对应 graph-topology 的 NodeName） */
  atNode: string;
  /** 推给作者的强类型数据 */
  payload: InterruptPayload;
}

/**
 * 条件性中断判定 (task 1.1)：审稿节点是否应挂起等待作者裁决。纯函数。
 * 语义（spec「有问题才挂起」）：存在「需人工决策」的问题时 MUST 挂起；
 * 若无需介入 MUST NOT 挂起、继续运行。
 */
export function shouldInterruptForReview(issues: ReadonlyArray<ConsistencyIssue>): boolean {
  return issues.some((issue) => issue.requiresHumanDecision);
}

/**
 * 静态断点策略 (task 1.4)：interruptBefore/After 仅作调试兜底，
 * 不作为主交互机制（无法表达「有问题才停」）。此常量为该原则的显式契约标记。
 */
export const STATIC_BREAKPOINTS_ARE_DEBUG_ONLY = true as const;
