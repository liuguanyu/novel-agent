## ADDED Requirements

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
