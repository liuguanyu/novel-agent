## MODIFIED Requirements

### Requirement: 从正文增量抽取候选事实
系统 MUST 支持在 Main（或 utilityProcess）从一段新产出或新导入的正文（含其章/场景稳定标识符）抽取候选事实，输出含建议锚点、原文引文与置信度的强类型候选集合。

#### Scenario: 抽取候选事实
- **WHEN** 一段带章/场景标识符的正文被提交抽取
- **THEN** 系统 MUST 调用事实抽取运行时产出候选事实集合
- **AND** 每项 MUST 含建议的实体/属性/时序/关系/伏笔信息、来源锚点、原文引文与置信度
- **AND** 抽取执行 MUST 位于 Main 或 utilityProcess，Renderer MUST NOT 直接调用 LLM、读文件或写事实库

#### Scenario: 抽取输入输出契约稳定
- **WHEN** 抽取由某模型驱动
- **THEN** 抽取的输入（正文+标识符）与输出（候选事实结构）MUST 遵循稳定契约
- **AND** 原始模型输出 MUST 经 schema 校验转强类型后方可作为候选事实
- **AND** 单个候选无效时 MUST item-level 丢弃或标记，不得导致整批已校验候选全部丢失

#### Scenario: 防守解析模型输出
- **WHEN** 模型输出 fenced JSON、半截 JSON 或个别字段漂移
- **THEN** 系统 SHOULD 尽力抢救完整候选 item 并记录解析诊断
- **AND** MUST NOT 将未闭合 JSON 片段、说明文字或 suggestedFix 等字段值误当作候选事实
- **AND** 解析失败 MUST 作为结构化失败/诊断返回，MUST NOT 以未捕获异常穿透 IPC

### Requirement: 自动入库与冲突挂起
抽取所得事实 MUST 按风险分级处理：低风险且不冲突者自动入库标 inferred；与既有事实冲突者标 conflicting 并挂起人工确认；confirmed 事实 MUST NOT 被自动覆盖。

#### Scenario: 低风险自动入库
- **WHEN** 抽取出一条新出现且不与既有事实冲突的低风险事实（如首次出现的人名）
- **THEN** 系统 MUST 自动将其入库并标记为 inferred
- **AND** 写入 MUST 记录 provenance 与 fact version

#### Scenario: 冲突挂起确认
- **WHEN** 抽取出的事实与既有事实（尤其 confirmed）冲突
- **THEN** 系统 MUST 将其标记为 conflicting 并挂起，交作者裁决
- **AND** MUST NOT 静默覆盖既有事实
- **AND** 下发给作者的冲突 MUST 含新事实与既有事实的来源证据及可选决策项

#### Scenario: 作者裁决后入库
- **WHEN** 作者对抽取冲突做出接受新事实、保留旧事实、手工修改或忽略候选的裁决
- **THEN** 系统 MUST 按裁决更新事实库或跳过候选
- **AND** MUST 记录该裁决对应的 fact version / provenance

### Requirement: 抽取幂等友好
对同一来源重复抽取 MUST NOT 产生重复或相互矛盾的事实堆积。

#### Scenario: 重复抽取不堆积
- **WHEN** 同一章节被重复抽取（如再次编辑后重抽）
- **THEN** 系统 MUST 依据来源锚点、候选种类与稳定 identityKey 对候选事实去重或更新
- **AND** MUST NOT 因重复抽取而累积重复事实

#### Scenario: 幂等不掩盖真实变更
- **WHEN** 同一来源重抽后发现同一 identityKey 的事实值发生变化
- **THEN** 系统 MUST 将其作为更新或冲突处理
- **AND** 若既有事实为 confirmed 且新值不同，MUST 挂起人工裁决
