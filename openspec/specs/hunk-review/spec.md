# hunk-review Specification

## Purpose
TBD - created by archiving change surgical-refactor. Update Purpose after archive.
## Requirements
### Requirement: 逐 hunk 接受/拒绝
系统 MUST 支持作者对每个 hunk 独立接受或拒绝，接受项精确拼回，未接受项原文不动。

#### Scenario: 独立裁决与精确拼回
- **WHEN** 作者对某个 hunk 选择接受
- **THEN** 系统 MUST 将该 hunk 的改写精确拼回其原位
- **AND** 未被接受的 hunk 对应的原文 MUST NOT 改动

#### Scenario: 拒绝不留痕
- **WHEN** 作者拒绝某个 hunk
- **THEN** 该处原文 MUST 保持不变，MUST NOT 引入任何改写

### Requirement: 绝不整章覆盖
系统 MUST NOT 提供整章或整节点一键覆盖原文的写入路径。

#### Scenario: 无整章覆盖路径
- **WHEN** 执行任何重构写入
- **THEN** 写入 MUST 仅经逐 hunk 接受实现
- **AND** 系统 MUST NOT 提供整章/整节点覆盖原文的路径

### Requirement: 锚点稳定与偏移修正
hunk 定位 MUST 基于稳定标识符；评审期文档被编辑时 MUST 修正偏移，无法安全映射时 MUST 标记失效。

#### Scenario: 编辑后偏移修正
- **WHEN** 评审期间文档被编辑导致 hunk 位置变化
- **THEN** 系统 MUST 按 ProseMirror 位置映射修正 hunk 偏移
- **AND** 拼回 MUST NOT 发生错位

#### Scenario: 无法映射即失效
- **WHEN** 某 hunk 因文档变化无法安全映射到原位
- **THEN** 系统 MUST 将该 hunk 标记为失效并提示重新计算
- **AND** MUST NOT 盲目拼回

### Requirement: 变更可回滚
接受 hunk 产生的正文变更 MUST 作为可回滚步进入 checkpointer 与事实版本。

#### Scenario: 接受即可回滚
- **WHEN** 作者接受一个或多个 hunk 并产生正文变更
- **THEN** 该变更 MUST 作为可回滚步进入 checkpointer/事实版本
- **AND** MUST 可经 human-in-the-loop 的 time-travel 回退或分叉

