## MODIFIED Requirements

### Requirement: 一键跳章与一键修复

系统 MUST 支持点击问题定位到冲突章节，并支持从问题发起受控修复流程。修复 MUST 使用稳定问题/章节锚点，生成实际局部改写，经过 diff 与逐 hunk 接受/拒绝后才可落盘；落盘 checkpoint MUST 与问题关联，随后 MUST 进行针对性复检。系统 MUST NOT 整章覆盖原文，也 MUST NOT 仅因落盘就关闭问题。

#### Scenario: 一键跳章
- **WHEN** 作者点击某条问题
- **THEN** 系统 MUST 经 story-workspace 稳定标识符定位到对应冲突章节
- **AND** 定位 MUST NOT 因重命名/移序/编辑而漂移

#### Scenario: 从全书问题进入局部修复
- **WHEN** 作者对某个 open 问题请求修复
- **THEN** 系统 MUST 将问题纳入或关联老书修订工作流并定位原文
- **AND** MUST 通过 surgical-refactor 局部 diff 通道与逐 hunk 裁决落盘
- **AND** MUST NOT 整章覆盖原文

#### Scenario: 修改后针对性复检
- **WHEN** 问题修复 hunk 已落盘并生成 checkpoint
- **THEN** 系统 MUST 将问题置为 verifying 并提供针对性复检
- **AND** 只有复检证明问题消除后才能置为 resolved

## ADDED Requirements

### Requirement: 仪表盘按生命周期管理全书问题

质量仪表盘 MUST 展示工作流问题状态并区分未处理、修复中、待复检、已解决与已忽略；评分解释 MUST 明确 dismissed 是否计入及其规则。最终全书复检产生的新问题或复发问题 MUST 更新问题集合与工作流，而非覆盖历史修订证据。

#### Scenario: 修订队列可按状态筛选
- **WHEN** 作者打开老书修订工作流的质量仪表盘
- **THEN** 作者 MUST 能按 severity 与 lifecycle status 查看问题
- **AND** 每个问题 MUST 可追溯到来源总检和已有 checkpoint/复检记录

#### Scenario: 最终复检复发问题重新打开
- **WHEN** 最终全书复检再次发现此前 resolved 问题的等价冲突
- **THEN** 系统 MUST 将该问题重新置为 open 或 fixing 并记录复发审计 run
- **AND** MUST 保留此前 resolution 与 checkpoint 历史
