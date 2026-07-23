## ADDED Requirements

### Requirement: 召唤即向持久图注入命令
召唤 MUST 通过向 agent-orchestration 的持久化有状态图注入命令改变路由实现，复用共享状态与 checkpointer，
MUST NOT 新建一次性无状态图。

#### Scenario: 复用有状态图
- **WHEN** 一次召唤被执行
- **THEN** 系统 MUST 向持久化图注入命令以改变 `currentAction`/下一跳路由
- **AND** MUST NOT 新建脱离共享状态与 checkpointer 的一次性图

#### Scenario: 干完交还控制权
- **WHEN** 被召唤 agent 完成其工作
- **THEN** 系统 MUST 把控制权交还作者：只读诊断走到 END 返回；有写入的按 human-in-the-loop 挂起待裁决
- **AND** MUST NOT 自动继续后续自动流水线

### Requirement: diagnose 只读语义
`diagnose` 模式 MUST 只读，产出结构化诊断，MUST NOT 修改正文。

#### Scenario: 诊断不改正文
- **WHEN** 召唤以 `mode = diagnose` 执行
- **THEN** 系统 MUST 只产出诊断结果（复用 story-bible 一致性问题模型）
- **AND** MUST NOT 对正文产生任何写入

### Requirement: mutate 走局部 diff 语义
`mutate` 模式 MUST 经 surgical-refactor 的局部 diff 通道产出改写提案，逐 hunk 由作者接受/拒绝，
MUST NOT 整章覆盖。

#### Scenario: 写入必经局部 diff
- **WHEN** 召唤以 `mode = mutate` 执行
- **THEN** 系统 MUST 通过局部 diff 提案通道产出改写，逐 hunk 供作者接受/拒绝
- **AND** MUST NOT 整章或整节点覆盖原文

#### Scenario: mode 严格分流
- **WHEN** 后端接收一条召唤命令
- **THEN** 系统 MUST 依据显式声明的 `mode` 严格分流至只读或写入路径
- **AND** diagnose 路径 MUST NOT 具备正文写入能力
