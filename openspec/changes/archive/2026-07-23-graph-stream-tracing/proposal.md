## Why

专家工作台的活图（`expert-workbench-graph`，已落地）目前只能按「召唤的目标 agent + run 状态」点亮单跳——因为后端 `#drive` 用 `graph.invoke()` 一次性跑到底，图内部即使经过 `supervisor → writer → supervisor → reviewer → …` 的多跳循环，外部也只拿到最终结果，**中间节点转移全部丢失**。活图承诺的「实时点亮、如实反馈」在多跳运行（mutate 模式写-审-改循环、correct/modify 裁决后回写手续跑）下无法兑现。

本 change 让图变透明：`#drive` 从 `invoke` 改为 `stream(streamMode: ['tasks', 'values'])` 逐节点消费；`tasks` 分片提供真实节点 start/result 生命周期，后端据此经控制事件通道下发 `graph-node-activated`，`values` 分片保留最终状态与 interrupt payload 收敛；前端以订阅 hook 取代 Change 1 预留的过渡适配器（`workbench-activities.ts`），把逐节点事件灌入**同一** `WorkbenchActivities` 数据模型——画布 `WorkbenchGraph`、core 图数据 `WORKBENCH_GRAPH` 按约定零改动。

## What Changes

- **IPC 契约**：`src/shared/ipc/control-messages.ts` 新增 `GraphNodeActivatedEvent`（`type: 'graph-node-activated'`, `runId`, `node: string`, `phase: 'enter' | 'exit'`），并入 `BackendControlEvent` 判别联合（barrel 自动导出）。纯增量，既有事件不动。
- **运行时改造（唯一高风险点，集中于 `#drive`）**：`src/main/orchestration/runtime.ts` 的 `#drive` 把 `this.#graph.invoke(input, config)` 换为 `for await` 消费 `this.#graph.stream(input, { ...config, streamMode: ['tasks', 'values'] })`：
  - `tasks` start payload（`input !== undefined`）下发 `graph-node-activated(enter)`，result payload（`result !== undefined`）下发 `graph-node-activated(exit)`，按 LangGraph 真实执行顺序反馈节点生命周期。
  - 从 `tasks.interrupts` 与最终 `values[INTERRUPT]` 收敛挂起信息，等价复现原 `isInterrupted(result)` 分支（stream-end + review-completed + interrupt-raised 语义不变）。
  - 正常跑完后从最新 `values` 得出最终 `activeBugs`，等价复现原完成分支。abort / 错误分支语义不变。
  - `summon` / `resume` / `restartFromCheckpoint` 三入口共用 `#drive`，一处改造全通路生效。
- **前端数据源替换（删过渡适配器，画布不动）**：删除 `src/renderer/lib/workbench-activities.ts`；新增 `src/renderer/hooks/useWorkbenchActivities.ts` 订阅 `onControlEvent` 过滤 `graph-node-activated`（叠加 `stream-end` / `stream-error` / `interrupt-raised` 收敛终态），产出同一 `WorkbenchActivities` 模型；`App.tsx` 换用该 hook。`WorkbenchGraph.tsx` / `ExpertWorkbench.tsx` / `workbench-graph.ts` 零改动（Change 1 防返工约定兑现）。
- **smoke 回归**：`smoke:orchestration` 既有 I6 / interrupt / abort 场景覆盖 `#drive` 全分支，并新增 graph tracing 断言（supervisor / writer / reviewer enter→exit、interrupt 前已有触发节点事件），作为改造后的等价性验证。

## Impact

- Affected specs: `ipc-contract`（MODIFIED：控制事件目录新增 `graph-node-activated`）、`orchestration-runtime`（MODIFIED：运行时 MUST 逐节点流式驱动并下发节点转移事件）、`expert-workbench-graph`（MODIFIED：活图据逐节点事件多跳实时点亮，不再限于单跳投影）。
- Affected code: `src/shared/ipc/control-messages.ts`、`src/main/orchestration/runtime.ts`（`#drive`）、`src/renderer/hooks/useWorkbenchActivities.ts`（新）、`src/renderer/lib/workbench-activities.ts`（删）、`src/renderer/App.tsx`。
- 兼容性：`stream-*` 对话流、`interrupt-raised` / `review-completed` 等既有事件语义与时序不变；仅新增一个控制事件成员。风险集中在 `#drive` 的 invoke→stream 等价改写，由 `smoke:orchestration` 全场景回归兜底。tsc(node/web)/eslint/build 保持绿。
