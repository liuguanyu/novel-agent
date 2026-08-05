## ADDED Requirements

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
