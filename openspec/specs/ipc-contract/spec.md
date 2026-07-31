# ipc-contract Specification

## Purpose
TBD - created by archiving change bootstrap-foundation. Update Purpose after archive.
## Requirements
### Requirement: IPC 三通道正交

系统 MUST 提供三条正交的 IPC 通道：正文流（manuscript-stream）、对话流（dialogue-stream）、控制事件（control-event）；三者职责不重叠。事实抽取的进度、完成、失败与冲突裁决事件 MUST 走控制事件通道。全书总检的 started/progress/completed/failed 事件 MUST 走控制事件通道。Story Bible 事实确认的完成/失败事件 MUST 走控制事件通道。Story Bible 事实编辑的完成/失败事件 MUST 走控制事件通道。Story Bible 事实删除与实体合并的完成/失败事件 MUST 走控制事件通道。审校类 agent（reviewer / fact-checker / plagiarism-checker）诊断出的结构化一致性问题清单 MUST 经控制事件通道以强类型 `review-completed` 事件下行，MUST NOT 混入内容流通道。编排图运行的逐节点转移 MUST 经控制事件通道以强类型 `graph-node-activated` 事件（携 `runId`、节点名与 enter/exit 相位）下行，MUST NOT 混入内容流通道。

#### Scenario: Story Bible 删除/合并事件强类型
- **WHEN** Story Bible 事实删除或实体合并完成或失败
- **THEN** 后端 MUST 经 control-event 下发带 runId 的强类型事件
- **AND** 成功事件 MUST 包含操作目标与最新 factVersion

#### Scenario: 审校结果结构化下行
- **WHEN** 审校类 agent 运行结束（正常完成或因需人工裁决而挂起）且产出非空一致性问题清单
- **THEN** 后端 MUST 经 control-event 下发 `review-completed` 事件，携 `runId`、产出 agent 标识与强类型 `ConsistencyIssueDto[]`
- **AND** 该结构化清单 MUST NOT 以裸文本形态经内容流通道传递
- **AND** 需人工裁决时既有 `interrupt-raised` 裁决通路 MUST 不受影响并可与 `review-completed` 并存

#### Scenario: 图节点转移事件下行
- **WHEN** 编排图一次运行中某节点开始或完成执行
- **THEN** 后端 MUST 经 control-event 下发 `graph-node-activated` 事件，携 `runId`、节点名与 `enter`/`exit` 相位
- **AND** 该事件 MUST NOT 混入内容流通道
- **AND** 既有对话流分片与 `interrupt-raised` / `review-completed` 事件的语义与时序 MUST 不受影响

### Requirement: 强类型消息与运行关联
系统 MUST 将所有 IPC 消息定义为以 `type` 字段判别的 discriminated union，并携带 `runId` 关联同一次运行。

#### Scenario: Story Bible 删除/合并命令可判别
- **WHEN** Renderer 请求删除某条事实或合并两个实体
- **THEN** 前端 MUST 发送 `delete-story-bible-fact` 或 `merge-story-bible-entities` 命令并携带 runId 与受限 payload
- **AND** 后端 MUST 通过判别联合收窄命令类型，无需使用 any

### Requirement: 流式、中断与错误语义
系统 MUST 在 IPC 契约中支持流式传输、运行中断，并将错误作为一等消息类型传递。作者恢复决策（`resume-run` 的 `decision`）跨 IPC 到达 Main 时为不可信输入，Main MUST 在驱动图续跑前校验其判别形状，非法/未知决策 MUST 以强类型错误消息拒绝而非让异常穿透。

#### Scenario: 流式内容分片传递
- **WHEN** 后端产生流式内容（正文或对话）
- **THEN** 内容 MUST 以增量分片经对应流通道推送
- **AND** 每次运行 MUST 有明确的开始与结束标记

#### Scenario: 前端可发起中断
- **WHEN** 作者请求停止（拉手刹）
- **THEN** 前端 MUST 能经 control-event 通道发送针对特定 `runId` 的 abort 命令
- **AND** 后端 MUST 能据此中止对应运行

#### Scenario: 错误作为消息而非异常穿透
- **WHEN** 后端在处理某运行时发生错误
- **THEN** 错误 MUST 作为控制事件通道上的强类型错误消息传递（含 `runId`）
- **AND** MUST NOT 以未捕获异常形式跨越 IPC 边界

#### Scenario: 恢复决策的 Main 侧校验
- **WHEN** Main 收到 `resume-run` 命令
- **THEN** Main MUST 校验 `decision` 为受支持的判别联合（`approve` / `reject` / `correct` 携带 `optionId` / `modify` 携带 issues）
- **AND** 决策非法或 `kind` 未知时 MUST 以 stream-error（含 `runId`）拒绝，MUST NOT 将其透传至图的续跑分支

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

