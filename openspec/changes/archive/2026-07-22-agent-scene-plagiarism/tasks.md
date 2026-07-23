## 1. Specification

- [x] 1.1 orchestration-graph delta: scene-generator（写作类，写-审-改）与 plagiarism-checker（审校类，产 ConsistencyIssue[]）为已落地专家节点。

## 2. 拓扑与动作（core）

- [x] 2.1 `action.ts`：`OrchestrationAction` 补 `generate-scene`/`plagiarism-check`。
- [x] 2.2 `graph-topology.ts`：`ACTION_ROUTING` 增二映射；`NodeName`/`EXPERT_NODES` 补 `plagiarism-checker`。

## 3. 提示词资产（main）

- [x] 3.1 `prompts/scene-generator.yml`（写作类，show-don't-tell、承接相邻场景）+ registry getter/内置默认。
- [x] 3.2 `prompts/plagiarism-checker.yml`（原创性/雷同风险，产统一 JSON 数组，type 用 other）+ registry getter/内置默认。

## 4. 节点实现与接线（main）

- [x] 4.1 `context-assembler.ts`：补二者组装策略。
- [x] 4.2 `graph.ts`：`sceneGeneratorNode`（writer 同构、currentAction→review、进 reviewer）。
- [x] 4.3 `graph.ts`：`plagiarismCheckerNode`（fact-checker 同构、诊断态、不叠事实硬检查、经 routeAfterReview 路由）。
- [x] 4.4 `graph.ts`：`BUILT_NODES` 增二者；supervisor ends + addNode + 条件边接入编译图。

## 5. Validation

- [x] 5.1 Run node and web TypeScript checks.
- [x] 5.2 Run ESLint.
- [x] 5.3 Run OpenSpec strict validation.
- [x] 5.4 Run production build（确认二 YAML 拷入产物）。
- [x] 5.5 Run `smoke:orchestration`（既有路径全绿；新节点可达）。
