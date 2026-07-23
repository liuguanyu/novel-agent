## ADDED Requirements

### Requirement: 长期工作流实例使用稳定标识并跨运行聚合

系统 MUST 以稳定 `workflowId` 标识一个长期业务工作流，并允许该实例包含多个独立 `runId`。`WorkflowInstance` MUST 至少包含 `workflowId`、`projectId`、`kind`（`new-book-creation` / `legacy-book-revision`）、`templateVersion`、`objective`、`status`（`active` / `paused` / `completed` / `cancelled` / `failed`）、`currentStageId`、`stages`、`createdAt` 与 `updatedAt`；`runId` MUST 只标识一次具体编排运行，MUST NOT 被用作长期工作流主键。

#### Scenario: 多轮人物设计属于同一工作流阶段
- **WHEN** 人物设计初稿、作者补充意见和人物修订分别产生三个 `runId`
- **THEN** 三次运行 MUST 关联同一 `workflowId` 与人物设计 `stageId`
- **AND** 新运行 MUST NOT 清除长期实例中的前序阶段运行关联

#### Scenario: 单次召唤无需伪造工作流
- **WHEN** 作者在没有活动工作流时发起一次按需专家召唤
- **THEN** 系统 MUST 允许该运行只携带 `runId`
- **AND** MUST NOT 强制创建虚假的 `workflowId` 或模板阶段

### Requirement: 阶段实例具备精确状态、范围与证据

每个 `WorkflowStageInstance` MUST 至少包含 `stageId`、`templateStageId`、`status`（`pending` / `ready` / `running` / `blocked` / `awaiting-confirmation` / `completed` / `skipped` / `failed`）、`actor`（`system` / `expert` / `author` / `quality-gate`）、`scope`、`runIds` 与 `artifactRefs`。`scope` MUST 为 project、chapter 或 issue 的可判别联合并使用稳定标识；阻塞、进入和完成信息 MUST 以可选强类型字段表达，MUST NOT 使用自由字符串替代状态。

#### Scenario: 阶段失败不等于完成
- **WHEN** 当前阶段运行失败
- **THEN** 阶段 MUST 转为 `failed` 或可重试的 `blocked`
- **AND** MUST NOT 自动标记 `completed` 或推进到下一阶段

#### Scenario: 重试保留运行历史
- **WHEN** 作者重试失败阶段
- **THEN** 系统 MUST 为重试创建新的 `runId` 并追加到阶段 `runIds`
- **AND** MUST 保留此前失败运行的关联

### Requirement: 阶段转换由模板规则与完成证据驱动

工作流服务 MUST 是阶段状态的唯一业务写入者，并 MUST 根据模板允许的转换、当前实例版本与强类型完成证据校验每次推进。只有模板声明为可跳过的阶段才可被作者显式跳过；自动步骤成功时 MAY 自动推进，作者验收、冲突裁决、正文落盘与定稿等人工门 MUST 等待明确命令。

#### Scenario: 作者确认后推进策划阶段
- **WHEN** 人物设计专家已产出结果但作者尚未确认
- **THEN** 人物设计阶段 MUST 为 `awaiting-confirmation`
- **AND** 下一阶段 MUST NOT 自动开始
- **WHEN** 作者提交有效确认命令
- **THEN** 工作流服务 MUST 完成人物设计阶段并激活模板定义的下一阶段

#### Scenario: 非法跳过被拒绝
- **WHEN** 作者请求跳过模板未声明为可跳过的阶段
- **THEN** Main MUST 返回结构化命令失败
- **AND** 工作流实例 MUST 保持原状态

### Requirement: 工作流状态持久化并可恢复

Main MUST 将工作流实例、阶段、阶段运行关联和产物引用持久化到 SQLite；应用重启或项目重新打开后 MUST 从持久化状态恢复活动/暂停工作流。模板实例 MUST 固定 `templateVersion` 并保存其阶段快照，升级模板 MUST NOT 静默改变进行中实例。

#### Scenario: 重启后恢复当前阶段
- **WHEN** 应用在一个 `awaiting-confirmation` 的工作流中退出并重新打开项目
- **THEN** 系统 MUST 恢复相同 `workflowId`、当前阶段、运行历史和阻塞/确认状态
- **AND** MUST NOT 从模板第一阶段重新开始

#### Scenario: 模板升级不改道旧实例
- **WHEN** 软件升级后的模板版本新增或调整阶段
- **THEN** 既有工作流 MUST 继续使用创建时的 `templateVersion` 与阶段快照
- **AND** 任何实例迁移 MUST 通过显式迁移执行

### Requirement: 项目活动工作流并发受控

首版系统 MUST 限制同一项目同一时刻最多一个 `active` 工作流，同时 MAY 保留任意数量的 paused、completed、cancelled 或 failed 实例。启动第二个工作流前 MUST 要求作者完成、取消或暂停当前活动工作流。

#### Scenario: 阻止两个活动工作流竞争正文
- **WHEN** 项目已有 active 工作流且作者请求启动另一工作流
- **THEN** Main MUST 拒绝直接启动并返回当前活动实例摘要
- **AND** MUST 提供先暂停、完成或取消当前工作流的明确选择
