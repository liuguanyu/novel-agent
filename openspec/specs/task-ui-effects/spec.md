# task-ui-effects Specification

## Purpose
TBD - created by archiving change task-centric-workbench. Update Purpose after archive.
## Requirements
### Requirement: 正文操作必须有 UI Effect

涉及正文、诊断或创作产物的任务 MUST 发布结构化 UI Effect，Renderer MUST 通过统一 executor 响应 effect；活动流 MUST 同时记录 effect 及实际工作区反馈。MUST 支持切章、滚动到证据、高亮原文、展示诊断标记、打开 Diff、进入逐 hunk 审核和展示 checkpoint，并可扩展事实底稿、复检报告等效果。

#### Scenario: 任务定位并反馈正文
- **WHEN** 任务找到正文候选位置
- **THEN** Runtime MUST 发布选择章节、滚动证据和高亮原文的 effect
- **AND** Renderer MUST 执行 effect 并在活动流记录已切章/已滚动/已高亮

### Requirement: 消息流与工作区事实一致

UI Effect 的消息必须描述实际发生的工作区变化；effect 执行失败 MUST 记录失败原因和可执行恢复动作，不得只显示成功文案。

#### Scenario: Effect 执行失败
- **WHEN** 目标章节不存在或高亮锚点失效
- **THEN** Renderer MUST 上报 effect failure
- **AND** 消息流 MUST 展示失败原因、已完成步骤和下一步建议

### Requirement: 禁止 Renderer 执行业务副作用

Renderer 只负责呈现和执行受限 UI effect，不得直接访问数据库、文件系统或模型，也不得本地写入正文、关闭任务或判定任务结果。正文落盘等副作用 MUST 由 Main 侧任务命令完成并以 effect/结果事件反馈。

#### Scenario: 正文修改进入审核
- **WHEN** 任务产生改写产物
- **THEN** 工作区 MUST 通过 Diff/Hunk review effect 展示
- **AND** 不得通过整章覆盖或 Renderer 本地写入正文

