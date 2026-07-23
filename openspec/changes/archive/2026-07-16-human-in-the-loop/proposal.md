## Why

本产品的灵魂是“副驾拉手刹”：AI 开车（写/审/纠/重构），作者随时可以打断、纠偏、回退。这需要一套
**人工环路控制面**，把 LangGraph 的中断与状态能力暴露为作者可用的交互语义：

- **interrupt**：agent 跑到关键点（如审稿出报告、重构出方案）挂起，把 payload 推给作者。
- **resume**：作者批准/驳回/修改后，带着决策数据继续。
- **abort**：作者读到一半发现跑偏，立刻停止流式生成、断开模型连接省 token。
- **time-travel**：回退到历史 checkpoint，甚至从某点分叉，获得干净上下文。

这四者共同实现“随时对话、实时纠偏”。它们建立在 agent-orchestration 的图、状态与 checkpointer 之上。

本 change 定义控制面的语义与契约（spec 层面），不实现具体 agent、不实现召唤入口（on-demand-summon）、
不实现 UI（electron-shell-ui），不写代码。

## What Changes

- 定义 **动态中断（interrupt）语义**：优先用节点内 `interrupt(payload)` 的条件性中断（如“有 bug 才停”），
  把结构化 payload（审稿报告/重构方案）推给作者；静态断点仅作调试兜底。
- 定义 **恢复（resume）语义**：作者以 `Command(resume=决策数据)` 继续，决策数据进入状态影响后续节点；
  支持批准、驳回、修改（如覆写 activeBugs）。
- 定义 **中断（abort）语义**：经 AbortSignal 立即停止当前运行、断开模型连接；因 checkpoint 在节点边界，
  未提交的当前步天然丢弃，最近 checkpoint 即干净态。
- 定义 **时间旅行（time-travel）语义**：查询 checkpoint 历史、回退到某 checkpoint、从某 checkpoint 分叉；
  与 story-bible 事实版本联动回滚。
- 定义 **abort 与 time-travel 的区别**：abort=丢弃未提交当前步（廉价即时）；time-travel=从历史
  checkpoint 主动回溯/分叉。
- 定义 **控制面与 IPC 的映射**：控制语义经 control-event 通道传递（遵循 ipc-contract）。

## Capabilities

### New Capabilities
- `interrupt-resume`: 条件性中断与带决策数据的恢复。
- `abort-control`: 运行中断（停止生成、断连、干净态保证）。
- `time-travel`: checkpoint 历史查询、回退与分叉，及事实版本联动。

### Modified Capabilities
<!-- 无。 -->

## Impact

- 依赖 `agent-orchestration`（图/状态/checkpointer）、`bootstrap-foundation`（IPC control-event 通道、
  model-adapter 的 AbortSignal）、`story-bible`（fact-versioning 的 checkpoint 关联，供回滚联动）。
- 为 `on-demand-summon`（召唤后挂起等待作者裁决）、`surgical-refactor`（重构方案挂起待接受/拒绝）、
  `electron-shell-ui`（手刹按钮、审批弹窗、历史时间线）提供控制语义基座。
- 控制面逻辑位于 Main/utilityProcess，绝不在 Renderer；经 control-event 通道与前端交互。
