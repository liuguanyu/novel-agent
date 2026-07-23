## ADDED Requirements

### Requirement: 实体模型
事实库 MUST 以类型化实体表示人物、地点、物品、组织等，每个实体具备稳定 id 与规范名，实体类型可扩展。

#### Scenario: 类型化实体
- **WHEN** 事实库中记录一个人物、地点、物品或组织
- **THEN** 该实体 MUST 具有实体类型、稳定唯一 id 与规范名
- **AND** 系统 MUST 允许在不破坏既有数据的前提下扩展实体类型

### Requirement: 属性与称呼别名
事实库 MUST 以隶属实体的属性记录键值事实（性格、能力、习惯、外貌、称呼别名等）；称呼别名 MUST 以
合法称呼集合的形式维护。

#### Scenario: 记录实体属性
- **WHEN** 从正文获知某实体的属性（如“左撇子”“沉默寡言”）
- **THEN** 该属性 MUST 作为隶属该实体的键值事实存储

#### Scenario: 称呼别名集合
- **WHEN** 某人物存在多个合法称呼（如“顾长风”“顾兄弟”“姑爷”）
- **THEN** 事实库 MUST 将其维护为该实体的合法称呼集合
- **AND** 该集合 MUST 可供一致性检查判定“集合外称呼”是否为疑似未声明符号

### Requirement: 时间线
事实库 MUST 维护单向自增的故事内时序，事件可挂接到时序点，用于时序矛盾检查。

#### Scenario: 事件挂接时序
- **WHEN** 正文中发生一个可定位于故事时间的事件（如“受枪伤”“过去七天”）
- **THEN** 该事件 MUST 可挂接到时间线上的时序点

#### Scenario: 支持时序矛盾判定
- **WHEN** 一致性检查需要判断行为与既有时序是否矛盾（如枪伤后立即健步如飞）
- **THEN** 时间线 MUST 提供足以判定先后与间隔的时序信息

### Requirement: 关系网
事实库 MUST 记录实体间关系，且关系可随剧情演变（带时序）。

#### Scenario: 记录并演变关系
- **WHEN** 两个实体之间存在关系（敌对、亲属、上下级等）且该关系随剧情变化
- **THEN** 事实库 MUST 能记录该关系及其随时序的变化

### Requirement: 伏笔状态机
事实库 MUST 以显式状态机跟踪伏笔：埋设 → 待回收 → 已回收，并支持作废状态。

#### Scenario: 伏笔状态流转
- **WHEN** 一个伏笔被埋设、等待回收、被回收或被作废
- **THEN** 事实库 MUST 以显式状态（planted/pending/paid_off/abandoned）记录其当前状态
- **AND** 该状态 MUST 可供检查“悬空伏笔”（长期 pending 未回收）

### Requirement: 出处锚点与置信度
每条事实 MUST 记录一个或多个来源，每个来源包含章/场景稳定标识符、文本片段与置信度。

#### Scenario: 事实可溯源
- **WHEN** 一条事实被写入事实库
- **THEN** 其 MUST 至少记录一个来源，含 story-workspace 的稳定标识符、引文片段与置信度

#### Scenario: 锚点随正文编辑保持有效
- **WHEN** 来源所在章节的正文被编辑
- **THEN** 该事实的章/场景级锚点 MUST 保持有效（复用稳定标识符），引文片段用于人工核对

### Requirement: 事实状态
每条事实 MUST 具有状态：confirmed（作者确认）、inferred（AI 推断）、conflicting（存在冲突），
且 confirmed 优先级高于 inferred。

#### Scenario: 状态优先级
- **WHEN** 一条 confirmed 事实与一条 inferred 事实发生冲突
- **THEN** 系统 MUST 以 confirmed 事实为更高权威
- **AND** 冲突项 MUST 被标记以供裁决
