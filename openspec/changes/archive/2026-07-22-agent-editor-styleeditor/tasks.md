## 1. Specification

- [x] 1.1 orchestration-graph delta: editor（章节编辑，重构类）与 style-editor（文风编辑，重构类）为已落地专家节点——产片段级改写建议、绝不整章覆盖、正文 diff/hunk 落库留待 I6。

## 2. 提示词资产（main）

- [x] 2.1 `prompts/editor.yml`（章节编辑：结构/连贯/节奏/情节/人物一致；只产片段改写文本，绝不整章覆盖）+ registry getter/内置默认。
- [x] 2.2 `prompts/style-editor.yml`（文风编辑：句式/遣词/语气/节奏；保留作者声音与情节；只产片段改写文本）+ registry getter/内置默认。

## 3. 节点实现与接线（main）

- [x] 3.1 `context-assembler.ts`：补二者组装策略（editor 要实体/伏笔/时间线；style-editor 只要实体护称呼）。
- [x] 3.2 `graph.ts`：`editorNode`（重构类：组装片段上下文 + 调 editor 提示词 → 产改写建议对话、`author=editor`、`currentAction→idle`、不写 currentDraft、直达 END）。
- [x] 3.3 `graph.ts`：`styleEditorNode`（同构，用 style-editor 提示词与策略）。
- [x] 3.4 `graph.ts`：`BUILT_NODES` 增二者；supervisor ends + addNode + 直连 END 边接入编译图。

## 4. Validation

- [x] 4.1 Run node and web TypeScript checks.
- [x] 4.2 Run ESLint.
- [x] 4.3 Run OpenSpec strict validation.
- [x] 4.4 Run production build（确认二 YAML 拷入产物）。
- [x] 4.5 Run `smoke:orchestration`（既有路径全绿；新节点可达）。
