# task-centric-workbench

## Why

当前工作台以流程快照、技术阶段和最终状态拼装展示进度，作者难以持续理解“现在正在完成什么、用了什么依据、得到了什么、下一步需要我做什么”。这也使底部消息流无法成为可靠的工作脉搏，正文定位、改写和其他产物操作与实际工作区反馈脱节。

本 change 以当前任务建立统一主叙事，使用真实 Task Runtime 发布作者可读活动，以常驻的最近 2～3 条底部消息保持轻量反馈，并将任务结果通过明确 UI Effect 映射到工作区。首个真实端到端任务为 `locate-source`，同时从模型层面支持旧作重建与新书创作，不把底层模型绑定到已有小说。

## What Changes

- 新增统一 Task Runtime、Task Playbook、task run 状态、输入/产物/作者决策与活动事件模型。
- 工作台增加当前任务卡；Workflow Graph 默认只展示轻量摘要，完整流程进入任务中心按需查看。
- 底部消息流常驻，默认只展示最近 2～3 条高价值活动；完整历史进入任务中心。
- 所有 running 任务发布真实 activity；连续超过 2 秒无活动时依据真实状态发布 heartbeat，禁止虚假百分比和循环文案。
- 模型交互展示任务目标、可见输入、上下文、约束、输出摘要、结构化结果、引用、工具结果和采用/拒绝/待确认状态，但不展示 hidden chain-of-thought。
- 涉及正文或创作产物的任务必须发布 UI Effect，Renderer 执行 effect，并在活动流记录实际工作区变化。
- 首先实现 `locate-source`：诊断问题 → 证据/章节检索 → 精确或近似匹配 → 候选确认 → 切章、滚动、高亮 → 进入局部改写。
- 旧作重建和新书创作共用 Task Runtime、活动流、任务中心、审计、UI Effect 和作者确认机制。

## Capabilities

### New Capabilities

- `task-centric-workbench`
- `task-activity-stream`
- `task-ui-effects`

### Modified Capabilities

- `ipc-contract`

## Impact

- Core/Main：新增任务、playbook、活动、heartbeat、产物和 effect 契约；Main 负责真实运行、持久化与发布。
- Renderer：消费强类型任务快照/活动/effect，只提交作者意图，不访问 DB、LLM 或文件系统。
- IPC：增加 task run、activity、heartbeat、UI effect 和作者决策契约，同时兼容 standalone/旧运行事件。
- 产品行为：当前任务成为主叙事，流程退居辅助；底部消息流不再依赖 snapshot 反推运行日志。
