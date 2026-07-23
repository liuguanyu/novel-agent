## ADDED Requirements

### Requirement: 最小差异与 hunk 拆分
系统 MUST 对原片段与 agent 改写计算最小差异，并拆分为可独立接受/拒绝的 hunk。

#### Scenario: 拆分为可独立裁决的 hunk
- **WHEN** 重构 agent 返回一段对片段的改写
- **THEN** 系统 MUST 计算原片段与改写的最小差异并拆分为 hunk
- **AND** 每个 hunk MUST 可被独立接受或拒绝

#### Scenario: hunk 携带完整信息
- **WHEN** 产出一个 hunk
- **THEN** 该 hunk MUST 携带锚点（稳定标识符 + 偏移）、原文、改写文本
- **AND** hunk 结构 MUST 强类型，MUST NOT 使用 any

#### Scenario: 差异仅在片段范围内
- **WHEN** 计算差异
- **THEN** 系统 MUST 仅在待修片段范围内产生 hunk
- **AND** 越出片段边界的内容 MUST NOT 产生 hunk

### Requirement: diff 计算在 utilityProcess
diff 计算属 CPU 密集，MUST 在 utilityProcess/worker 执行。

#### Scenario: 计算不阻塞 UI
- **WHEN** 执行 diff 计算
- **THEN** 该计算 MUST 在 utilityProcess/worker 执行
- **AND** 主进程事件循环与 UI/IPC MUST NOT 被阻塞
