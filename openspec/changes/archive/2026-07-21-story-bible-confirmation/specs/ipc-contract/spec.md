## MODIFIED Requirements

### Requirement: IPC 三通道正交
系统 MUST 提供三条正交的 IPC 通道：正文流（manuscript-stream）、对话流（dialogue-stream）、控制事件（control-event）；三者职责不重叠。事实抽取的进度、完成、失败与冲突裁决事件 MUST 走控制事件通道。全书总检的 started/progress/completed/failed 事件 MUST 走控制事件通道。Story Bible 事实确认的完成/失败事件 MUST 走控制事件通道。

#### Scenario: 控制事件独立通道
- **WHEN** 发生挂起（interrupt）、恢复（resume）、中断（abort）、状态变更、事实抽取进度或错误、全书总检进度或错误、Story Bible 确认完成或错误
- **THEN** 该事件 MUST 经 control-event 通道传递，与内容流分离

#### Scenario: Story Bible 确认事件强类型
- **WHEN** 后端完成或拒绝一次 Story Bible 事实确认
- **THEN** 后端 MUST 经 control-event 下发带 runId 的强类型事件
- **AND** 成功事件 MUST 包含目标 fact、最新 factVersion 与状态
- **AND** 失败事件 MUST 包含结构化 category/message

### Requirement: 强类型消息与运行关联
系统 MUST 将所有 IPC 消息定义为以 `type` 字段判别的 discriminated union，并携带 `runId` 关联同一次运行。

#### Scenario: Story Bible 确认命令可判别
- **WHEN** Renderer 请求确认 Story Bible 中某条事实
- **THEN** 前端 MUST 发送 `confirm-story-bible-fact` 命令并携带 runId 与目标 fact locator
- **AND** 后端 MUST 通过判别联合收窄命令类型，无需使用 any
