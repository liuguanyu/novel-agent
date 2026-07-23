## 1. IPC 契约（纯增量）

- [x] 1.1 `control-messages.ts` 新增 `GraphNodeActivatedEvent`：`{ type: 'graph-node-activated'; runId: RunId; node: string; phase: 'enter' | 'exit' }`
- [x] 1.2 并入 `BackendControlEvent` 判别联合；确认 barrel 导出

## 2. 运行时 `#drive` invoke→stream 等价改写（高风险点，集中处理）

- [x] 2.1 `#drive` 改为 `for await` 消费 `this.#graph.stream(input, { configurable, signal, streamMode: ['tasks', 'values'] })`
- [x] 2.2 消费 `tasks` 分片：节点 start payload（`input !== undefined`）下发 `graph-node-activated(enter)`，节点 result payload（`result !== undefined`）下发 `graph-node-activated(exit)`，按 LangGraph 真实执行顺序反馈节点生命周期
- [x] 2.3 消费 `values` 分片维护 `latestState`；同时从 `tasks.interrupts` 与最终 `values[INTERRUPT]` 提取挂起 payload
- [x] 2.4 挂起分支等价复现：stream-end(completed) → 审校类非空则 review-completed → interrupt-raised；不删 run
- [x] 2.5 正常完成分支等价复现：stream-end(completed) → 审校类据最终 `activeBugs` 非空下发 review-completed → 删 run
- [x] 2.6 abort / 错误分支语义不变（signal.aborted → stream-end(aborted)；否则 stream-error）
- [x] 2.7 `npm run smoke:orchestration` 全场景回归通过（等价性验证）

## 3. 前端数据源替换（画布零改动）

- [x] 3.1 新增 `src/renderer/hooks/useWorkbenchActivities.ts`：订阅 `onControlEvent` 过滤 `graph-node-activated`，按 `runId` 维护 `WorkbenchActivities`（enter→running、exit→done）；叠加 `interrupt-raised`→awaiting、`stream-error`（对话流）→error 收敛
- [x] 3.2 新一次召唤开始时清上一轮点亮（据 runId 变化重置），保留最近一次运行的轨迹显示
- [x] 3.3 删除过渡适配器 `src/renderer/lib/workbench-activities.ts`
- [x] 3.4 `App.tsx` 换用 `useWorkbenchActivities`；`WorkbenchGraph.tsx` / `ExpertWorkbench.tsx` / `core/shell/workbench-graph.ts` 不改动

## 4. 校验

- [x] 4.1 `tsc -p tsconfig.node.json` / `tsc -p tsconfig.web.json` 通过
- [x] 4.2 eslint 通过
- [x] 4.3 `electron-vite build` 通过
- [x] 4.4 `npm run smoke:orchestration` 通过
- [x] 4.5 `openspec validate graph-stream-tracing --strict` 通过
