# historical-fact-retrieval Specification

## Purpose
TBD - created by archiving change orchestration-runtime. Update Purpose after archive.
## Requirements
### Requirement: 历史事实结构化召回
系统 MUST 在对话/召唤中对作者指涉的历史事实与伏笔进行结构化召回：从事实库按实体名/别名、伏笔状态与描述、时间线等结构化查询命中，每条命中 MUST 携带其真实出处（provenance 的 NodeRef 章节锚点 + 引文），MUST NOT 依赖把整本正文塞进 prompt。

#### Scenario: 召回带真实出处
- **WHEN** 作者提及一个历史事实或伏笔（如"那个关于身世的伏笔"）
- **THEN** 系统 MUST 从事实库结构化召回匹配条目
- **AND** 每条命中 MUST 携带其真实 provenance（出处章节锚点 + 引文），供纠偏与核对

#### Scenario: 以引用进入上下文
- **WHEN** 召回结果需进入编排状态
- **THEN** 其 MUST 以引用（版本/作用域）进入 `contextRefs`
- **AND** MUST NOT 将整个事实库内容复制进状态或 prompt

### Requirement: 软锚点与硬锚点区分
系统 MUST 区分作者指涉历史的两种意图并采用不同检索语义：硬锚点（划词/点章产生的 `scope:node`/`scope:selection` 召唤）MUST 忠实照做、只限该锚点范围；软提示（对话自然语言提及的章号）MUST 按内容/语义召回，作者陈述的章号 MUST 仅作软排序提示、MUST NOT 作硬过滤。

#### Scenario: 硬锚点忠实照做
- **WHEN** 作者以划词或点章精确指定某节点（scope=node/selection）
- **THEN** 检索 MUST 只在该锚点范围内进行
- **AND** MUST NOT 自作主张扩散到其他章节

#### Scenario: 软提示不硬过滤章号
- **WHEN** 作者在对话中以自然语言提及章号（如"第 3 章那个伏笔"）
- **THEN** 检索 MUST 按内容/语义召回相关事实
- **AND** 作者陈述的章号 MUST 仅作软排序提示，MUST NOT 作为硬过滤条件排除其他章节的命中

### Requirement: 章号纠偏回路
当软召回命中的真实出处章节与作者陈述的章号不一致时，系统 MUST 产出确认/纠偏提示交作者裁决；候选 MAY 按接近度排序并标注"最接近"，但 MUST NOT 默认替作者勾选任一候选；在作者裁决前 MUST NOT 静默采用任一方。

#### Scenario: 记错章号时纠偏
- **WHEN** 作者称某伏笔在第 3 章，但召回命中的真实出处在第 6 章
- **THEN** 系统 MUST 产出纠偏提示，列出真实出处的候选交作者确认
- **AND** MUST NOT 静默按作者所述章号，也 MUST NOT 静默改用召回章节

#### Scenario: 候选排序不代替勾选
- **WHEN** 纠偏提示列出多个候选
- **THEN** 系统 MAY 按接近度排序并标注最接近项
- **AND** MUST NOT 默认选中任一候选——由作者裁决

### Requirement: 指令冲突硬阻断与知情放行
当作者指令与事实库既有事实冲突（如要求某角色"首次登场"但其已在前文登场）时，系统 MUST 硬阻断并要求作者裁决（不裁决不落笔）；同时 MUST 始终提供"知情放行"（照作者所述写、知悉会产生矛盾）的逃生选项。

#### Scenario: 冲突时硬阻断
- **WHEN** 作者指令与事实库既有事实冲突
- **THEN** 系统 MUST 硬阻断，在作者裁决前 MUST NOT 落笔写入
- **AND** MUST 向作者呈现冲突详情（冲突的既有事实及其出处）

#### Scenario: 知情放行逃生门
- **WHEN** 作者在知悉冲突后仍坚持
- **THEN** 系统 MUST 提供"知情放行"选项，一键按作者所述继续
- **AND** 作者拥有最终主权，放行后 MUST 继续执行

### Requirement: 纠偏与冲突裁决经手刹通道
纠偏/冲突提示 MUST 经 ipc-contract 的 control-event 通道推送 Renderer，并复用与中断/恢复一致的作者裁决回路，携带 runId。

#### Scenario: 裁决走统一通道
- **WHEN** 系统产出纠偏或冲突提示
- **THEN** 该提示 MUST 经 control-event 通道携带 runId 推送
- **AND** 作者裁决 MUST 经同一恢复回路回传

