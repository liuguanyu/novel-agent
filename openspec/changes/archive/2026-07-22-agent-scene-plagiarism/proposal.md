## Why

I9 子阶段 C：继续把 LibriScribe 参考阵容接成真图节点。子阶段 A 打通了「召唤→agent→action→节点」并落地 fact-checker，B 落地了外置 YAML 提示词运行时。本 change 落地两个新专家节点：

- `scene-generator`（写作类）：作者按需召唤生成"分场景"正文，走与 writer 同构的写-审-改环（产 currentDraft、进 reviewer、必要时回 writer 修订）。
- `plagiarism-checker`（审校类）：对已有正文做原创性/雷同风险诊断，产统一 `ConsistencyIssue[]`（复用 reviewer/fact-checker 的解析/校验/裁决基建，只诊断不改写、不对撞事实库）。

二者提示词直接复用子阶段 B 的 YAML 运行时（新增 `prompts/*.yml` + registry getter），无需再碰加载器。

## What Changes

- `graph-topology.ts`：`ACTION_ROUTING` 增 `generate-scene→scene-generator`、`plagiarism-check→plagiarism-checker`；`NodeName`/`EXPERT_NODES` 补 `plagiarism-checker`（`scene-generator` 已在）。`AGENT_TO_ACTION`/`actionForAgent` 因反转自动覆盖二者，无需改。
- `action.ts`：`OrchestrationAction` 补 `generate-scene`/`plagiarism-check` 注释项。
- 新增 YAML 资产 `prompts/scene-generator.yml`、`prompts/plagiarism-checker.yml`（中文化改写自 references）+ registry getter/内置默认。
- `graph.ts`：`BUILT_NODES` 增二者；实现 `sceneGeneratorNode`（writer 同构、走写-审-改）与 `plagiarismCheckerNode`（fact-checker 同构、诊断态、不叠事实硬检查）；接入编译图（supervisor ends、addNode、条件边）。
- `context-assembler.ts`：为二者补组装策略（scene-generator 侧重实体/伏笔；plagiarism-checker 不查库、侧重近期对话）。

## Impact

- Affected specs: `orchestration-graph`（MODIFIED「supervisor 路由与专家节点」+ 2 新 Scenario）。
- Affected code: `src/core/orchestration/graph-topology.ts`、`src/core/orchestration/action.ts`、`src/main/orchestration/graph.ts`、`src/main/orchestration/prompt-registry.ts`、`src/main/orchestration/context-assembler.ts`、新增 `src/main/orchestration/prompts/{scene-generator,plagiarism-checker}.yml`。
- 依赖 I9 子阶段 A（fact-checker/路由，已归档）+ B（YAML 运行时，已归档）。为 D/E 提供更多已建节点范式。
- 兼容性：新增节点，既有 writer/reviewer/fact-checker 路径不变；smoke/build 保持绿。
