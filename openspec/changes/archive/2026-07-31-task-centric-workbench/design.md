## Context

需求要求工作台从“流程/运行状态展示”转为“当前任务驱动”。任务运行必须留下真实、可审计、作者可读的活动，并能将正文操作反馈到工作区。实现需要兼容已有 LangGraph、SQLite、IPC 和旧作能力，也必须承载尚无正文的新书任务。

## Goals / Non-Goals

**Goals:**

- 用统一 Task Runtime 承载旧作、新书和临时任务。
- 让当前任务卡、活动流、任务中心和工作区 effect 表达同一条业务事实。
- 以 `locate-source` 作为第一个真实端到端任务。
- 提供真实 heartbeat、暂停/中断/失败/等待作者语义。
- 模型结果可审计但不泄露 hidden CoT。

**Non-Goals:**

- 不在本 change 内重做已有 LangGraph 节点业务逻辑或全书审校算法。
- 不在 Renderer 执行任务、访问数据库、调用模型或读取文件。
- 不把完整流程图永久铺满主工作区。
- 不把模型内部推理过程转换成对作者可见的伪解释。

## Decisions

### 1. 当前任务是主叙事，流程是辅助导航

工作台按“产品栏 → 轻量流程导航 → 当前任务卡 → 三栏工作区 → 常驻底部消息流”组织。任务卡必须显示名称、目标/问题、目的、输入、执行方式、预期输出、状态/进度、作者操作和下一步。Graph 默认只显示已完成数、当前任务和下一步，任务中心展示完整计划与历史。

### 2. Task Runtime 是活动真相源

Main 为任务创建 task run，记录输入，执行 playbook，保存活动/产物/作者决策，发布 UI Effect 和 heartbeat，并处理状态收敛。Renderer 不再长期从 workflow snapshot 或 dashboard 拼装活动；迁移期间旧快照只能兼容回退且不得冒充真实运行事件。

统一状态：`queued | running | awaiting-author | paused | completed | failed | cancelled`。活动至少覆盖 started、input-declared、step started/completed、tool-used、model-interaction、output-produced、ui-effect、awaiting-author、heartbeat、completed、failed。

### 3. Activity Stream 分层呈现

活动以 `taskRunId`、任务/项目引用、phase、作者可读 title/message、输入/输出摘要、feedback、nextAction、evidenceRefs、artifactRefs、uiEffects 和 createdAt 记录。底部固定窗口只取最近 2～3 条重要活动，任务中心按 task run 查询完整历史。业务文案不得以内部 ID、事件类型或技术阶段代码为主文本。

### 4. Heartbeat 必须来自真实状态

Runtime 为运行中的 task run 维护最后活动时间；超过 2 秒无新活动时发布 heartbeat，内容必须包含可验证的步骤、处理数量、当前章节/问题、最近完成的子步骤或外部等待状态之一。无事实依据时宁可不填数量，也不能生成百分比或循环占位文案。

### 5. 模型审计采用摘要与证据白名单

`task-run-model-interaction` 只保存模型任务目标、可见输入摘要、上下文引用、作者/系统业务约束、输出摘要、结构化结果、工具结果、验证结果及采用/拒绝/待确认决定。隐藏 chain-of-thought、不可追溯解释和不适合作者理解的内部 prompt 永不进入 DTO、持久化活动或 Renderer。

### 6. UI Effect 是正文操作的强制出口

任务对正文、诊断或产物产生影响时，Runtime 必须发布 effect 活动；Renderer 的统一 executor 按白名单执行切章、滚动、highlight、diagnostic marker、open diff、hunk review、checkpoint、fact sheet、报告等效果。effect 执行结果再生成活动，确保消息流“发生了什么”与工作区“结果在哪里”一致；Renderer 只上报意图和执行状态。

### 7. `locate-source` 作为首个端到端 vertical slice

Playbook 输入为诊断问题、证据引用、章节锚点、正文和相关人物/事实底稿。步骤为展示问题、解析证据、按章节缩小、精确匹配、必要时近似匹配、验证上下文、产出候选、发布 select/scroll/highlight；多候选进入 awaiting-author，确认后建议进入局部改写。章节不存在、引用变化、证据不足、匹配失败、候选过多和读取失败均需包含已尝试步骤、原因和恢复动作。

### 8. 旧作与新书共享模型

Task Runtime 只依赖 `project`、目标、上下文、playbook、task run、活动和产物，不要求已有章节。旧作使用“诊断/定位/改写/审核/落盘/复检”模板，新书使用“目标/设定/人物/故事线/规划/场景/初稿/审校”模板；新增任务通过 playbook 接入，不复制工作台。

## Risks / Trade-offs

- 真实事件增加跨进程一致性要求：以 Main 发布和持久化为准，采用 request/operation id 与重连查询保证幂等。
- 高频活动可能扰乱阅读：底部只显示最近 2～3 条，完整记录保留在任务中心。
- 近似匹配可能产生歧义：不自动写正文，多候选必须等待作者。
- 旧事件迁移期间可能存在重复展示：明确标记兼容来源，并逐步移除 snapshot 拼装。

## Migration Plan

先落 Core/IPC DTO 与工作台骨架，再接 Main Task Runtime 和真实活动，随后接 UI Effect，最后以 `locate-source` 完成旧作路径的第一条闭环；新书 playbook 在共用契约稳定后接入。既有 standalone 运行继续可用。

## Open Questions

- 活动和任务中心的 SQLite 表名及保留策略需结合现有 persistence migration 定稿。
- heartbeat 的后台调度器应复用现有 runtime scheduler 还是由 task runner 持有，实施时以进程生命周期和测试便利性决定。
