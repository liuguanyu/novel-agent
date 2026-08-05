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
- **AND** 该节点 MUST 只产生待审阅的 change-set candidate，不得直接写入 CreativeAsset 或 Story Bible
- **AND** 作者确认后 Main MUST 提交对应版本化 CreativeAsset；适用的 confirmed 约束再同步 Story Bible
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: character-generator 为已落地策划类节点
- **WHEN** 作者召唤 `character-generator`（动作 `generate-characters`）产出人物档案（背景/动机/性格/关系/口吻）
- **THEN** 图 MUST 路由到已落地的 character-generator 节点，该节点 MUST 产出中文自然语言策划文本，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 只产生待审阅的 change-set candidate，不得直接写入 CreativeAsset 或 Story Bible
- **AND** 作者确认后 Main MUST 提交 character asset；适用的 confirmed 约束再同步 Story Bible
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: worldbuilding 为已落地策划类节点
- **WHEN** 作者召唤 `worldbuilding`（动作 `build-world`）产出世界设定要素（地理/文化/历史/规则/组织）
- **THEN** 图 MUST 路由到已落地的 worldbuilding 节点，该节点 MUST 产出中文自然语言策划文本，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 只产生待审阅的 worldbuilding change-set candidate，不得直接 ingest 或写入 CreativeAsset / Story Bible
- **AND** 仅在作者确认 candidate 后，Main 才 MUST 提交版本化 worldbuilding asset，并将适用的 confirmed 约束同步到 Story Bible
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: concept-generator 为已落地策划类节点
- **WHEN** 作者召唤 `concept-generator`（动作 `generate-concept`）产出书籍立意（标题、一句话故事内核、主题、目标读者、独特卖点）
- **THEN** 图 MUST 路由到已落地的 concept-generator 节点，该节点 MUST 产出中文自然语言策划文本，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 只产生待审阅的 concept change-set candidate，不得直接 ingest 或写入 CreativeAsset / Story Bible
- **AND** 仅在作者确认 candidate 后，Main 才 MUST 提交版本化 concept asset；不得把未确认候选同步到 Story Bible
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: scene-outliner 为已落地策划类节点
- **WHEN** 作者召唤 `scene-outliner`（动作 `outline-scenes`）在章内产分场大纲（场景目的/关键事件与冲突/人物互动/情绪节拍/场景与氛围/过场）
- **THEN** 图 MUST 路由到已落地的 scene-outliner 节点，该节点 MUST 产出中文自然语言策划文本，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 只产生待审阅的 scene-outline change-set candidate，不得直接 ingest 或写入 CreativeAsset / Story Bible
- **AND** 仅在作者确认 candidate 后，Main 才 MUST 提交版本化 scene-outline asset；计划性内容 MUST NOT 自动写成 Story Bible 事实
- **AND** 完成后 MUST 收敛 END，MUST NOT 进入写-审-改环

#### Scenario: researcher 为已落地策划类节点
- **WHEN** 作者召唤 `researcher`（动作 `research`）为题材做背景资料研究（关键史实/技术细节/可用角度）
- **THEN** 图 MUST 路由到已落地的 researcher 节点，该节点 MUST 产出中文自然语言研究札记，写入 currentDraft 并作为对话消息呈现给作者
- **AND** 该节点 MUST 持久化为可寻址的 research artifact（含来源与版本），但 MUST NOT 写入 CreativeAsset、Story Bible 或 CreativeAsset change set
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

### Requirement: 专家运行按工作流阶段归属与约束

当运行携带 `workflowRef` 时，Main MUST 在启动 LangGraph 前校验目标专家/动作是否为当前模板阶段所允许，并在运行开始、完成、失败或中断时向工作流服务记录强类型证据。阶段内的多次对话运行 MUST 追加关联，MUST NOT 因专家节点完成而擅自完成需作者验收的业务阶段。

#### Scenario: 人物设计师多轮迭代
- **WHEN** 当前阶段允许 character-generator 且作者提交普通补充或 `@人物设计师`
- **THEN** supervisor MUST 将该次运行路由到 character-generator
- **AND** run MUST 关联当前人物设计阶段
- **AND** 节点结束后阶段 MUST 等待作者确认而非自动进入 reviewer

#### Scenario: 跨阶段专家优先识别资产澄清
- **WHEN** 作者在正文写作等非人物设计阶段 `@人物设计师` 并明确澄清某个人物设定
- **THEN** Main MUST 提供目标 character asset 候选并将运行建模为 asset-maintenance activity
- **AND** MUST 保持主工作流当前阶段不变
- **AND** MUST NOT 静默把运行挂载为当前写作阶段的普通专家运行

#### Scenario: 非阶段非资产调用不静默改道
- **WHEN** 作者 `@` 的专家既不被当前阶段允许且消息也不能归属创作资产澄清
- **THEN** Main MUST 返回结构化冲突选择
- **AND** MUST NOT 静默将运行挂载到当前阶段或自动切换工作流阶段
- **AND** 作者仍可明确选择以 standalone 模式召唤

### Requirement: 策划专家产物经作者确认后写入对应创作资产

concept-generator、worldbuilding、character-generator、architect 与 scene-outliner MUST 先产生 change-set candidate；仅经作者确认后才可写入对应的 concept、worldbuilding、character、book/chapter outline 或 scene-outline asset。researcher MUST NOT 写入 CreativeAsset，仅可持久化 research artifact。项目级资产写入 MUST NOT 依赖 `currentChapterId`；可约束的 confirmed 人物/世界观字段 MUST 显式同步到 Story Bible，而计划性大纲内容 MUST 保持为资产。

#### Scenario: 无章节锚点的人物澄清持久化
- **WHEN** character-generator 在没有 `currentChapterId` 的项目上下文中完成作者确认的人物澄清
- **THEN** Main MUST 创建或更新 character asset
- **AND** MUST NOT 降级为仅对话呈现

#### Scenario: 大纲产物关联正确范围
- **WHEN** architect 产出全书大纲或特定章节规划
- **THEN** Main MUST 分别写入 project scope 的 book-outline 或 chapter scope 的 chapter-plan asset
- **AND** MUST 使用稳定 project/chapter id 和 asset version 作为阶段产物引用

### Requirement: 工作流恢复目标由 continuation 解析

中断恢复后的路由 MUST 根据持久化中断来源、`workflowRef`、模板阶段和 `continuationKind` 解析；MUST NOT 仅按 `approve` / `reject` / `correct` / `modify` decision kind 固定下一节点。解析结果 MUST 只能是模板允许的阶段内节点、下一业务阶段、保持挂起或终止。

#### Scenario: 人物设定修改返回人物阶段
- **WHEN** 人物设计阶段因事实冲突中断且作者选择 modify
- **THEN** 恢复 MUST 回到人物设计阶段允许的修订路径
- **AND** MUST NOT 固定路由到正文 writer

#### Scenario: 审校问题修改进入问题修复
- **WHEN** 老书总检问题的人工裁决选择修改正文
- **THEN** 恢复 MUST 激活该 issue 的局部修复阶段
- **AND** MUST NOT直接整章改写或跳过 hunk 裁决

### Requirement: 工作流层不改写真实节点追踪

接入业务阶段 MUST 继续使用现有 LangGraph 单一有状态图、checkpointer 与 `tasks + values` 逐节点事件。工作流模板阶段 MUST NOT 伪造成并未实际执行的 LangGraph 节点事件。

#### Scenario: 阶段计划与节点事件分离
- **WHEN** 工作流当前阶段是“人工修改/验收”且尚未启动专家运行
- **THEN** 工作台 MAY 显示该业务阶段等待作者
- **AND** 后端 MUST NOT 为该阶段发出虚假的 `graph-node-activated` 事件

