## Why

I9 子阶段 E（阵容扩展收官）：把 LibriScribe 参考的**策划类**三 agent 接成真图节点。前序 A 打通召唤路由 + fact-checker，B 落地 YAML 运行时，C 落地 scene-generator/plagiarism-checker，D 落地 editor/style-editor。本 change 落地：

- `architect`（动作 `outline`）：产出章节/场景大纲、情节推进与人物成长里程碑。
- `character-generator`（动作 `generate-characters`）：产出人物档案（背景/动机/性格/关系/口吻）。
- `worldbuilding`（动作 `build-world`）：产出世界设定要素（地理/文化/历史/规则/组织）。

**核心：策划产物落地 story-bible 的写入契约。** 三者都是**写作类**——把策划产物写入 `currentDraft` + 作为对话呈现，并复用运行层既有的 `afterWriterDraft` 钩子，让产物经**既有「抽取→ingest→写 story-bible」管线**（I4 落地：`parseExtractionOutput→normalizeCandidateFacts→buildIngestPlan→applyIngestPlan`）落库为实体/属性/关系/伏笔/时间线：低风险不冲突者自动入库标 inferred，与既有 confirmed 冲突者标 conflicting 挂起走手刹裁决。**不新建平行写路径**——写入契约即「策划产物复用正文抽取入库管线」，锚点缺失（无 currentChapterId）时降级为仅对话呈现、不入库。

参考 `references/libriscribe-prompts/{outliner,character_generator,worldbuilding}.yml` 为英文、要求「输出 JSON 结构」，schema 亦不同；本 change 中文化改写、**改为产出中文自然语言策划文本**（供抽取管线消费），不照抄其 JSON 契约。

## What Changes

- `action.ts`：`OrchestrationAction` 补 `generate-characters`/`build-world`（`outline` 已在）。
- `graph-topology.ts`：`ACTION_ROUTING` 增 `generate-characters→character-generator`、`build-world→worldbuilding`（`outline→architect` 已在）；`NodeName`/`EXPERT_NODES` 已含三者，无需改。`AGENT_TO_ACTION`/`actionForAgent` 因反转自动覆盖，无需改。
- 新增 YAML 资产 `prompts/{architect,character-generator,worldbuilding}.yml`（中文化改写）+ registry getter/内置默认。
- `context-assembler.ts`：为三者补组装策略（architect 要伏笔/时间线看全局结构；character-generator 侧重实体/关系；worldbuilding 侧重实体/地点/组织）。
- `graph.ts`：`BUILT_NODES` 增三者；实现 `architectNode`/`characterGeneratorNode`/`worldbuildingNode`（写作类：产策划文本 + 调 `afterWriterDraft` 走抽取入库 + `currentAction→idle` + 直达 END，不进写-审-改环）；接入编译图（supervisor ends、addNode、直连 END 边）。

## Impact

- Affected specs: `orchestration-graph`（MODIFIED「supervisor 路由与专家节点」+ 3 新 Scenario：architect/character-generator/worldbuilding 为已落地策划类节点，产物经既有抽取入库管线落地 story-bible）。
- Affected code: `src/core/orchestration/action.ts`、`src/core/orchestration/graph-topology.ts`、`src/main/orchestration/graph.ts`、`src/main/orchestration/prompt-registry.ts`、`src/main/orchestration/context-assembler.ts`、新增 `src/main/orchestration/prompts/{architect,character-generator,worldbuilding}.yml`。
- 依赖 I9 子阶段 A（路由/节点范式，已归档）+ B（YAML 运行时，已归档）+ I4（事实抽取入库管线，已绿）。
- 兼容性：新增节点，既有 writer/reviewer/fact-checker/scene-generator/plagiarism-checker/editor/style-editor 路径不变；smoke/build 保持绿。本 change 完成即 I9 阵容扩展全部子阶段（A–E）收官。
