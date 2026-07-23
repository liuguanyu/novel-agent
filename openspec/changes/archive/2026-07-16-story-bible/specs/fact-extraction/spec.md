## ADDED Requirements

### Requirement: 从正文增量抽取候选事实
系统 MUST 支持从一段新产出或新导入的正文（含其章/场景标识符）抽取候选事实，输出含建议锚点与置信度。

#### Scenario: 抽取候选事实
- **WHEN** 一段带章/场景标识符的正文被提交抽取
- **THEN** 系统 MUST 输出候选事实集合，每项含建议的实体/属性/时序/关系/伏笔信息、来源锚点与置信度

#### Scenario: 抽取输入输出契约稳定
- **WHEN** 抽取由某模型驱动
- **THEN** 抽取的输入（正文+标识符）与输出（候选事实结构）MUST 遵循稳定契约
- **AND** 原始模型输出 MUST 经 schema 校验转强类型后方可作为候选事实

### Requirement: 自动入库与冲突挂起
抽取所得事实 MUST 按风险分级处理：低风险且不冲突者自动入库标 inferred；与既有事实冲突者标 conflicting
并挂起人工确认。

#### Scenario: 低风险自动入库
- **WHEN** 抽取出一条新出现且不与既有事实冲突的低风险事实（如首次出现的人名）
- **THEN** 系统 MUST 自动将其入库并标记为 inferred

#### Scenario: 冲突挂起确认
- **WHEN** 抽取出的事实与既有事实（尤其 confirmed）冲突
- **THEN** 系统 MUST 将其标记为 conflicting 并挂起，交作者裁决
- **AND** MUST NOT 静默覆盖既有事实

### Requirement: 抽取幂等友好
对同一来源重复抽取 MUST NOT 产生重复或相互矛盾的事实堆积。

#### Scenario: 重复抽取不堆积
- **WHEN** 同一章节被重复抽取（如再次编辑后重抽）
- **THEN** 系统 MUST 依据来源锚点对候选事实去重或更新
- **AND** MUST NOT 因重复抽取而累积重复事实
