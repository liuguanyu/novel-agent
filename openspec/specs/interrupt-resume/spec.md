# interrupt-resume Specification

## Purpose
TBD - created by archiving change human-in-the-loop. Update Purpose after archive.
## Requirements
### Requirement: 条件性动态中断
系统 MUST 支持在节点内以条件性方式中断（interrupt），仅在需要作者介入时挂起，并把强类型 payload
推给作者。

#### Scenario: 有问题才挂起
- **WHEN** 审稿节点发现需作者裁决的问题
- **THEN** 系统 MUST 在该点挂起，并将结构化报告（如 activeBugs）作为 payload 推送给作者
- **AND** 若无需介入 MUST 不挂起，继续运行

#### Scenario: payload 强类型
- **WHEN** 一次中断向作者推送数据
- **THEN** 该 payload MUST 为强类型结构（如审稿报告或重构方案），不使用 any

### Requirement: 带决策数据的恢复
系统 MUST 支持作者以决策数据恢复运行，支持批准、驳回、修改三类决策，恢复后从挂起点继续。

#### Scenario: 修改后恢复
- **WHEN** 作者修改了挂起时的 activeBugs（如删除误报、仅保留部分问题）并请求继续
- **THEN** 系统 MUST 以修改后的数据覆写状态并从挂起点继续
- **AND** MUST NOT 重跑已完成的节点

#### Scenario: 批准或驳回
- **WHEN** 作者批准或驳回挂起点的产出
- **THEN** 系统 MUST 据此放行或终止/改道后续流程

### Requirement: 经 control-event 通道
中断通知与恢复命令 MUST 经 ipc-contract 的 control-event 通道传递，携带 runId。

#### Scenario: 通道与关联正确
- **WHEN** 发生中断或恢复
- **THEN** 相关消息 MUST 经 control-event 通道传递并携带对应 runId

### Requirement: 中断/恢复运行时落地
`interrupt-resume` 契约 MUST 在本波落地为真运行时：审校/连续性节点在需作者裁决时条件性中断（无需介入不挂起），经 control-event 通道推强类型 payload；作者以 approve/reject/modify 恢复，modify 覆写状态后从挂起点继续，MUST NOT 重跑已完成节点。

#### Scenario: 条件挂起真跑通
- **WHEN** 审校节点发现需作者裁决的问题
- **THEN** 运行时 MUST 在该点挂起并经 control-event 推送强类型报告（携 runId）
- **AND** 无需介入时 MUST 不挂起、继续运行

#### Scenario: modify 恢复不重跑
- **WHEN** 作者修改 activeBugs 后请求继续（resume-run）
- **THEN** 运行时 MUST 以修改后数据覆写状态并从挂起点继续
- **AND** MUST NOT 重跑已完成节点

### Requirement: 工作流中断携带阶段关联与 continuation

属于长期工作流的中断记录和 `interrupt-raised` payload MUST 携带 `workflowId`、`stageId`、可选 `issueId`、`sourceNode`、`continuationKind` 与允许的 decision kinds。Main MUST 持久化该关联，并在恢复前验证命令中的工作流、阶段、run 和中断记录一致。

#### Scenario: 阶段中断可解释
- **WHEN** 老书问题修复因锚点失效挂起
- **THEN** 中断 payload MUST 指明所属 workflow、issue 修复阶段、阻塞原因和允许动作
- **AND** Renderer MUST 能据此显示恢复后预期去向

#### Scenario: 错误阶段恢复被拒绝
- **WHEN** Renderer 提交的 `resume-run` 使用不匹配的 `workflowId` 或 `stageId`
- **THEN** Main MUST 以强类型错误拒绝
- **AND** MUST NOT 恢复目标 LangGraph run 或推进工作流

### Requirement: 恢复结果同步更新运行与业务阶段

恢复执行时，Main MUST 先校验 decision，再通过 continuation resolver 决定运行/阶段去向，并以幂等方式更新工作流状态。恢复不得重跑已完成节点；工作流阶段也不得因重复恢复命令推进两次。

#### Scenario: 重复恢复幂等
- **WHEN** 同一恢复命令因重试被提交两次
- **THEN** Main MUST 只应用一次有效状态转换
- **AND** MUST 返回当前快照或已处理结果，而非重复创建 stage/run 关联

#### Scenario: standalone 中断保持兼容
- **WHEN** 被恢复的 run 不属于长期工作流
- **THEN** 系统 MUST 继续支持既有仅携 `runId` 的 interrupt/resume
- **AND** MUST NOT 要求不存在的 workflow 字段

