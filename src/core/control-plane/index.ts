/**
 * control-plane 统一出口 (人工环路控制面：副驾拉手刹)
 *
 * 把 agent-orchestration 的图/状态/checkpointer 能力暴露为作者可用的交互语义：
 * - interrupt：条件性动态中断 + 强类型 payload。
 * - resume：带决策数据（批准/驳回/修改）的恢复，对接 activeBugs 可覆写 reducer。
 * - abort：经 AbortSignal 即时停止生成、断连，干净态保证，针对特定 runId。
 * - time-travel：checkpoint 历史查询、回退、分叉，与 story-bible 事实版本联动回滚。
 * - control-event：以上语义经 ipc-contract 的 control-event 通道传递（携带 runId）。
 *
 * 本模块为类型契约 + Zod schema + 纯函数 helper（无 I/O）；控制面逻辑归 Main/utilityProcess，绝不在 Renderer。
 */

export * from './interrupt.js';
export * from './resume.js';
export * from './abort.js';
export * from './time-travel.js';
export * from './control-event.js';
