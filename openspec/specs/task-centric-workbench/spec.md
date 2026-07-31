# task-centric-workbench Specification

## Purpose
TBD - created by archiving change task-centric-workbench. Update Purpose after archive.
## Requirements
### Requirement: 当前任务主叙事

工作台 MUST 以当前任务作为主叙事。当前任务卡 MUST 展示任务名称、问题或创作目标、任务目的、输入、执行方式、预期输出、当前状态/进度、作者可执行主操作和下一步/等待作者事项。轻量流程导航和 Workflow Graph MUST 退居辅助位置，默认展示摘要，完整流程按需展开。

#### Scenario: 作者理解当前工作
- **WHEN** 作者打开工作台或任务运行中
- **THEN** 作者 MUST 能从当前任务卡理解正在完成什么、使用什么输入、如何执行、已得到什么结果以及下一步
- **AND** 完整流程 MUST 不占据默认主要工作空间

### Requirement: 旧作与新书共用任务模型

Task Runtime、Task Playbook、活动流、任务中心、模型审计、作者确认和 UI Effect MUST 同时支持旧作重建、新书创作及临时任务。底层任务模型 MUST NOT 要求项目已有小说正文。

#### Scenario: 新书无正文启动任务
- **WHEN** 新书项目创建“设计人物”或“规划章节”任务
- **THEN** 任务 MUST 能以目标、设定和其他显式上下文运行
- **AND** 不得因缺少旧作章节而改变运行契约

### Requirement: 任务中心保留完整记录

系统 MUST 保存每个 task run 的输入、活动、模型交互摘要、工具结果、产物、作者决策和最终状态，并允许从底部消息流进入任务中心查看完整历史。

#### Scenario: 从摘要查看完整任务
- **WHEN** 作者点击“查看完整任务”
- **THEN** 系统 MUST 展示当前任务的完整活动与产物引用
- **AND** 底部消息流仍保持轻量默认呈现

