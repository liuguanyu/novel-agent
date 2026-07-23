# story-bible-extraction (I4) 任务

> 五道门：node typecheck / web typecheck / eslint / electron-vite build / `openspec validate story-bible-extraction --strict`。
> 加：`smoke:extraction` 可复现冒烟 + `smoke:orchestration` 回归。

## 1. 抽取运行时骨架

- [x] 1.1 新建 `src/main/extraction/`，拆分 extractor / schema / normalizer / ingest 纯函数边界。
- [x] 1.2 `FactExtractor`：接收 `ExtractionInput`，组装中文事实抽取 prompt，调用 `ModelResolver` 的 `fact-extractor` agent（无专属配置时走 defaults）。
- [x] 1.3 抽取 prompt 明确 JSON 输出格式、候选 kind、payload 最小字段、provenance/quote 要求。
- [x] 1.4 抽取过程接入本地日志：chapterId、text chars、raw chars、parse mode、candidate/invalid count。

## 2. 模型输出校验与 JSON 防守

- [x] 2.1 `fact-extraction-schema.ts`：解析完整 JSON object / fenced JSON / 半截 candidates 数组中的完整 item。
- [x] 2.2 item-level schema salvage：单个候选坏掉不丢整批；字段漂移能规范化的尽量修复。
- [x] 2.3 输出 `ExtractionParseDiagnostics`，记录 valid / invalid / parseSource / objectCandidates。
- [x] 2.4 严禁未校验 unknown/any 穿透入库；所有 payload 进入 normalizer 前必须经最小 schema 收窄。

## 3. 候选规范化

- [x] 3.1 定义每种 `CandidateKind` 的 payload schema：entity / alias / attribute / timeline-event / relation / plot-hook。
- [x] 3.2 将 entity 候选规范化为 `Entity`，生成稳定 id、aliasSet、attributes、inferred status、provenance。
- [x] 3.3 将 alias/attribute 候选解析到目标实体（entityId 优先，entityName/alias 次之），无法确定时产 skipped/conflict disposition。
- [x] 3.4 将 timeline-event / relation / plot-hook 候选规范化为对应 core 类型，补 provenance 与 inferred/conflicting status。
- [x] 3.5 所有 normalized fact 必须含来源 NodeRef、quote、confidence；缺失时不得自动入库。

## 4. 去重、冲突判定与入库计划

- [x] 4.1 实现 `buildIngestPlan(candidates, FactView)`：输出 autoIngest / conflicts / skipped / diagnostics。
- [x] 4.2 实体/别名去重：规范名、alias 命中既有实体时合并；同 alias 指向不同 confirmed 实体时冲突。
- [x] 4.3 属性去重/冲突：同 key/value 幂等；同 key 不同 value 且既有 confirmed 时冲突。
- [x] 4.4 时间线/关系/伏笔使用来源锚点 + 描述归一化 identityKey 幂等，重复抽取不新增重复行。
- [x] 4.5 冲突转换为 `ConsistencyIssue`，requiresHumanDecision=true，options 至少含 accept-new / keep-existing / manual-edit / ignore-candidate。

## 5. 写入 SqliteFactStore

- [x] 5.1 扩展或封装 `SqliteFactStore` 写入 API：按 ingest plan 批量写 entity/timeline/relation/plotHook。
- [x] 5.2 每个抽取批次创建 fact version；可用 checkpoint 时关联 checkpoint，否则保持来源 NodeRef 可追踪。
- [x] 5.3 写入必须保持增量非覆盖；必要时用 `fact_changes.payload_json` 或新增 migration 记录 dedupKey / extraction batch。
- [x] 5.4 幂等验证：同章同输出重复入库，实体、alias、timeline、plotHook 数量不翻倍。

## 6. 编排与 IPC 接入

- [x] 6.1 新增显式抽取命令（当前章节/指定章节）：Main 读章节正文后提交 FactExtractor。
- [x] 6.2 抽取进度/完成/失败/冲突事件走强类型 control-event；Renderer 不直接碰 DB/LLM/fs。
- [x] 6.3 将抽取冲突接入 I3 手刹：interrupt-raised 下发冲突 issues，resume 后按作者选择处理。
- [x] 6.4 writer 后可选自动抽取低风险事实；冲突不静默写入，必须挂起。
- [x] 6.5 reviewer 只读取事实库，不在审校过程中写事实库，避免职责混淆。

## 7. 导入/补库路径

- [x] 7.1 支持按 manifest 章节列表逐章补抽（串行或小并发，避免 UI 卡顿）。
- [x] 7.2 长文本章节需分块抽取并合并候选，分块仍保留章级 NodeRef 与 quote。
- [x] 7.3 补库过程可中断；abort 后不得提交半截未校验候选。

## 8. 冒烟与验证

- [x] 8.1 新增 `src/main/extraction-smoke.ts` 与 `smoke:extraction` script。
- [x] 8.2 冒烟覆盖：fake extractor 输出顾长风 entity/alias/attribute/plotHook → 入库 → `retrieveFacts` 能命中。
- [x] 8.3 冒烟覆盖：同章重复抽取两次不重复堆积。
- [x] 8.4 冒烟覆盖：confirmed 属性冲突产生需人工裁决 issue，不自动覆盖。
- [x] 8.5 回归 `smoke:orchestration`，确认 I3 reviewer 读取抽取入库后的事实仍可纠偏/冲突。
- [x] 8.6 五道门全绿。
