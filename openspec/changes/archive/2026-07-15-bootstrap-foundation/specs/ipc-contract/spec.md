## ADDED Requirements

### Requirement: IPC 三通道正交
系统 MUST 提供三条正交的 IPC 通道：正文流（manuscript-stream）、对话流（dialogue-stream）、
控制事件（control-event）；三者职责不重叠。

#### Scenario: 正文与对话分离
- **WHEN** Writer 产生正文 token 同时某 agent 产生对话回复
- **THEN** 正文 token MUST 经 manuscript-stream 通道传递
- **AND** 对话内容 MUST 经 dialogue-stream 通道传递
- **AND** 两者 MUST NOT 混入同一通道

#### Scenario: 控制事件独立通道
- **WHEN** 发生挂起（interrupt）、恢复（resume）、中断（abort）、状态变更或错误
- **THEN** 该事件 MUST 经 control-event 通道传递，与内容流分离

### Requirement: 强类型消息与运行关联
系统 MUST 将所有 IPC 消息定义为以 `type` 字段判别的 discriminated union，并携带 `runId` 关联同一次运行。

#### Scenario: 并发运行不串台
- **WHEN** 存在多个并发运行（例如作者边写正文边在 Chat 中对话）
- **THEN** 每条消息 MUST 携带其所属运行的 `runId`
- **AND** 前端 MUST 能依据 `runId` 将消息路由到正确的运行上下文

#### Scenario: 消息类型可判别
- **WHEN** 接收方收到任意 IPC 消息
- **THEN** 该消息 MUST 含 `type` 判别字段
- **AND** 接收方 MUST 能通过 `type` 收窄到精确的负载类型，无需使用 `any`

### Requirement: 流式、中断与错误语义
系统 MUST 在 IPC 契约中支持流式传输、运行中断，并将错误作为一等消息类型传递。

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
