## ADDED Requirements

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
