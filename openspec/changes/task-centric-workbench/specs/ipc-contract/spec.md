## MODIFIED Requirements

### Requirement: Task Runtime IPC 契约

IPC MUST 提供强类型 task run 查询/命令和 `task-activity-event` 事件，至少区分 `projectRef`、`taskRunId`、可选 `workflowRef`、`chapterId`、`issueId` 和 `requestId`。改变任务状态或作者决策的命令 MUST 携带 `operationId`、`expectedVersion`，并在响应中返回成功快照或结构化 command failure。

#### Scenario: 创建并订阅任务
- **WHEN** Renderer 选择一个当前任务并请求开始
- **THEN** Main MUST 校验项目与任务归属、创建 task run 并发布真实 started/input 活动
- **AND** Renderer MUST 能通过 task activity 事件和重连查询恢复视图

### Requirement: 活动事件语义

`task-activity-event` MUST 携带任务运行引用、作者可读阶段/标题/消息、createdAt，并按需携带输入摘要、输出摘要、feedback、nextAction、evidenceRefs、artifactRefs、modelAudit 和 uiEffects。事件 MUST 反映真实执行，不得由 Renderer 根据最终 snapshot 猜测生成。

#### Scenario: 长任务 heartbeat 下行
- **WHEN** Main 侧任务超过 2 秒没有新活动
- **THEN** Main MUST 下发带真实状态摘要的 `task-run-heartbeat`
- **AND** heartbeat MUST 保持同一 taskRunId 且可与完整历史关联

### Requirement: UI Effect 与活动关联

所有正文或创作产物操作 MUST 在 IPC 活动中携带结构化 UI Effect；Effect 至少支持 `select-chapter`、`scroll-to-evidence`、`highlight-quote`、`show-diff`、`show-hunk-review` 和 `show-checkpoint`。Effect 执行结果 MUST 可上报并关联原 activity/taskRun。

#### Scenario: 定位原文 effect
- **WHEN** `locate-source` 找到候选
- **THEN** IPC MUST 下发章节选择、证据滚动和原文高亮 effect
- **AND** Renderer MUST 仅执行 UI 反馈并回报结果，不能直接修改业务数据

### Requirement: 模型审计边界

IPC 的模型交互 DTO MUST 只允许可见输入摘要、上下文/证据引用、作者/系统约束、输出摘要、结构化结果、工具结果、验证结果和采用状态。DTO、日志和持久化活动 MUST NOT 包含 hidden chain-of-thought 或未脱敏的内部 prompt。

#### Scenario: 模型结果可审计
- **WHEN** 模型任务完成或等待作者
- **THEN** 作者 MUST 能查看目标、可见上下文、结果和引用
- **AND** 契约 MUST 拒绝或省略 hidden CoT 字段

### Requirement: 向后兼容与范围校验

既有 standalone 运行和旧事件 MUST 继续可用；新增命令 MUST 校验 project/task/workflow/chapter/issue 归属、版本和 active run，失败返回可读且结构化的错误，不得因 Renderer 传入伪造引用而操作其他项目。

#### Scenario: 过期或伪造引用
- **WHEN** 命令携带不属于项目的引用或过期 expectedVersion
- **THEN** Main MUST 拒绝命令并返回 command failure
- **AND** MUST NOT 发布误导性的成功活动
