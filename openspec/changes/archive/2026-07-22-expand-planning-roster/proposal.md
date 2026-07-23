# 扩充策划类专家阵容（concept-generator / scene-outliner / researcher）

## Why

`references/libriscribe-prompts/` 存档了 13 个 LibriScribe 角色模板，本项目已接入 10 个专家节点，
仍有 3 个策划/前期类角色未落地：

- `concept_generator`（概念生成）：产书籍立意——标题、一句话故事内核（logline）、主题、目标读者、独特卖点；
- `scene_outliner`（分场大纲）：在章内产 3–5 个场景的分场大纲（场景目的/关键事件与冲突/人物互动/情绪节拍/场景与氛围/过场）；
- `researcher`（资料研究）：为题材做背景资料研究（关键史实/技术细节/写作可用角度），提升真实感与深度。

三者均为**策划类（planning）**：产中文自然语言蓝图、写入 currentDraft、经既有
`afterWriterDraft` 抽取入库管线落地 story-bible、完成后直达 END（不进写-审-改环），
与既有 architect/character-generator/worldbuilding **完全同构**，复用 `runPlanningNode`。
接入它们能补齐从"立意 → 世界/人物 → 章/场大纲 → 资料"的完整前期策划链，且几乎零新机制。

## What Changes

- **图拓扑**：`EXPERT_NODES` / `NodeName` / `ACTION_ROUTING` 各新增 3 项（`concept-generator` /
  `scene-outliner` / `researcher`，动作 `generate-concept` / `outline-scenes` / `research`）。
- **动作类型**：`OrchestrationAction` 新增 3 个联合成员（带注释）。
- **提示词**：prompt-registry 新增 3 份内置默认 + 3 个 getter；`prompts/` 新增 3 份中文化外置 YAML。
- **图节点**：`graph.ts` 新增 3 个策划节点函数（复用 `runPlanningNode`，扩其 `agentId` 联合），
  登记进 `BUILT_NODES`、`buildCompiledGraph`（addNode + supervisor ends + addEdge→END）。
- **召唤目录**：`AGENT_CATALOG` 新增 3 条 planning 条目（因 `Record<ExpertAgentId,…>` 穷尽约束，
  不加即编译期报错）；`agent-icons` 新增 3 个 lucide 图标（Lightbulb / ListTree / Microscope）。
- **冲烟**：`smokeVisualDesignContracts` / `smokeToolboxCatalogContracts` 的 `=== 10` 断言改为 `=== 13`。

不改任何既有节点的行为、路由或输出契约；纯增量扩位。

## Impact

- Affected specs: `orchestration-graph`（MODIFIED：专家节点清单 + 3 个新策划节点 Scenario），
  `command-palette`（MODIFIED：召唤目录覆盖数由 10 → 13）。
- Affected code: `core/orchestration/{action,graph-topology}.ts`、`core/shell/agent-catalog.ts`、
  `main/orchestration/{graph,prompt-registry}.ts`、`main/orchestration/prompts/*.yml`（新增 3）、
  `renderer/lib/agent-icons.ts`、`main/orchestration-smoke.ts`。
- 向后兼容：既有 10 个 agent 的召唤、路由、YAML 覆盖、抽取入库路径完全不变。
