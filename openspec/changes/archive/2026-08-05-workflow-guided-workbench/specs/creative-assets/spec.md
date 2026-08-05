## ADDED Requirements

### Requirement: 策划产物必须落为可寻址创作资产

系统 MUST 将立意定位、世界观、人物档案、全书大纲、章节规划与分场大纲持久化为可独立寻址和版本化的创作资产，MUST NOT 只保存在对话消息或一次运行的 `currentDraft` 中。每个 `CreativeAsset` MUST 至少包含稳定 `assetId`、`projectId`、`kind`（`concept` / `worldbuilding` / `character` / `book-outline` / `chapter-plan` / `scene-outline`）、适用 `scope`、结构化 `content`、`version`、`status`、`provenance`、`createdAt` 与 `updatedAt`；character 资产 MUST 能关联稳定 Story Bible entity id，chapter/scene 资产 MUST 使用稳定 manuscript id。

#### Scenario: 人物设计结果落到人物资产
- **WHEN** 人物设计阶段产出并经作者确认一名人物的背景、动机、性格、关系与口吻
- **THEN** Main MUST 创建或更新对应 character asset 的新版本
- **AND** 阶段 artifact ref MUST 指向该 `assetId` 与版本
- **AND** 该信息 MUST NOT 只存在于对话历史

#### Scenario: 无章节锚点的世界观仍可持久化
- **WHEN** 作者在项目范围澄清世界规则且没有 `currentChapterId`
- **THEN** 系统 MUST 将澄清落入 project scope 的 worldbuilding asset
- **AND** MUST NOT 因缺少章节锚点退化为仅对话呈现

### Requirement: 作者可在任意工作流阶段澄清既有资产

作者 MUST 能在任何 active、paused 或无长期工作流的上下文中发起资产澄清，并显式或通过候选消歧指定目标资产；该操作 MUST 作为横切的 asset-maintenance activity 执行，MUST NOT 强迫当前主工作流退回资产最初创建阶段。澄清运行 MUST 关联 `assetId`、base version、可选 `workflowId` / `stageId` 与 `runId`。

#### Scenario: 写作阶段澄清人物设定
- **WHEN** 当前正在正文写作阶段，作者输入“@人物设计师 林岚并不怕水，她怕的是封闭空间”并选中林岚人物资产
- **THEN** 该运行 MUST 归属一次人物资产澄清活动并保持主工作流当前写作阶段不变
- **AND** 结果 MUST 形成对林岚 character asset 的候选结构化变更
- **AND** 系统 MUST NOT 把该意见误投给审校或要求重新执行整个人物设计阶段

#### Scenario: 目标资产不明确时先消歧
- **WHEN** 作者的澄清可能对应多个同名人物或多个世界规则资产
- **THEN** 系统 MUST 要求作者选择目标资产或创建新资产
- **AND** MUST NOT 猜测后直接写入任意资产

### Requirement: 作者澄清经确认后产生资产新版本

AI 对澄清内容的解析 MUST 先形成可审阅的 `CreativeAssetChangeSet`，至少包含 `assetId`、`baseVersion`、字段级 operations、作者原始澄清、来源 run 与受影响摘要。只有作者明确确认后 Main 才能以增量方式提交新资产版本；版本冲突、删除关键约束或与 confirmed Story Bible 事实冲突时 MUST 阻塞并要求裁决。

#### Scenario: 澄清预览后确认写入
- **WHEN** AI 将作者澄清解析为“恐惧对象：水 → 封闭空间”的字段变更
- **THEN** 界面 MUST 在写入前展示目标人物和字段级变化
- **AND** 作者确认后 Main MUST 创建新版本并保留旧版本与来源

#### Scenario: 基线版本已变化
- **WHEN** 作者确认 change set 时目标资产版本已不同于 `baseVersion`
- **THEN** Main MUST 拒绝盲目覆盖并返回结构化版本冲突
- **AND** MUST 要求基于最新版本重新合并或裁决

### Requirement: 创作资产与 Story Bible 职责分离并保持关联

创作资产 MUST 保存作者意图、设计方案与规划结构；Story Bible MUST 继续保存用于一致性约束的实体、属性、关系、时间线和伏笔事实。character/worldbuilding 等资产中可约束的 confirmed 字段 MUST 通过显式映射同步为 Story Bible 新版本并关联 `assetId` / asset version；book/chapter/scene outline 中仅属计划或意图的内容 MUST NOT 被无条件当作已发生事实。

#### Scenario: 人物澄清同步约束事实
- **WHEN** 作者确认人物资产中的“恐惧封闭空间”为正式设定
- **THEN** 系统 MUST 更新 character asset 新版本
- **AND** MUST 将对应人物属性以 confirmed 事实写入 Story Bible 新版本并保留资产来源关联

#### Scenario: 大纲计划不冒充正文事实
- **WHEN** 全书大纲计划“第三卷主角可能叛变”但正文尚未发生
- **THEN** 该内容 MUST 保存在 outline asset 的计划结构中
- **AND** MUST NOT 自动写成 Story Bible 中已发生的 confirmed 时间线事件

### Requirement: 资产变更传播影响并标记下游状态

每次资产版本提交后，Main MUST 根据显式资产引用、Story Bible 关系和稳定正文/规划 scope 计算受影响对象，并形成 `AssetImpactSet`。依赖旧版本的章节规划、分场大纲、未定稿正文、已完成审校或质量结果 MUST 被标记为 `stale`、`needs-review` 或 `conflicting`，且 MUST 给出原因和来源资产版本；系统 MUST NOT 静默重写正文或自动推翻作者定稿。

#### Scenario: 世界规则变化使章节规划过期
- **WHEN** 作者确认世界规则“魔法只能在日落后使用”的新版本，而某章节计划安排正午施法
- **THEN** 该章节计划 MUST 被标记 conflicting 或 needs-review 并指向变更规则
- **AND** 当前主工作流 MUST 显示非破坏性的影响提示
- **AND** MUST NOT 自动改写章节计划或正文

#### Scenario: 修改不影响其他资产
- **WHEN** 影响分析确认某人物口头禅变更没有被任何现有规划或正文引用
- **THEN** 系统 MUST 提交资产版本且 MAY 不创建下游修订任务
- **AND** MUST 保留影响分析结果用于审计

### Requirement: 资产维护与主工作流状态正交

资产澄清活动 MUST 记录自身的 pending-confirmation、applied、blocked、cancelled 或 failed 状态，但 MUST NOT 自动改变主工作流 `currentStageId`。若影响集命中当前阶段的前置条件或定稿内容，工作流服务 MUST 将相应阶段/产物标记 stale 或 blocked，并向作者提供“立即处理 / 记录待办 / 继续当前阶段”的模板允许选择。

#### Scenario: 澄清不打断无关写作
- **WHEN** 写作阶段的人物澄清只影响后续未开始章节
- **THEN** 主工作流 MUST 保持当前阶段
- **AND** 系统 MUST 将影响记录为后续待处理项而非强制跳转

#### Scenario: 澄清破坏当前章节前置条件
- **WHEN** 已确认资产变更与当前正在写作章节的核心前置设定冲突
- **THEN** 当前阶段 MUST 标记 stale 或 blocked 并解释冲突
- **AND** 作者 MUST 决定立即修订、保留例外或继续并记录风险
