## Why

现在「谁在参与工作、正在干什么」这件事只能从右侧对话轴的气泡里零散推断——作者看不到编排图（LangGraph）本身：有哪些专家节点、supervisor 如何居中路由、这一次召唤实际点亮了哪个节点。底部的「工具箱」把会拟人的 agent 和纯功能入口混在一起，命名与形态都不贴合「一群专家在协作」的心智模型。

本 change 把「工具箱」升级为**专家工作台**：一个默认收起、有活动可展开的底部抽屉，里面把编排图**画成一张活图**——`supervisor` 居中、专家节点按类别（写作 / 审校 / 重构 / 策划）分区环绕、边来自路由表；并据运行状态给节点**实时染色**（空闲 / 运行中 / 完成 / 出错 / 待裁决）。既有的三排召唤/看板/动作入口平移进抽屉，不丢功能。

这是「专家工作台」两步计划的第一步：**先把活图 UI 与染色数据模型建成最终形态**（能容纳多节点、多跳、循环），本步用现有信号（对话 turns + 控制事件）喂数据，只能点亮单跳；下一步 change（`graph-stream-tracing`）把后端 `#drive` 从 `invoke` 换成 `stream` 并新增逐节点事件，届时**画布与数据模型零改动**，仅替换数据源即可升级为真·逐节点实时点亮。故本步刻意不做脆弱的节点推断——按「召唤的目标 agent + run 状态」如实点亮那一个节点。

## What Changes

- **core 静态图数据（新，Change 2 复用）**：新增 `src/core/shell/workbench-graph.ts`，从 `graph-topology` 的 `EXPERT_NODES` / `ACTION_ROUTING` 与 `agent-catalog` 的类别派生出**画布拓扑**：节点（含 `supervisor` 与各专家、类别、标签、图标名）、边（supervisor↔专家、专家→supervisor 回边）。纯数据 + 纯函数，无 React / lucide / I/O，与图拓扑同源不漂移。
- **染色数据模型（新，最终形态）**：定义节点活动态 `WorkbenchNodePhase = 'idle' | 'running' | 'done' | 'error' | 'awaiting'`，以 `ReadonlyMap<node, { phase, runId }>` 承载——结构上即可容纳多节点/多跳/循环，Change 2 直接复用。
- **临时数据源适配器（本步限定，Change 2 删除）**：新增纯函数 `deriveWorkbenchActivities(turns, activeRunId)`，从现有对话 turns（`.agent` + `status`）投影出活动态。**显式标注为过渡适配器**：本步只能填出单跳；Change 2 上 `graph-node-activated` 事件后由订阅 hook 取代，画布不改。
- **活图画布组件（新，最终形态）**：新增 `src/renderer/components/WorkbenchGraph.tsx`，据 `WORKBENCH_GRAPH` 布局节点（supervisor 居中、专家按类别环绕）与连线（复用 `FindingConnector` 的绝对定位 SVG + rAF 重算路子），据传入的 `activities` 给节点/边染色与脉冲动画。组件对「任意节点集 + 任意点亮边」渲染，不写死单节点。
- **专家工作台抽屉（改造 SummonBar）**：`SummonBar` 更名语义为「专家工作台」，改为**默认收起、有活动可展开的底部抽屉**（`Sheet side="bottom"`）；抽屉顶部常驻一条状态条（收起态也可见）显示当前活动摘要（如「审校 运行中」），展开后上半区为活图、下半区为既有三排（召唤 / 看板 / 动作）。原三排功能与目录完全保留。
- **App 接线**：`App.tsx` 计算 `activities`（本步经 `deriveWorkbenchActivities(turns, activeRunId)`）并传入工作台；抽屉开合状态与「有活动自动可展开」逻辑在 App 持有。

## Impact

- Affected specs: 新增 capability `expert-workbench-graph`（ADDED：活图画布 + 节点实时染色 + 静态图数据同源）；`summon-toolbox`（MODIFIED：三排工具条承载于「专家工作台」底部抽屉，默认收起、有活动可展开，命名与形态更新，三排能力不减）。
- Affected code: `src/core/shell/workbench-graph.ts`（新）、`src/renderer/components/WorkbenchGraph.tsx`（新）、`src/renderer/lib/workbench-activities.ts`（新，过渡适配器）、`src/renderer/components/SummonBar.tsx`（改造为专家工作台抽屉）、`src/renderer/App.tsx`（接线）。
- 无后端 / IPC / preload 改动；`summon` / 控制事件协议不变；命令面板与 agent/toolbox 目录不变。tsc(node/web)/eslint/build/smoke:orchestration 保持绿。
- 明确的前向兼容：染色数据模型与画布为最终形态，Change 2（`graph-stream-tracing`）仅替换数据源（删除过渡适配器、接入 `graph-node-activated` 订阅 hook），不回改本 change 的画布 / 布局 / core 图数据。
