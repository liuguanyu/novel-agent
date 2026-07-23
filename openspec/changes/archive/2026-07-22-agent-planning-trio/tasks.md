## 1. Specification

- [x] 1.1 orchestration-graph delta: architect(outline)/character-generator/worldbuilding 为已落地策划类节点——产中文策划文本，经既有「抽取→ingest→写 story-bible」管线落地为事实（锚点缺失时降级为仅对话）。

## 2. 拓扑与动作（core）

- [x] 2.1 `action.ts`：`OrchestrationAction` 补 `generate-characters`/`build-world`。
- [x] 2.2 `graph-topology.ts`：`ACTION_ROUTING` 增 `generate-characters→character-generator`、`build-world→worldbuilding`。

## 3. 提示词资产（main）

- [x] 3.1 `prompts/architect.yml`（章节/场景大纲、情节推进、人物成长里程碑；产中文自然语言）+ registry getter/内置默认。
- [x] 3.2 `prompts/character-generator.yml`（人物档案：背景/动机/性格/关系/口吻；产中文自然语言）+ registry getter/内置默认。
- [x] 3.3 `prompts/worldbuilding.yml`（世界设定：地理/文化/历史/规则/组织；产中文自然语言）+ registry getter/内置默认。

## 4. 节点实现与接线（main）

- [x] 4.1 `context-assembler.ts`：补三者组装策略。
- [x] 4.2 `graph.ts`：`architectNode`/`characterGeneratorNode`/`worldbuildingNode`（写作类共用实现：产策划文本 → 写 currentDraft + dialogue → 调 afterWriterDraft 走抽取入库 → currentAction→idle → 直达 END）。
- [x] 4.3 `graph.ts`：`BUILT_NODES` 增三者；supervisor ends + addNode + 直连 END 边接入编译图。

## 5. Validation

- [x] 5.1 Run node and web TypeScript checks.
- [x] 5.2 Run ESLint.
- [x] 5.3 Run OpenSpec strict validation.
- [x] 5.4 Run production build（确认三 YAML 拷入产物）。
- [x] 5.5 Run `smoke:orchestration`（既有路径全绿；新节点可达）。
