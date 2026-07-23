# fragment-scoping Specification

## Purpose
TBD - created by archiving change surgical-refactor. Update Purpose after archive.
## Requirements
### Requirement: 只喂待修片段
系统 MUST 只将待修片段、作者指令与必要只读上下文交给重构 agent，MUST NOT 将片段之外无需修改的周边正文
交给它。

#### Scenario: 隔离好的部分
- **WHEN** 发起一次局部重构
- **THEN** 系统 MUST 从选区或指定节点范围裁出待修片段，仅将该片段 + 指令 + 相关事实（只读）交给重构 agent
- **AND** MUST NOT 把片段之外“写得好、无需改”的正文交给重构 agent

#### Scenario: 记录片段锚点
- **WHEN** 裁出一个待修片段
- **THEN** 系统 MUST 记录该片段的稳定标识符锚点与在正文内的位置偏移
- **AND** 该锚点 MUST 用于后续 diff 与拼回定位

### Requirement: 片段上下文强类型
交给重构 agent 的片段与上下文 MUST 为强类型结构。

#### Scenario: 禁用 any
- **WHEN** 构造重构输入
- **THEN** 片段、指令与只读上下文 MUST 具备精确类型定义
- **AND** MUST NOT 使用 any

