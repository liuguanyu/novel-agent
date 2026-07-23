## 1. core 静态图数据（Change 2 复用）

- [x] 1.1 新增 `src/core/shell/workbench-graph.ts`：定义 `WorkbenchNode`（`{ id; label; category | 'supervisor'; icon }`）与 `WorkbenchEdge`（`{ from; to; action? }`）类型
- [x] 1.2 从 `EXPERT_NODES` / `ACTION_ROUTING`（graph-topology）+ `AGENT_CATALOG`（agent-catalog）派生 `WORKBENCH_GRAPH: { nodes; edges }`：`supervisor` 节点 + 各专家节点（复用目录 label/category/icon）；边含 supervisor→专家（带 action）与专家→supervisor 回边
- [x] 1.3 定义染色数据模型：导出 `WorkbenchNodePhase = 'idle' | 'running' | 'done' | 'error' | 'awaiting'` 与 `WorkbenchActivity = { phase: WorkbenchNodePhase; runId: string }`；活动态以 `ReadonlyMap<string, WorkbenchActivity>` 建模（键=节点 id），结构容纳多节点/多跳
- [x] 1.4 单一事实源守卫：节点集与 `EXPERT_NODES` 编译期绑定（新增/删除专家漏登记即 TS 报错），不与图拓扑漂移；本文件无 React/lucide/I/O

## 2. 过渡数据源适配器（本步限定，Change 2 删除）

- [x] 2.1 新增 `src/renderer/lib/workbench-activities.ts`：纯函数 `deriveWorkbenchActivities(turns, activeRunId): ReadonlyMap<string, WorkbenchActivity>`，从对话 turns 的 `.agent` + `status` 投影单跳活动态（streaming→running / completed→done / error→error / aborted→idle；pendingConflict→awaiting 由 App 叠加或参数传入）
- [x] 2.2 文件头显式标注：过渡适配器，Change 2（graph-stream-tracing）由订阅 `graph-node-activated` 的 hook 取代，画布/数据模型不变

## 3. 活图画布组件（最终形态）

- [x] 3.1 新增 `src/renderer/components/WorkbenchGraph.tsx`：入参 `{ graph: typeof WORKBENCH_GRAPH; activities: ReadonlyMap<string, WorkbenchActivity> }`
- [x] 3.2 布局：`supervisor` 居中，专家节点按 `category`（写作/审校/重构/策划）分区环绕；节点用 HTML 绝对定位 + lucide 图标（经 `resolveIcon`）
- [x] 3.3 连线：复用 `FindingConnector` 的绝对定位 SVG + rAF 重算路子，画 supervisor↔专家边；走过/激活的边高亮
- [x] 3.4 染色：据 `activities` 给节点上色（idle 淡 / running 脉冲 / done 实 / error 朱砂 / awaiting 琥珀）；对任意节点集与任意点亮边渲染，不写死单节点

## 4. 专家工作台抽屉（改造 SummonBar）

- [x] 4.1 `SummonBar` 改造为「专家工作台」底部抽屉（`Sheet side="bottom"`），默认收起
- [x] 4.2 常驻状态条（收起态可见）：显示当前活动摘要（如「审校 运行中」），点击展开；有活动时可自动提示展开
- [x] 4.3 展开态：上半区渲染 `WorkbenchGraph`，下半区保留既有三排（召唤 / 看板 / 动作），功能与目录不减
- [x] 4.4 保留需锚点召唤项在无选中章节时禁用的既有规则

## 5. App 接线

- [x] 5.1 `App.tsx` 用 `deriveWorkbenchActivities(turns, activeRunId)`（+ pendingConflict 叠加 awaiting）算出 `activities`
- [x] 5.2 抽屉开合状态与「有活动可展开」逻辑在 App 持有；把 `activities` 与三排回调传入专家工作台
- [x] 5.3 移除/替换顶栏下方原常驻 `SummonBar` 挂载点为底部抽屉挂载

## 6. 校验

- [x] 6.1 `tsc -p tsconfig.node.json` / `tsc -p tsconfig.web.json` 通过
- [x] 6.2 eslint 通过
- [x] 6.3 `electron-vite build` 通过
- [x] 6.4 `npm run smoke:orchestration` 通过（本步无后端改动，回归确认）
- [x] 6.5 `openspec validate expert-workbench-graph --strict` 通过
