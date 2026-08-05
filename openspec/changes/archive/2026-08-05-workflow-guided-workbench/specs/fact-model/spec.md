## MODIFIED Requirements

### Requirement: 出处锚点与置信度

每条事实 MUST 记录一个或多个来源，每个来源 MUST 为可判别联合：正文来源包含章/场景稳定标识符、文本片段与置信度；作者确认的创作资产来源包含稳定 `assetId`、asset version、字段路径、作者澄清或确认摘要与置信度。系统 MUST 能区分“正文中已发生的事实”和“作者确认的约束设定”，并 MUST NOT 将未确认的大纲计划无条件提升为 confirmed 事实。

#### Scenario: 事实可溯源
- **WHEN** 一条事实从正文中抽取并写入事实库
- **THEN** 其 MUST 至少记录一个正文来源，含 story-workspace 的稳定标识符、引文片段与置信度

#### Scenario: 作者设定可溯源到创作资产
- **WHEN** 作者确认人物或世界观资产中的可约束字段并同步到 Story Bible
- **THEN** 对应事实 MUST 记录创作资产来源，包含 `assetId`、asset version 与字段路径
- **AND** MUST 能追溯到作者原始澄清或确认

#### Scenario: 锚点随正文编辑保持有效
- **WHEN** 正文来源所在章节被编辑
- **THEN** 该事实的章/场景级锚点 MUST 保持有效（复用稳定标识符），引文片段用于人工核对

#### Scenario: 资产新版本不抹除旧来源
- **WHEN** 作者澄清导致创作资产生成新版本并更新约束事实
- **THEN** 新事实版本 MUST 指向新 asset version
- **AND** 历史事实来源 MUST 保留旧 asset version 以供审计
