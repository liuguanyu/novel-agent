## Why

专家工作台已经能消费真实 LangGraph 事件，并按时间顺序呈现“本轮目标 → 实际执行节点”。实际验证表明，执行流程是工作场景中的核心态势信息，不应与召唤/看板/动作工具混装在一个临时打开的底部 Sheet 中；同时静态放射能力图也不适合表达本轮先后顺序。

本 change 完成此前约定的阶段三布局迁移：把实时执行流程抽出到原工具区的常驻位置，让作者无需打开抽屉即可看到目标、参与节点和当前步骤；召唤/看板/动作入口则进入独立的底部工具抽屉。复用现有轨迹 hook、活动态模型与真实 IPC 事件，不改写 runtime。

## What Changes

- **流程工作台常驻化**：将“本轮目标 / 目标专家 / 实时执行路径”作为独立 `ExpertWorkbench` 主视图，放在三轴内容区下方、工具抽屉状态条上方；流程区默认可见，并可在无运行时显示等待态。
- **工具入口抽屉化**：把 Agent 召唤、看板、动作三排从流程工作台拆出为独立底部 `ToolboxDrawer`，默认收起，由常驻状态条展开；既有目录、禁用规则和回调不变。
- **有序流程规格收口**：`expert-workbench-graph` 从静态中心放射图修正为本轮目标驱动的有序执行链；每次节点 enter 追加一步，exit/interrupt/error 结算该步，循环重复经过同名节点时不得覆盖前一步。
- **布局骨架更新**：三轴主区不变，仅在其下增加常驻流程工作台，并在最底部保留工具抽屉入口；不迁移对话、正文、导航或各业务抽屉。

## Impact

- Affected specs: `expert-workbench-graph`、`summon-toolbox`、`layout-skeleton`。
- Affected code: `src/renderer/components/ExpertWorkbench.tsx`、新 `src/renderer/components/ToolboxDrawer.tsx`、`src/renderer/App.tsx`；复用 `WorkbenchGraph.tsx` 与 `useWorkbenchActivities.ts`，不改 IPC/runtime/core 数据模型。
- 兼容性：召唤命令、看板/动作回调、LangGraph 逐节点事件与底层状态模型不变；仅调整 renderer 承载关系。
