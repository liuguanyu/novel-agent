# orchestration-graph Specification

## Purpose
TBD - created by archiving change agent-orchestration. Update Purpose after archive.
## Requirements
### Requirement: supervisor 路由与专家节点
编排图 MUST 以 supervisor 为入口路由，将请求按当前动作/意图分发到专家节点（writer、reviewer、
fact-checker、scene-generator、plagiarism-checker、editor、style-editor、architect、character-generator、worldbuilding、
concept-generator、scene-outliner、researcher 等）。

#### Scenario: 按动作路由
- **WHEN** 图收到带 `currentAction`/意图的请求
- **THEN** supervisor MUST 依据该动作将执行路由到对应专家节点

#### Scenario: 专家节点可扩展
- **WHEN** 需要新增一类专家 agent
- **THEN** 系统 MUST 允许以新节点接入图，而不破坏既有节点

#### Scenario: 召唤命名的 agent 驱动路由
- **WHEN** 一次召唤命令携带 `agent`（如 `fact-checker`）且该 agent 有对应动作
- **THEN** 运行层 MUST 依据被召唤的 agent 推导出对应 `currentAction`（如 `fact-check`），使 supervisor 路由到该专家节点
- **AND** 当被召唤 agent 无专属动作时，MUST 回退到按 `mode` 推导（diagnose→review / mutate→write）
- **AND** MUST NOT 仅凭 `mode` 决定路由而忽略 `agent`

#### Scenario: fact-checker 为已落地专家节点
- **WHEN** 作者以 diagnose 模式召唤 `fact-checker` 对已有正文做事实/逻辑/世界一致性核查
- **THEN** 图 MUST 路由到已落地的 fact-checker 节点，该节点 MUST 产出统一 `ConsistencyIssue[]` 写入 activeBugs
- **AND** 存在需人工裁决的问题时 MUST 经 awaitDecision 条件性挂起，否则收敛 END
- **AND** fact-checker MUST NOT 直接改写正文（diagnose 只读诊断）

#### Scenario: scene-generator 为已落地写作类节点
- **WHEN** 作者以 mutate 模式召唤 `scene-generator` 生成某分场景正文
- **THEN** 图 MUST 路由到已落地的 scene-generator 节点，该节点 MUST 产出 currentDraft 并转入审校（reviewer）
- **AND** 审校产出可自动修的问题且循环未到上限时 MUST 能回到写作节点迭代修订
- **AND** 存在需人工裁决的问题时 MUST 经 awaitDecision 条件性挂起

#### Scenario: plagiarism-checker 为已落地审校类节点
- **WHEN** 作者以 diagnose 模式召唤 `plagiarism-checker` 对已有正文做原创性/雷同风险核查
- **THEN** 图 MUST 路由到已落地的 plagiarism-checker 节点，该节点 MUST 产出统一 `ConsistencyIssue[]` 写入 activeBugs
- **AND** 存在需人工裁决的问题时 MUST 经 awaitDecision 条件性挂起，否则收敛 END
- **AND** plagiarism-checker MUST NOT 直接改写正文（diagnose 只读诊断）

#### Scenario: editor 为已落地重构类节点
- **WHEN** 作者召唤 `editor`（动作 `edit`）对某待修片段做结构/连贯/节奏/情节/人物一致性的编辑
- **THEN** 图 MUST 路由到已落地的 editor 节点，该节点 MUST 组装片段级只读上下文并产出对该片段的改写建议，作为对话消息呈现给作者
- **AND** editor MUST NOT 直接整章/整节点覆盖原文——正文写回 MUST 经局部 diff + 逐 hunk 接受（该 diff/hunk 落库通道由 I6 提供，本阶段仅呈现改写建议）
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: style-editor 为已落地重构类节点
- **WHEN** 作者召唤 `style-editor`（动作 `restyle`）对某待修片段做句式/遣词/语气/节奏的文风打磨
- **THEN** 图 MUST 路由到已落地的 style-editor 节点，该节点 MUST 在保留作者叙事与情节的前提下产出对该片段的文风改写建议，作为对话消息呈现给作者
- **AND** style-editor MUST NOT 直接整章/整节点覆盖原文——正文写回 MUST 经局部 diff + 逐 hunk 接受（同 editor，落库通道由 I6 提供）
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: architect 为已落地策划类节点
- **WHEN** 作者召唤 `architect`（动作 `outline`）产出章节/场景大纲、情节推进与人物成长里程碑
- **THEN** 图 MUST 路由到已落地的 architect 节点，该节点 MUST 产出中文自然语言策划文本，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 复用既有「抽取→ingest→写 story-bible」管线（`afterWriterDraft` 钩子）将策划产物落地为实体/属性/关系/伏笔/时间线：低风险不冲突者自动入库标 inferred，与既有 confirmed 冲突者标 conflicting 经手刹裁决
- **AND** 当锚点缺失（无 `currentChapterId`）时 MUST 降级为仅对话呈现、不入库
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: character-generator 为已落地策划类节点
- **WHEN** 作者召唤 `character-generator`（动作 `generate-characters`）产出人物档案（背景/动机/性格/关系/口吻）
- **THEN** 图 MUST 路由到已落地的 character-generator 节点，该节点 MUST 产出中文自然语言策划文本，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 复用既有「抽取→ingest→写 story-bible」管线（`afterWriterDraft` 钩子）将人物档案落地为实体/属性/关系；低风险不冲突者自动入库标 inferred，冲突者标 conflicting 经手刹裁决
- **AND** 当锚点缺失（无 `currentChapterId`）时 MUST 降级为仅对话呈现、不入库
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: worldbuilding 为已落地策划类节点
- **WHEN** 作者召唤 `worldbuilding`（动作 `build-world`）产出世界设定要素（地理/文化/历史/规则/组织）
- **THEN** 图 MUST 路由到已落地的 worldbuilding 节点，该节点 MUST 产出中文自然语言策划文本，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 复用既有「抽取→ingest→写 story-bible」管线（`afterWriterDraft` 钩子）将世界设定落地为实体/属性/关系；低风险不冲突者自动入库标 inferred，冲突者标 conflicting 经手刹裁决
- **AND** 当锚点缺失（无 `currentChapterId`）时 MUST 降级为仅对话呈现、不入库
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: concept-generator 为已落地策划类节点
- **WHEN** 作者召唤 `concept-generator`（动作 `generate-concept`）产出书籍立意（标题、一句话故事内核、主题、目标读者、独特卖点）
- **THEN** 图 MUST 路由到已落地的 concept-generator 节点，该节点 MUST 产出中文自然语言策划文本，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 复用既有「抽取→ingest→写 story-bible」管线（`afterWriterDraft` 钩子）落地可抽取的设定；低风险不冲突者自动入库标 inferred，冲突者标 conflicting 经手刹裁决
- **AND** 当锚点缺失（无 `currentChapterId`）时 MUST 降级为仅对话呈现、不入库
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: scene-outliner 为已落地策划类节点
- **WHEN** 作者召唤 `scene-outliner`（动作 `outline-scenes`）在章内产分场大纲（场景目的/关键事件与冲突/人物互动/情绪节拍/场景与氛围/过场）
- **THEN** 图 MUST 路由到已落地的 scene-outliner 节点，该节点 MUST 产出中文自然语言策划文本，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 复用既有「抽取→ingest→写 story-bible」管线（`afterWriterDraft` 钩子）落地可抽取的设定；低风险不冲突者自动入库标 inferred，冲突者标 conflicting 经手刹裁决
- **AND** 当锚点缺失（无 `currentChapterId`）时 MUST 降级为仅对话呈现、不入库
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: researcher 为已落地策划类节点
- **WHEN** 作者召唤 `researcher`（动作 `research`）为题材做背景资料研究（关键史实/技术细节/可用角度）
- **THEN** 图 MUST 路由到已落地的 researcher 节点，该节点 MUST 产出中文自然语言研究札记，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 复用既有「抽取→ingest→写 story-bible」管线（`afterWriterDraft` 钩子）落地可抽取的设定；低风险不冲突者自动入库标 inferred，冲突者标 conflicting 经手刹裁决
- **AND** 当锚点缺失（无 `currentChapterId`）时 MUST 降级为仅对话呈现、不入库
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

### Requirement: 条件路由与循环
编排图 MUST 支持条件路由与循环，以表达“写→审→改→再审”等迭代环路。

#### Scenario: 写-审-改循环
- **WHEN** 审稿产出需要修改的问题且流程要求迭代
- **THEN** 图 MUST 能从修改节点回到审稿节点形成循环
- **AND** 循环 MUST 可在满足条件或人工介入时终止

### Requirement: 单一有状态图
召唤等操作 MUST 通过改变同一张有状态图的下一跳路由实现，MUST NOT 为每次操作新建无状态单发图。

#### Scenario: 召唤复用有状态图
- **WHEN** 上层（on-demand-summon）请求调用某个 agent
- **THEN** 系统 MUST 向同一张持久化图注入命令以改变路由
- **AND** MUST NOT 新建脱离共享状态与 checkpointer 的一次性图

### Requirement: 编排进程归属
图与 agent 执行 MUST 位于 Main 进程或 utilityProcess，绝不在 Renderer。

#### Scenario: 编排不在 Renderer
- **WHEN** 运行编排图或任意节点
- **THEN** 其执行 MUST 位于 Main 或 utilityProcess

### Requirement: 编排图运行时落地
`orchestration-graph` 的契约 MUST 在本波以 LangGraph 落地为 Main 侧运行时：单一有状态图、supervisor 路由、写-审-改条件循环真跑通，并以 Main 侧 SQLite checkpointer 在节点边界持久化。

#### Scenario: 契约推进为运行时
- **WHEN** 应用运行一次编排
- **THEN** 既有 orchestration-graph 契约（supervisor 路由 / 条件循环 / 单一有状态图 / 进程归属）MUST 由实际 LangGraph 运行时满足
- **AND** MUST NOT 仅停留在类型契约层

