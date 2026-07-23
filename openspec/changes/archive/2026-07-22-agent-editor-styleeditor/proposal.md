## Why

I9 子阶段 D：继续把 LibriScribe 参考阵容接成真图节点。A 打通「召唤→agent→action→节点」并落地 fact-checker，B 落地外置 YAML 提示词运行时，C 落地 scene-generator（写作类）与 plagiarism-checker（审校类）。本 change 落地两个**重构类**专家节点：

- `editor`（章节编辑）：面向结构、连贯、节奏、情节推进与人物一致性，产出对**待修片段**的改写建议。
- `style-editor`（文风编辑）：面向句式变化、遣词、语气与节奏，在保留作者叙事与声音的前提下打磨文字。

**核心不变量约束（surgical-refactor / hunk-review「绝不整章覆盖」）**：重构类 agent 的正文写回 MUST 走局部 diff + 逐 hunk 接受，MUST NOT 整章/整节点覆盖原文。而该 diff/hunk worker 通道属 I6 `refactor-worker-runtime`，**尚未落地**（`src/core/refactor/` 仅有类型契约 + 纯拼回 helper，无 utilityProcess diff 运行时）。因此本子阶段的范围是：**把 editor/style-editor 落为可达节点**——组装片段级上下文、调其 YAML 提示词、产出**改写建议**作为对话消息呈现给作者（`author=editor`/`style-editor`），**不写回 currentDraft、不进写-审-改环、直达 END**；真正的「改写→diff→逐 hunk 拼回落库」留待 I6 通道就绪后接入。此举既让两节点即刻可召唤可达，又不违反「绝不整章覆盖」核心不变量。

参考 `references/libriscribe-prompts/editor.yml` 输出「完整改写章节（Complete revised chapter）」属整章覆盖范式，**与本项目核心不变量冲突，绝不照抄**；本 change 的提示词改写为「只产出对给定片段的改写文本」。

## What Changes

- 新增 YAML 资产 `prompts/editor.yml`、`prompts/style-editor.yml`（中文化改写自 references，重定为「片段级改写建议、不整章覆盖」）+ registry getter/内置默认。
- `context-assembler.ts`：为二者补组装策略（editor 侧重实体/伏笔/时间线以保连贯与人物一致；style-editor 只侧重实体以护角色称呼，不查伏笔/时间线）。
- `graph.ts`：`BUILT_NODES` 增二者；实现 `editorNode`/`styleEditorNode`（重构类：产改写建议对话、`currentAction→idle`、直达 END，不写 currentDraft）；接入编译图（supervisor ends、addNode、直连 END 边）。
- 拓扑无需改：`OrchestrationAction` 已含 `edit`/`restyle`，`ACTION_ROUTING`（`edit→editor`/`restyle→style-editor`）与 `NodeName`/`EXPERT_NODES` 已含二者（W 阶段契约预置）。

## Impact

- Affected specs: `orchestration-graph`（MODIFIED「supervisor 路由与专家节点」+ 2 新 Scenario：editor / style-editor 为已落地重构类节点，产片段改写建议、绝不整章覆盖、diff/hunk 落库留待 I6）。
- Affected code: `src/main/orchestration/graph.ts`、`src/main/orchestration/prompt-registry.ts`、`src/main/orchestration/context-assembler.ts`、新增 `src/main/orchestration/prompts/{editor,style-editor}.yml`。core 拓扑（`graph-topology.ts`/`action.ts`）无改动。
- 依赖 I9 子阶段 A（路由/节点范式，已归档）+ B（YAML 运行时，已归档）。diff/hunk 正文写回通道依赖 I6，本 change **不**实现该通道，仅以对话形式呈现改写建议并显式声明其为待接入的 follow-up。
- 兼容性：新增节点，既有 writer/reviewer/fact-checker/scene-generator/plagiarism-checker 路径不变；smoke/build 保持绿。
