## ADDED Requirements

### Requirement: 即时中断当前运行
系统 MUST 支持经 AbortSignal 立即停止当前流式生成并断开与 provider 的连接以节省 token。

#### Scenario: 作者拉手刹
- **WHEN** 作者在生成过程中请求停止
- **THEN** 系统 MUST 经 AbortSignal 中止当前模型请求
- **AND** SHOULD 尽快断开与 provider 的连接

### Requirement: 未提交步天然丢弃
被 abort 的当前节点产出 MUST NOT 进入状态；最近 checkpoint MUST 保持为节点开始前的干净态。

#### Scenario: 干净态保证
- **WHEN** 一次运行在某节点流式生成中途被 abort
- **THEN** 该节点的半成品 MUST NOT 被提交进共享状态
- **AND** 最近 checkpoint MUST 表示该节点开始前的干净态，无需显式回滚

### Requirement: abort 针对特定运行
abort MUST 针对特定 runId，不影响其他并发运行。

#### Scenario: 不误伤并发运行
- **WHEN** 存在多个并发运行且作者 abort 其中之一
- **THEN** 系统 MUST 仅中止对应 runId 的运行
- **AND** 其他运行 MUST NOT 受影响
