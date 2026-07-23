/**
 * 即时中断（abort）契约 (human-in-the-loop tasks 2.1–2.3, 3.4)
 *
 * spec: abort-control——经 AbortSignal 立即停止流式生成并断连省 token；被 abort 的当前节点
 * 未提交、半成品 MUST NOT 进入状态，最近 checkpoint 即干净态；abort 针对特定 runId，
 * 不影响其他并发运行（见 design D3、D5）。
 *
 * 本文件为类型契约（无 I/O；AbortController 的持有与信号触发由 Main 运行层完成）。
 * 复用 model-adapter 的 AbortSignal 语义（ModelCallOptions.signal）。
 */

import type { RunId } from '../../shared/ipc/stream-messages.js';

/** 作者发起的 abort 请求：针对特定运行（task 2.3）。 */
export interface AbortRequest {
  runId: RunId;
  /** 可选中止原因（供日志/呈现，不影响语义） */
  reason?: string;
}

/**
 * 运行级 abort 句柄注册表 (tasks 2.1, 2.3)。Main 侧实现。
 * 每个 runId 关联一个 AbortController，其 signal 注入 model-adapter 的 ModelCallOptions.signal；
 * abort(runId) 仅触发对应运行的信号，MUST NOT 影响其他并发运行。
 * core 仅声明契约，不持有实际 controller。
 */
export interface AbortRegistry {
  /** 注册一次运行的中止控制器，返回其 signal 供模型调用透传 */
  readonly register: (runId: RunId) => AbortSignal;
  /** 中止指定运行：触发其 AbortSignal，SHOULD 尽快断连 */
  readonly abort: (request: AbortRequest) => void;
  /** 运行结束后清理句柄 */
  readonly dispose: (runId: RunId) => void;
}

/**
 * 干净态保证 (task 2.2 / spec「未提交步天然丢弃」)。
 * 因 checkpointer 在节点边界提交，abort 落在节点执行中途时其产出未提交，
 * 半成品不进入状态；最近 checkpoint 即该节点开始前的干净态，无需显式回滚。
 * 此常量为该性质的显式契约标记（与 orchestration 的 ABORT_LEAVES_CLEAN_CHECKPOINT 对应）。
 */
export const ABORT_DISCARDS_UNCOMMITTED_STEP = true as const;

/**
 * abort 与 time-travel 的语义区分标记 (task 3.4 / spec「与 abort 语义区分」)。
 * abort = 丢弃「未提交的当前步」，即时、廉价、不涉及历史；
 * time-travel = 从「已提交的历史 checkpoint」回溯或分叉（见 time-travel.ts）。
 */
export const ABORT_IS_NOT_TIME_TRAVEL = true as const;
