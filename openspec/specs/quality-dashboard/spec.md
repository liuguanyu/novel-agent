# quality-dashboard Specification

## Purpose
TBD - created by archiving change global-audit. Update Purpose after archive.
## Requirements
### Requirement: 复用统一一致性问题模型
总检产出的每个问题 MUST 复用 story-bible 的统一一致性问题结构，使局部与全局问题同构。

#### Scenario: 问题结构同构
- **WHEN** 总检产出一个问题
- **THEN** 该问题 MUST 复用统一结构（type、severity、anchors、description、requiresHumanDecision，
  可选 suggestedFix）
- **AND** MUST NOT 为总检另立一套不同的问题结构

#### Scenario: 需人工决策附选项
- **WHEN** 某问题 requiresHumanDecision 为 true
- **THEN** 系统 MUST 附带可选项供作者裁决
- **AND** MUST NOT 自行替作者选择

### Requirement: 健康度评分与红黄牌
系统 MUST 产出全局故事健康度评分与按严重度分级的问题列表。

#### Scenario: 评分与分级列表
- **WHEN** 总检完成
- **THEN** 系统 MUST 给出全局健康度评分与按 severity 分级的问题列表（CRITICAL 红牌 / WARNING 黄牌 / 其他）
- **AND** 每条问题 MUST 含定位锚点

#### Scenario: 评分可解释
- **WHEN** 呈现健康度评分
- **THEN** 评分 MUST 可由问题数量与严重度加权解释，MUST NOT 是黑盒魔数
- **AND** 权重 MAY 可配置

#### Scenario: 仪表盘呈现最新结果
- **WHEN** 作者打开质量仪表盘
- **THEN** Renderer SHOULD 展示最近一次总检的运行状态、健康分、按严重度分组的问题列表和评分解释
- **AND** Renderer MUST NOT 直接访问 SQLite、LLM 或文件系统

#### Scenario: 事实变化后体检结果标记过期
- **WHEN** 一次总检已完成后，事实底座发生变化（事实抽取完成并携带新的 factVersion，或确认/编辑/删除某条事实、或合并实体落库）
- **THEN** Renderer SHOULD 将已完成的体检结果标记为过期（stale），并以非阻塞方式提示作者重新运行总检
- **AND** Renderer MUST NOT 因事实变化自动重跑 LLM 总检（避免昂贵的 map-reduce 被隐式触发）
- **AND** 当作者重新运行总检或新一次总检完成时，Renderer MUST 清除过期标记

### Requirement: 一键跳章与一键修复

系统 MUST 支持点击问题定位到冲突章节，并支持从问题发起受控修复流程。修复 MUST 使用稳定问题/章节锚点，生成实际局部改写，经过 diff 与逐 hunk 接受/拒绝后才可落盘；落盘 checkpoint MUST 与问题关联，随后 MUST 进行针对性复检。系统 MUST NOT 整章覆盖原文，也 MUST NOT 仅因落盘就关闭问题。

#### Scenario: 一键跳章
- **WHEN** 作者点击某条问题
- **THEN** 系统 MUST 经 story-workspace 稳定标识符定位到对应冲突章节
- **AND** 定位 MUST NOT 因重命名/移序/编辑而漂移

#### Scenario: 一键修复占位
- **WHEN** 作者对某个 open 问题请求修复
- **THEN** 系统 MUST 将问题纳入或关联老书修订工作流并定位原文
- **AND** MUST 通过 surgical-refactor 局部 diff 通道与逐 hunk 裁决落盘
- **AND** MUST NOT 整章覆盖原文

#### Scenario: 修改后针对性复检
- **WHEN** 问题修复 hunk 已落盘并生成 checkpoint
- **THEN** 系统 MUST 将问题置为 verifying 并提供针对性复检
- **AND** 只有复检证明问题消除后才能置为 resolved

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

