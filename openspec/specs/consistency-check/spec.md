# consistency-check Specification

## Purpose
TBD - created by archiving change story-bible. Update Purpose after archive.
## Requirements
### Requirement: 统一一致性问题模型
一致性检查 MUST 以统一结构输出问题，每个问题包含类型、严重度、锚点、描述、建议修复（可空）与是否
需人工决策。

#### Scenario: 问题结构完整
- **WHEN** 检查产出一个一致性问题
- **THEN** 该问题 MUST 含 `type`（命名/称呼冲突、时间线断层、行为 OOC、伏笔悬空、状态矛盾、空间走位、其他）
- **AND** MUST 含 `severity`、一个或多个稳定标识符 `anchors`、`description`、`requiresHumanDecision`
- **AND** MAY 含 `suggestedFix`

#### Scenario: 需人工决策附选项
- **WHEN** 一个问题的 `requiresHumanDecision` 为 true（如“改设定还是改旧文”）
- **THEN** 系统 MUST 附带可选项供作者裁决
- **AND** 系统 MUST NOT 自行替作者选择

### Requirement: 正向一致性检查
系统 MUST 支持“正向检查”：给定一段正文与事实库当前视图，对撞后输出结构化一致性问题。

#### Scenario: 检出集合外称呼
- **WHEN** 一段正文中出现某人物的合法称呼集合之外的称呼（如男主叫顾长风却出现“九爷”）
- **THEN** 正向检查 MUST 产出一个命名/称呼冲突问题，并锚定到该出现位置

#### Scenario: 检出时间线断层
- **WHEN** 一段正文的时序与既有时间线矛盾（如“七天”凭空跳过或枪伤后立即健步如飞）
- **THEN** 正向检查 MUST 产出一个时间线断层问题，并给出相关锚点

#### Scenario: 检出行为 OOC 与状态矛盾
- **WHEN** 角色行为与其既有性格/能力不符，或物品/信息持有者与既有状态矛盾
- **THEN** 正向检查 MUST 分别产出行为 OOC 或状态矛盾问题

### Requirement: 反向一致性检查（涟漪效应）
系统 MUST 支持“反向检查”：当某事实被新增或修改时，检索并比对所有引用相关实体/属性的已有章节，
报告被新事实破坏的旧描写。

#### Scenario: 改动设定触发全书扫描
- **WHEN** 某事实被变更（如将“顾长风惯用右手”改为“左撇子”）
- **THEN** 系统 MUST 检索所有引用该实体相关属性的已有章节并逐一比对

#### Scenario: 冲突报告含双锚点
- **WHEN** 反向检查发现某旧章节描写与新事实冲突
- **THEN** 产出的问题 MUST 同时给出“新事实来源”与“冲突旧文来源”两个锚点
- **AND** 该问题 MUST 标记 requiresHumanDecision 并附“改设定 / 改旧文”选项

#### Scenario: 大规模比对不阻塞 UI
- **WHEN** 反向检查涉及大规模检索或比对且属 CPU 密集
- **THEN** 该计算 MUST 在 utilityProcess/worker 执行
- **AND** 主进程事件循环与 UI/IPC MUST NOT 被阻塞

### Requirement: 悬空伏笔检查
系统 MUST 能基于伏笔状态机检出长期未回收（pending）的悬空伏笔。

#### Scenario: 检出悬空伏笔
- **WHEN** 某伏笔处于 pending 状态且在其后相当篇幅内未转为 paid_off
- **THEN** 系统 MUST 产出一个伏笔悬空问题，锚定到其埋设位置

