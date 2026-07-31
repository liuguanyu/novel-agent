## ADDED Requirements

### Requirement: 真实任务活动流

所有进入 `running` 的用户任务 MUST 由 Main 侧真实 Task Runtime 发布作者可读 activity stream。活动至少覆盖 task-run-started、input-declared、step-started/completed、tool-used、model-interaction、output-produced、ui-effect、awaiting-author、completed 和 failed，并按实际执行顺序记录。

#### Scenario: 运行任务持续可读
- **WHEN** 任务开始并执行多个步骤
- **THEN** 系统 MUST 发布包含动作、适用时的输入、输出、工作区反馈和下一步的活动
- **AND** 活动主文本 MUST NOT 以内部 ID、事件类型或技术阶段代码为主要表达

### Requirement: 常驻最近活动

底部消息流 MUST 常驻工作台，默认仅展示最近 2～3 条最有价值的活动；完整历史 MUST 可在任务中心查看，不得以加载动画、阶段标题或抽屉日志替代消息流。

#### Scenario: 默认活动数量受控
- **WHEN** 工作台有超过三条活动
- **THEN** 底部消息流 MUST 只展示最近 2～3 条重要活动
- **AND** 其余活动 MUST 保留并可进入任务中心查询

### Requirement: 真实 heartbeat

运行中的任务超过 2 秒没有新活动时 MUST 发布 heartbeat。heartbeat MUST 来自真实 Runtime 状态，并至少反映当前步骤、处理数量/总量、当前章节/人物/问题、最近完成的子步骤或正在等待的外部服务之一；MUST NOT 使用虚假百分比或循环占位文案。

#### Scenario: 长任务无新事件
- **WHEN** task run 保持 running 且连续超过 2 秒没有新活动
- **THEN** Runtime MUST 发布可验证状态的 heartbeat
- **AND** heartbeat MUST NOT 把未知进度伪装成百分比

### Requirement: 模型交互可审计且不泄露 hidden CoT

模型活动 MUST 展示任务目标、可见输入摘要、使用的上下文/引用、作者和系统业务约束、输出摘要、结构化结果、工具结果、验证结果以及采用/拒绝/等待确认状态。系统 MUST NOT 持久化或向 Renderer 展示 hidden chain-of-thought、不可追溯解释或不适合作者理解的内部 prompt 细节。

#### Scenario: 查看模型记录
- **WHEN** 作者展开一次模型交互活动
- **THEN** 作者 MUST 能追溯可见输入、证据、输出和验证/采用状态
- **AND** MUST NOT 看见隐藏推理过程
