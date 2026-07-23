## ADDED Requirements

### Requirement: 工作流命令与快照经控制通道强类型传递

IPC MUST 为工作流提供以 `type` 判别的强类型命令与事件。命令至少覆盖启动/查询工作流、开始/确认/重试/跳过阶段、暂停/恢复/取消工作流、选择/忽略/复检问题；事件至少覆盖 `workflow-snapshot-updated` 与 `workflow-command-failed`。快照 MUST 包含 `workflowId`、版本号、工作流状态、当前阶段、阶段摘要、允许动作和问题状态，MUST NOT 要求 Renderer 访问持久化层补全业务状态。

#### Scenario: 启动工作流返回快照
- **WHEN** Renderer 提交合法 `start-workflow` 命令
- **THEN** Main MUST 经 control-event 返回强类型 `workflow-snapshot-updated`
- **AND** 快照 MUST 包含新 `workflowId`、模板类型、当前阶段与允许动作

#### Scenario: 旧快照命令冲突
- **WHEN** Renderer 使用过期版本提交阶段推进命令
- **THEN** Main MUST 返回 `workflow-command-failed` 与最新快照或其引用
- **AND** MUST NOT应用冲突转换

### Requirement: 创作资产澄清与影响经控制通道强类型传递

IPC MUST 提供资产查询、发起澄清、确认/拒绝 change set 和处理影响的强类型命令，并提供 `creative-asset-change-proposed`、`creative-asset-updated`、`asset-impact-detected` 与结构化失败事件。change set DTO MUST 包含目标 `assetId`、base version、字段级 operations 和作者原始澄清；影响 DTO MUST 包含来源资产版本、受影响对象稳定引用、影响级别和允许动作。

#### Scenario: 澄清候选变更下行
- **WHEN** Main 将作者澄清解析为目标人物资产的字段级变更
- **THEN** control-event MUST 下发可审阅的 `creative-asset-change-proposed`
- **AND** Renderer MUST NOT 在收到作者确认前把候选内容显示为已落库

#### Scenario: 资产更新后下发影响
- **WHEN** 作者确认资产 change set 且 Main 成功提交新版本
- **THEN** Main MUST 下发 `creative-asset-updated` 和适用的 `asset-impact-detected`
- **AND** 事件 MUST 携带 asset id/version 与受影响对象稳定引用

### Requirement: 既有运行事件可选关联工作流阶段

`stream-start`、`graph-node-activated`、`interrupt-raised`、`review-completed`、`refactor-diff-computed` 与 `refactor-applied` 等属于阶段的既有事件 MUST 携带可选 `workflowRef`，其字段至少为 `workflowId`、`stageId`，issue scope 时包含 `issueId`。不属于工作流的事件 MUST 继续只使用 `runId`，保持向后兼容。

#### Scenario: 节点事件挂载当前阶段
- **WHEN** 一个有 `workflowRef` 的 run 发出 `graph-node-activated`
- **THEN** 事件 MUST 同时携带原 `runId` 与相同 `workflowRef`
- **AND** Renderer MUST 能将真实轨迹显示在对应业务阶段下

#### Scenario: standalone 事件不破坏判别联合
- **WHEN** 单次召唤发出既有控制事件
- **THEN** `workflowRef` MUST 可缺省
- **AND** 既有消费者 MUST 继续正确收窄和处理该事件

### Requirement: Main 校验所有工作流与资产输入关联

来自 Renderer 的 workflow kind、workflow/stage/issue id、asset id/base version、字段操作、版本号、动作和恢复关联 MUST 被视为不可信输入。Main MUST 验证项目归属、当前版本、允许转换、资产/问题归属、锚点与活动 run；非法命令 MUST 以强类型失败事件拒绝，MUST NOT 抛出未捕获异常或部分写入。

#### Scenario: 伪造问题归属被拒绝
- **WHEN** 修复命令中的 `issueId` 不属于给定 `workflowId`
- **THEN** Main MUST 拒绝命令并保持正文、checkpoint 与工作流状态不变

#### Scenario: 过期资产基线被拒绝
- **WHEN** 资产确认命令中的 base version 不是目标资产最新版本
- **THEN** Main MUST 拒绝盲目覆盖并返回最新资产摘要
- **AND** Story Bible 与资产版本 MUST 保持不变

### Requirement: 工作流事件提交后发布且可重新查询

Main MUST 在 SQLite 事务成功提交后发布工作流更新事件。若 Renderer 丢失事件或应用重启，MUST 能通过查询命令获取持久化最新快照；Renderer MUST NOT 依赖重放本地临时事件重建长期工作流。

#### Scenario: 重连后获取最新状态
- **WHEN** Renderer 重载并请求当前项目活动工作流
- **THEN** Main MUST 从持久化层返回最新工作流快照
- **AND** 快照 MUST 包含此前阶段、run 关联摘要与问题生命周期状态
