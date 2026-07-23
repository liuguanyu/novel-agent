## ADDED Requirements

### Requirement: 统一召唤命令协议
系统 MUST 定义入口无关的统一召唤命令，包含目标 agent、作用范围、锚点、执行模式与可选作者指令，且为强类型。

#### Scenario: 命令字段完整且强类型
- **WHEN** 任一入口发起一次召唤
- **THEN** 命令 MUST 含 `agent`、`scope`、`anchor`（可空）、`mode`（`diagnose` | `mutate`）
- **AND** MAY 含 `instruction`（作者自然语言）
- **AND** 命令 MUST 经 schema 校验为强类型，MUST NOT 使用 any

#### Scenario: 三入口产出同一种命令
- **WHEN** 划词气泡、Cmd+K 命令面板或侧边栏工具箱分别发起召唤
- **THEN** 三者产出的命令结构 MUST 完全一致
- **AND** 后端 MUST NOT 依赖命令来源入口进行分支

### Requirement: 作用范围 scope
召唤命令 MUST 支持分级作用范围，并复用 story-workspace 稳定标识符定位。

#### Scenario: scope 取值
- **WHEN** 构造一条召唤命令
- **THEN** `scope` MUST ∈ { `selection`, `node`, `document`, `project` }
- **AND** `project` MUST 仅对素材类 agent 有效

#### Scenario: 锚点复用稳定标识符
- **WHEN** scope 为 `selection` 或 `node`
- **THEN** `anchor` MUST 以 story-workspace 稳定标识符定位对应节点
- **AND** `selection` MUST 附加选区在正文内的位置偏移

### Requirement: 经 IPC 命令通道下发
召唤命令 MUST 经 ipc-contract 通道下发并携带 runId。

#### Scenario: 通道与关联正确
- **WHEN** 一条召唤命令被发起
- **THEN** 其 MUST 经 IPC 通道传递并携带 runId
- **AND** 诊断/提案/错误 MUST 作为一等消息回传
