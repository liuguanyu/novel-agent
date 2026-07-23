## Context

I2 已有 `SqliteFactStore` 与 facts/timeline/relations/plot_hooks 表，I3 已能读取这些事实做上下文组装、章号纠偏和冲突硬阻断。当前缺口是“事实从哪里来”：真实正文不会自动进入事实库，导致检索链路在空库时只能降级。

I4 只补“正文 → 候选事实 → 校验/冲突 → 入库/裁决”的运行时闭环；不重开事实模型，也不重做 I3 编排架构。

## Goals / Non-Goals

**Goals:**

- Main 侧落地事实抽取服务：输入章节/场景稳定 NodeRef + 正文，输出强类型候选事实。
- 模型输出经 schema 与防守解析后才能进入入库计划；禁未校验 unknown/any 穿透。
- 将候选规范化为 `Entity` / `EntityAttribute` / alias / `TimelineEvent` / `Relation` / `PlotHook`，每条事实带 provenance。
- 低风险不冲突候选自动入库为 `inferred`；冲突/高风险候选标 `conflicting` 并挂起人工裁决。
- 对同一来源重复抽取幂等，不堆积重复事实。
- 抽取写入创建 fact version，并尽量关联当前 checkpoint/章节锚点。
- 提供按章补抽 smoke：真实章节正文 → fake/真实 adapter 输出候选 → 入库 → I3 检索命中。

**Non-Goals:**

- 不做 I5 全书总检 Map-Reduce 调度与红黄牌仪表盘。
- 不做 I6 局部重构 diff/hunk 拼回正文。
- 不做 I7 embedding/向量检索。
- 不追求一次抽取 100% 正确；本波以 inferred + provenance + 冲突裁决控制风险。
- 不把抽取放进 Renderer；Renderer 只发命令/收事件。

## Decisions

### D1. 抽取服务在 Main，核心合并逻辑尽量纯函数

新增 `src/main/extraction/` 运行时代码：

- `fact-extractor.ts`：组 prompt、调用 `ModelResolver.createAdapter('fact-extractor', ...)`、收集文本。
- `fact-extraction-schema.ts`：解析/校验模型输出为 `ExtractionOutput`，复用 I3 reviewer JSON 防守经验。
- `candidate-normalizer.ts`：把候选 payload 收窄为可入库 core 类型。
- `candidate-ingest.ts`：对 `FactView` 做去重、冲突判定与入库计划。

其中 normalizer/ingest 尽量保持无 I/O，后续可迁移 utilityProcess 或被 I5 复用。

### D2. 模型输出格式：固定 JSON，但运行时必须防守

Prompt 要求模型只输出：

```json
{"candidates":[{"kind":"entity","suggestedAnchor":{"id":"...","kind":"chapter"},"confidence":0.8,"payload":{}}]}
```

但运行时不得信任模型。必须支持：

- Markdown fenced JSON；
- `candidates` 数组半截截断时抢救完整 item；
- `evidence`/`quote` 等常见字段漂移映射到 provenance；
- 单个候选无效时丢弃该 item，不整批失败；
- 解析结果写日志，记录 parse mode / valid / invalid 数量。

### D3. 候选 payload 的最小可落库形状

模型候选的 `kind` 仍沿用 core 契约，但 I4 需约束每种 payload 的最小字段：

- `entity`: `entityType`, `canonicalName`, optional `aliases`, optional `attributes`, `quote`
- `alias`: `entityName` 或 `entityId`, `alias`, `quote`
- `attribute`: `entityName` 或 `entityId`, `key`, `value`, `quote`
- `timeline-event`: `description`, optional `tick/label/durationTicks/relatedNames`, `quote`
- `relation`: `fromName/fromEntityId`, `toName/toEntityId`, `kind`, optional `directionality`, `quote`
- `plot-hook`: `description`, `state`, `quote`

缺少 identity 或 quote 的候选不得自动入库，可降级为需人工确认或丢弃并记录 diagnostics。

### D4. 确定性去重优先，LLM 不负责决定覆盖

去重/冲突在程序里做，不由模型自称“无冲突”。基本策略：

- 实体：规范名/别名命中既有实体 → 合并 aliases/attributes；否则新建稳定 id。
- 别名：同一实体已有 alias → 幂等跳过；alias 指向不同 confirmed 实体 → 冲突。
- 属性：同一实体同 key 同 value → 幂等；同 key 不同 value 且旧值 confirmed → 冲突；旧值 inferred 可作为 update 计划但保留 provenance。
- 时间线/关系/伏笔：基于来源锚点 + 描述归一化 hash 形成 identityKey，重复抽取 update/skip，不新增重复行。

### D5. 风险分级：少打断，但 confirmed 不可自动覆盖

自动入库条件：

- 候选字段完整；
- 无 confirmed 冲突；
- 属低风险新增/补充（新实体、新 alias、新 provenance、新时间线事件、新伏笔）。

挂起条件：

- 试图改变 confirmed 属性/关系/伏笔状态；
- alias 与其他 confirmed 实体冲突；
- 时间线顺序明显撞 confirmed 事件；
- normalizer 无法确定目标实体但候选置信度高且影响大。

冲突以 `ConsistencyIssue` 下发，`requiresHumanDecision=true`，options 至少包含：接受新事实、保留旧事实、手工修改、忽略本候选。

### D6. 入库版本与 checkpoint 对齐

每次抽取批次创建新的 fact version：

- 若当前运行已提交 checkpoint，则关联最近 checkpoint id；
- 若是独立补抽/导入，没有 checkpoint，可创建无 checkpoint 的 fact version，但必须记录来源 NodeRef；
- 写入保持 I2 增量非覆盖原则，`fact_changes` 记录新增/更新目标。

### D7. 接入点先保守：显式抽取 + writer 后可选自动抽取

为控制风险，本波优先落地两个入口：

1. 显式“为当前章节抽取事实”命令：最可控，便于调试。
2. writer 产生新草稿后，若有 `currentChapterId` 且正文长度足够，可触发一次抽取计划；自动入库低风险项，冲突则走手刹。

reviewer 诊断只读取事实库，不负责写事实库，避免审校与抽取互相污染。

### D8. 进度与可观测性

抽取可能比 reviewer 更长，必须可观测：

- 本地日志记录 chapterId、text chars、raw chars、parse mode、candidate count、auto-ingested、conflicts、skipped。
- IPC 控制事件可下发抽取开始/完成/失败/冲突，Renderer 后续可显示“事实库更新了 N 条”。
- smoke 必须覆盖幂等：同章重复抽取两次，实体/别名/伏笔数量不翻倍。

## Risks / Trade-offs

- **模型抽取噪声大**：用 schema、provenance、inferred 状态、confirmed 不自动覆盖降低风险。
- **中文实体消歧难**：先用规范名/别名确定性匹配；不确定就挂起或跳过，不让模型静默合并。
- **自动抽取打断写作**：默认只自动入库低风险项，冲突复用手刹；显式抽取入口先行。
- **事实版本视图当前实现偏“当前态”**：I4 可先按 latest view 工作；若要严格 time-travel fact view，需要补查询能力或在后续 I5/I6 深化。

## Migration / Rollout

- 不需要破坏性迁移。若需要记录抽取批次/来源去重键，可追加 SQLite migration 新表或利用 `fact_changes.payload_json`。
- `config/models.json` 若没有 `fact-extractor` 专属配置，按 `ModelResolver` 既有 defaults fallback。
- UI 可先复用控制事件展示简要结果；精细事实库面板可后置。
