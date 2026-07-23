# checkpointer Specification

## Purpose
TBD - created by archiving change agent-orchestration. Update Purpose after archive.
## Requirements
### Requirement: 节点边界持久化
系统 MUST 使用 Main 侧 SQLite checkpointer 在每个节点边界（super-step）持久化图状态。

#### Scenario: 节点边界提交
- **WHEN** 一个节点执行完成
- **THEN** 系统 MUST 在该节点边界持久化当前图状态为一个 checkpoint
- **AND** checkpoint MUST 写入 SQLite 表，包含 id、parent、atNode、state、createdAt

#### Scenario: 中途未提交
- **WHEN** 某节点执行中途被中止（如流式生成被 abort）
- **THEN** 该节点的产出 MUST NOT 被提交为 checkpoint
- **AND** 最近的 checkpoint MUST 仍表示该节点开始前的干净态

### Requirement: 可查询的 checkpoint 标识
每个 checkpoint MUST 产出可查询的标识，供 time-travel 与事实版本对齐使用。

#### Scenario: checkpoint 可被引用
- **WHEN** 一个 checkpoint 被创建
- **THEN** 其 MUST 拥有可查询、可引用的标识
- **AND** human-in-the-loop 与 story-bible MUST 能通过该标识引用同一时刻状态

#### Scenario: 历史链查询
- **WHEN** 系统以某 checkpoint id 请求历史链
- **THEN** checkpointer MUST 沿 parent 链返回可查询的 checkpoint 列表

### Requirement: checkpointer 进程归属
checkpointer 的 SQLite 读写 MUST 作为异步 I/O 在 Main 进程以非阻塞方式进行。

#### Scenario: 持久化不阻塞
- **WHEN** checkpoint 被写入或读取
- **THEN** 该 I/O MUST 以非阻塞方式进行，不得同步占用事件循环

