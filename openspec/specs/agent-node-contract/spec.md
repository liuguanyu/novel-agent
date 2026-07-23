# agent-node-contract Specification

## Purpose
TBD - created by archiving change agent-orchestration. Update Purpose after archive.
## Requirements
### Requirement: 节点单一职责
每个 agent 节点 MUST 仅负责：组装 prompt → 调用模型 → 解析并校验输出 → 写入共享状态；
MUST NOT 直接持久化、发送 IPC 或操作 UI。

#### Scenario: 节点职责边界
- **WHEN** 实现一个 agent 节点
- **THEN** 其行为 MUST 限于组 prompt、调模型、解析校验、写状态
- **AND** MUST NOT 直接执行持久化、IPC 或 UI 操作

### Requirement: 输出 schema 校验
节点的模型输出 MUST 经 schema 校验转强类型后方可写入共享状态。

#### Scenario: 结构化输出校验
- **WHEN** 节点期望模型返回结构化结果（如 activeBugs、事实、大纲）
- **THEN** 原始输出 MUST 先经 schema 校验
- **AND** 仅当校验通过后强类型结果方可写入状态；校验失败 MUST 走既定失败处理，不得写入 any

### Requirement: 一致性问题输出遵循统一模型
产出一致性问题的节点（审稿/事实核查）MUST 遵循 story-bible 的一致性问题模型契约。

#### Scenario: 审稿产出符合契约
- **WHEN** reviewer 或 fact-checker 节点产出问题
- **THEN** 每个问题 MUST 含 type/severity/anchors/description/requiresHumanDecision（suggestedFix 可空）
- **AND** 该结果 MUST 写入状态的 activeBugs

