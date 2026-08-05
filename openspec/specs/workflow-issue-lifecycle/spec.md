# workflow-issue-lifecycle Specification

## Purpose
TBD - created by archiving change workflow-guided-workbench. Update Purpose after archive.
## Requirements
### Requirement: 工作流问题使用可审计生命周期

每个纳入工作流的问题 MUST 有稳定 `issueId` 与 `WorkflowIssueRecord`，至少包含 `workflowId`、`sourceAuditRunId`、`status`（`open` / `fixing` / `verifying` / `resolved` / `dismissed`，并支持 resolved 后 reopen 回 open）、`anchorRefs`、`refactorRunIds`、`checkpointIds`、`verificationRunIds` 及可选 `resolutionReason`。状态转换 MUST 受控，MUST NOT 用卡片是否显示或一次运行是否结束推断问题已解决。记录 discovery、audit、transition、resolution history；复发审计 MUST 支持 `resolved → open` reopen 并保留原解决证据。

#### Scenario: 选择问题进入修复
- **WHEN** 作者选择一个 open 问题开始修复
- **THEN** 问题 MUST 转为 fixing
- **AND** 当前问题修复阶段 MUST 使用该 `issueId` 作为 scope

#### Scenario: 落盘后等待复检
- **WHEN** 问题关联的 hunk 裁决成功落盘并生成 checkpoint
- **THEN** 问题 MUST 记录 checkpoint id 并转为 verifying
- **AND** MUST NOT 仅因正文已写入而转为 resolved

### Requirement: 问题只有通过针对性复检才能解决

`resolved` MUST 由针对该问题类型、锚点和受影响范围的结构化复检结果驱动。复检运行 MUST 关联 `verificationRunIds`；若问题仍存在或产生等价冲突，状态 MUST 从 verifying 返回 fixing。

#### Scenario: 复检证明问题消除
- **WHEN** 针对性复检明确报告目标问题已不存在且无等价阻塞问题
- **THEN** 问题 MUST 转为 resolved
- **AND** MUST 记录复检 run 与解决证据

#### Scenario: 复检仍失败
- **WHEN** 针对性复检再次发现目标问题
- **THEN** 问题 MUST 返回 fixing
- **AND** 工作流 MUST 引导生成新的局部改写方案而非关闭卡片

#### Scenario: 后续审计使已解决问题 reopen
- **WHEN** 后续章节审校或最终全书复检发现一个 `resolved` 问题复发或出现等价冲突
- **THEN** 同一 `WorkflowIssueRecord` MUST 从 resolved 转回 open，而不是创建无法关联历史的重复记录
- **AND** MUST 追加审计与 reopen transition 记录，并保留原 resolution evidence、checkpoint 和 verification run history

### Requirement: dismissed 表示作者有意不修复

作者 MAY 将 open、fixing 或 verifying 问题标记 dismissed，但 MUST 提供非空理由；dismissed MUST 与 resolved 区分，并保留来源审计、锚点和已有修订证据。系统 MUST NOT 将模型未复现问题自动视为 dismissed。

#### Scenario: 作者判定误报
- **WHEN** 作者明确选择忽略某问题并填写“伏笔，非矛盾”等理由
- **THEN** 问题 MUST 转为 dismissed 并记录理由与时间
- **AND** 质量仪表盘 MUST 能区分 dismissed 与 resolved

### Requirement: 修订证据与正文锚点保持关联

问题修复 MUST 关联原文稳定章节/节点锚点、实际改写运行、被接受 hunk、落盘 checkpoint 和复检运行。锚点缺失或无法唯一定位时 MUST 阻塞修复并要求重新定位，MUST NOT 猜测位置后写入。

#### Scenario: 锚点失效阻止改写
- **WHEN** 问题证据无法在其稳定章节范围内唯一定位
- **THEN** 问题修复阶段 MUST 转为 blocked
- **AND** MUST NOT 计算可应用 diff 或写入正文

