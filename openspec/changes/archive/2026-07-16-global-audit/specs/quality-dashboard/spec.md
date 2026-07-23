## ADDED Requirements

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

### Requirement: 一键跳章与一键修复
系统 MUST 支持点击问题定位到冲突章节，并支持一键修复走局部 diff 通道。

#### Scenario: 一键跳章
- **WHEN** 作者点击某条问题
- **THEN** 系统 MUST 经 story-workspace 稳定标识符定位到对应冲突章节
- **AND** 定位 MUST NOT 因重命名/移序/编辑而漂移

#### Scenario: 一键修复走局部 diff
- **WHEN** 作者对某问题请求一键修复
- **THEN** 修复 MUST 走 surgical-refactor 局部 diff 通道、逐 hunk 接受
- **AND** MUST NOT 整章覆盖原文
