## ADDED Requirements

### Requirement: 章节树结构
系统 MUST 以卷/章/场景层级组织正文，其中“章”为唯一必需层级，“卷”（章之上）与“场景”（章之下）
均为可选；正文以章为基本存储单元。

#### Scenario: 可选卷与可选场景
- **WHEN** 组织一本书的正文结构
- **THEN** 系统 MUST 支持可选的卷（Volume）→ 章（Chapter）→ 可选的场景（Scene）层级
- **AND** 不分卷的作品 MUST 可将章直接置于书的顶层，无需卷层级
- **AND** 未切分场景的章 MUST 可仅存在到章级

#### Scenario: 章是唯一必需层级
- **WHEN** 一本书仅由若干章构成，既不分卷也不切分场景
- **THEN** 系统 MUST 正常支持该结构，仅以章级组织正文

#### Scenario: 章为存储单元
- **WHEN** 存储或读取正文
- **THEN** 系统 MUST 以章为基本存储单元
- **AND** 场景 MUST 表示为章内的逻辑切分

### Requirement: 稳定唯一标识符
每个卷/章/场景节点 MUST 拥有稳定且唯一的标识符，该标识符与标题、顺序、正文内容解耦。

#### Scenario: 重命名不改标识
- **WHEN** 用户重命名某章的标题
- **THEN** 该章的标识符 MUST 保持不变

#### Scenario: 调整顺序不改标识
- **WHEN** 用户调整章节在树中的顺序或移动其所属卷
- **THEN** 相关节点的标识符 MUST 保持不变

#### Scenario: 编辑正文不改标识
- **WHEN** 用户或 agent 编辑某章/场景的正文
- **THEN** 该节点的标识符 MUST 保持不变

#### Scenario: 标识符可被外部引用
- **WHEN** bug 定位、事实出处锚点、diff 目标或 time-travel 需要引用某段正文位置
- **THEN** 其 MUST 能通过该稳定标识符长期引用同一节点

### Requirement: 章节草稿内容
系统 MUST 为每个章（及可选场景）维护其正文草稿内容，并可被读取与更新。

#### Scenario: 读写草稿
- **WHEN** 读取或更新某章的正文草稿
- **THEN** 系统 MUST 通过该章的稳定标识符定位其草稿内容
- **AND** 更新后内容 MUST 可被持久化
