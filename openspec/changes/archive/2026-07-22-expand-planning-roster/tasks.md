# Tasks

## 1. 图拓扑与动作（core）
- [x] 1.1 `core/orchestration/action.ts`：`OrchestrationAction` 新增 `generate-concept` / `outline-scenes` / `research`（带注释）。
- [x] 1.2 `core/orchestration/graph-topology.ts`：`NodeName` 联合、`EXPERT_NODES` 数组、`ACTION_ROUTING` 各新增 3 项映射。

## 2. 召唤目录与图标
- [x] 2.1 `core/shell/agent-catalog.ts`：`AGENT_CATALOG` 新增 3 条 planning 条目（concept-generator=Lightbulb / scene-outliner=ListTree / researcher=Microscope；defaultMode=mutate，scope=document，requiresAnchor=false）。
- [x] 2.2 `renderer/lib/agent-icons.ts`：import 并登记 `Lightbulb` / `ListTree` / `Microscope`。

## 3. 提示词（main）
- [x] 3.1 `main/orchestration/prompt-registry.ts`：新增 3 份内置默认（`CONCEPT_GENERATOR_PROMPT_DEFAULT` / `SCENE_OUTLINER_PROMPT_DEFAULT` / `RESEARCHER_PROMPT_DEFAULT`）+ 3 个 getter。
- [x] 3.2 `main/orchestration/prompts/`：新增 `concept-generator.yml` / `scene-outliner.yml` / `researcher.yml`（中文化，与内置默认同义）。

## 4. 图节点接线（main）
- [x] 4.1 `main/orchestration/graph.ts`：import 3 个新 getter；`runPlanningNode` 的 `agentId` 联合扩 3 项。
- [x] 4.2 新增 `conceptGeneratorNode` / `sceneOutlinerNode` / `researcherNode`（各调 `runPlanningNode`）。
- [x] 4.3 `BUILT_NODES` 加 3 项；`buildCompiledGraph`：addNode ×3、supervisor `ends` ×3、`addEdge(node, END)` ×3。

## 5. 冲烟与校验
- [x] 5.1 `main/orchestration-smoke.ts`：`smokeVisualDesignContracts` 图标断言随目录自动覆盖；`smokeToolboxCatalogContracts` 的 `=== 10` 改为 `=== 13`（label 文案同步）。
- [x] 5.2 两处 tsc（node/web）、ESLint、electron-vite build 全绿。
- [x] 5.3 `npm run smoke:orchestration` 末行 `=== 完成：全部通过 ===`。

## 6. 归档
- [x] 6.1 `npx openspec validate expand-planning-roster --strict` 通过。
- [x] 6.2 标记本文件全部完成并 `openspec archive`。
