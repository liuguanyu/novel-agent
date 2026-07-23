## ADDED Requirements

### Requirement: 新书创作模板覆盖策划到全书总检

系统 MUST 提供版本化 `new-book-creation` 模板，至少包含以下有序业务阶段：立意与定位、世界观设定、人物设计、全书大纲、章节规划、分场大纲、正文写作、事实抽取、自动审校、人工修改/验收、章节定稿与下一章决策、全书总检。模板 MUST 明确每阶段的稳定 id、actor、scope、允许专家、完成证据、可跳过性、质量门及后继转换。

#### Scenario: 新书从策划进入章节创作
- **WHEN** 作者依次确认立意、世界观、人物和全书大纲产物
- **THEN** 工作流 MUST 激活首个章节的章节规划阶段
- **AND** 每个已确认策划阶段 MUST 保留其产物引用和相关 `runId`

#### Scenario: 策划补充写入目标资产且不自动进入审校
- **WHEN** 人物设计阶段中作者继续向人物设计师补充意见
- **THEN** 新运行 MUST 继续归属人物设计阶段并生成目标 character asset 的候选变更
- **AND** 作者确认后 MUST 写入人物资产新版本及适用的 Story Bible 约束事实
- **AND** 工作流 MUST NOT 自动进入正文审校阶段
- **AND** 只有作者确认人物设计产物后才能推进

### Requirement: 已完成策划阶段仍允许横切资产澄清

新书模板 MUST 允许作者在任意后续阶段澄清已确认的立意、世界观、人物或大纲资产。澄清 MUST 作为独立 asset-maintenance activity 运行，主工作流 MUST 保持当前阶段；资产提交产生的影响集 MAY 将依赖旧版本的当前/后续阶段标记 stale、needs-review 或 blocked，但 MUST NOT 自动回退阶段或改写内容。

#### Scenario: 正文阶段更正人物恐惧
- **WHEN** 作者在正文写作阶段确认“该人物怕封闭空间而不是水”的人物资产变更
- **THEN** 主工作流 MUST 保持正文写作阶段
- **AND** character asset 与对应 Story Bible 属性 MUST 产生可追溯新版本
- **AND** 引用旧设定的章节规划或正文 MUST 出现在影响清单

#### Scenario: 澄清只影响未来章节
- **WHEN** 资产影响分析只命中尚未开始的未来章节计划
- **THEN** 当前阶段 MUST NOT 被强制阻塞
- **AND** 工作流 MUST 记录待处理影响并允许作者继续当前阶段

### Requirement: 新书模板按章节形成受控循环

新书模板 MUST 对每个章节依次执行章节规划、分场大纲、正文写作、事实抽取、自动审校、人工修改/验收与章节定稿。章节定稿后 MUST 由作者决定创建下一章循环或结束章节创作并进入全书总检；章节 scope MUST 使用稳定 `chapterId`。

#### Scenario: 审校无问题进入章节验收
- **WHEN** 本章事实抽取成功且自动审校未产生阻塞问题
- **THEN** 工作流 MAY 自动完成自动步骤并进入作者验收/定稿门
- **AND** MUST NOT 在作者确认前把章节标记为定稿

#### Scenario: 审校有问题回到修改
- **WHEN** 自动审校产生需要修改或裁决的问题
- **THEN** 当前章节 MUST 进入人工修改/验收阶段
- **AND** 修改完成后 MUST 回到针对本章的审校/验证
- **AND** 问题未消除时 MUST NOT 定稿

#### Scenario: 下一章创建新范围
- **WHEN** 作者在章节定稿后选择继续下一章
- **THEN** 工作流 MUST 为新 `chapterId` 创建或激活新的章节循环阶段实例
- **AND** MUST 保留已定稿章节的阶段和运行历史

### Requirement: 老书审校修订模板形成发现到关闭闭环

系统 MUST 提供版本化 `legacy-book-revision` 模板，至少包含：导入既有小说、全书事实回填、全书总检、问题分级与选择、定位原文、生成局部改写方案、逐 hunk 接受/拒绝、正文落盘与 checkpoint、针对性复检、问题关闭、最终全书复检。模板 MUST 复用稳定项目/章节/问题标识，并禁止任何修复绕过局部 diff 与逐 hunk 裁决。

#### Scenario: 导入后先建立事实底座
- **WHEN** 作者为已导入小说启动老书修订工作流
- **THEN** 工作流 MUST 在首次全书总检前执行或确认全书事实回填
- **AND** 总检结果 MUST 记录其使用的事实版本

#### Scenario: 单个问题完成修订闭环
- **WHEN** 作者从问题清单选择一个 open 问题
- **THEN** 工作流 MUST 依次引导原文定位、实际改写片段生成、逐 hunk 裁决、落盘/checkpoint 和针对性复检
- **AND** 仅在复检证明问题消除后才可将问题标记 resolved

#### Scenario: 复检失败继续修复
- **WHEN** 针对性复检仍检测到所选问题
- **THEN** 工作流 MUST 将该问题返回 fixing 并重新进入局部改写阶段
- **AND** MUST 保留此前 checkpoint、改写运行和复检运行记录

### Requirement: 老书问题队列结束后必须最终全书复检

当当前问题集合均为 resolved 或 dismissed 时，老书模板 MUST 运行最终全书复检；只有最终复检没有未处理阻塞问题时工作流才可完成。最终复检发现的新问题或复发问题 MUST 纳入问题清单并返回修订循环。

#### Scenario: 最终复检发现新问题
- **WHEN** 已有问题全部关闭但最终全书复检发现新的 critical 或 warning 问题
- **THEN** 工作流 MUST 创建或更新对应 workflow issue records
- **AND** MUST 返回问题分级与选择阶段
- **AND** MUST NOT 将工作流标记 completed

#### Scenario: 最终复检通过
- **WHEN** 最终全书复检没有未处理的阻塞问题且作者确认结果
- **THEN** 老书修订工作流 MUST 转为 completed
- **AND** MUST 保留最终审计运行与健康度结果引用

### Requirement: 模板阶段区分自动节点与人工节点

模板 MUST 明确每阶段的 actor 与推进方式。system/quality-gate 阶段只有在结果无歧义且无作者写入风险时才可自动推进；expert 阶段产物验收、author 阶段、冲突裁决、hunk 裁决与定稿 MUST 等待作者操作。

#### Scenario: 自动事实抽取成功推进
- **WHEN** 事实抽取阶段成功且不存在冲突
- **THEN** 工作流 MAY 自动进入自动审校阶段

#### Scenario: 事实冲突阻塞自动推进
- **WHEN** 事实抽取产生 conflicting 事实
- **THEN** 当前阶段 MUST 进入 blocked 或 awaiting-confirmation
- **AND** MUST 在作者裁决前停止后继质量门
