## MODIFIED Requirements

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
