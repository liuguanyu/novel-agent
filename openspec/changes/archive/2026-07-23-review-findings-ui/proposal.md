## Why

审校类 agent（reviewer / fact-checker / plagiarism-checker）诊断出的一致性问题目前只以 `renderReviewDialogue()` 拼成的**纯文本**经对话流回推，落成一个普通聊天气泡。结构化的 `ConsistencyIssue[]` 仅进入 `state.activeBugs`，除非 `requiresHumanDecision=true` 触发 `interrupt-raised`，否则**从不以结构化形态下行到渲染层**。作者因此拿不到严重度配色、原文证据、建议修复的分级卡片，也无法从某条问题一键跳到正文原文处。

这是「审校 → 定位 → 修改」工作流的地基。本 change 让审校结果以**结构化卡片**呈现（严重=红 / 警告=琥珀 / 提示=灰），点击卡片即滚动正文到证据引文并高亮，并在卡片与高亮文本之间画一条 SVG 连线，形成清晰的视觉指向。

## What Changes

- **IPC 契约**：`src/shared/ipc/control-messages.ts` 新增 `ReviewCompletedEvent`（`type:'review-completed'`, `runId`, `agent`, `issues: ConsistencyIssueDto[]`），并入 `BackendControlEvent` 判别联合（barrel 自动导出）。
- **运行时下发**：`src/main/orchestration/runtime.ts` 的 `#drive` 在审校类运行结束（正常完成或 interrupt 挂起）时，检查最终态 `activeBugs`，非空则经 `#sendControl` 下发 `review-completed`（复用既有 `toIssueDto` 投影）。审校类 agent 由 `run.assembly.agent` 判定。
- **渲染层 hook**：新增 `src/renderer/hooks/useReviewFindings.ts`，订阅 `onControlEvent` 过滤 `review-completed`，按 runId 存问题集；暴露 `findingsByRun`、`activeFinding`、`selectFinding(runId, index)`、`clearFinding()`。
- **审校卡片**：新增 `src/renderer/components/FindingsPanel.tsx`，把 `ConsistencyIssueDto[]` 渲染为严重度配色卡片（左边框 + 徽标着色），含描述、证据引文、建议修复；点击卡片调 `selectFinding` 触发定位。
- **对话轴接线**：`DialogueAxis` 在审校助手 turn 下渲染 `FindingsPanel`（替代裸文本详情），经 `App.tsx` 传入 findings 与选中回调。
- **正文定位高亮**：`ManuscriptAxis` 接入自定义 ProseMirror `Decoration` 插件，暴露 `highlightQuote(quote)` / `clearHighlight()`（经 ref）；据证据引文在文档中定位、滚动到位并加高亮类。
- **连线覆盖层**：新增 `src/renderer/components/FindingConnector.tsx`，绝对定位 SVG 跨三栏，测量选中卡片右缘与高亮文本左缘的 `getBoundingClientRect`，画按严重度着色的贝塞尔曲线；随滚动/尺寸变化经 `ResizeObserver` + scroll 监听重算。
- 无需新增 preload 方法（复用 `sendCommand`/`onControlEvent`）。审校节点仍在 `chatHistory` 保留完整文本（供后续轮模型上下文），但对话流只回推简短摘要行，详情由卡片承载。

## Impact

- Affected specs: `ipc-contract`（MODIFIED：控制事件目录新增 `review-completed`）、`renderer-editor`（MODIFIED：编辑器 MUST 支持按证据引文的程序化滚动定位 + 高亮 decoration）、新增 capability `review-findings-ui`（ADDED：结构化审校卡片、点击定位高亮、连线指向）。
- Affected code: `src/shared/ipc/control-messages.ts`、`src/main/orchestration/runtime.ts`、`src/main/orchestration/graph.ts`（审校对话文本瘦身，可选）、`src/renderer/hooks/useReviewFindings.ts`（新）、`src/renderer/components/FindingsPanel.tsx`（新）、`src/renderer/components/FindingConnector.tsx`（新）、`src/renderer/components/ManuscriptAxis.tsx`、`src/renderer/components/DialogueAxis.tsx`、`src/renderer/App.tsx`。
- 兼容性：既有命令/控制事件协议不变，仅新增一个下行事件成员；`interrupt-raised` 裁决通路不动。tsc(node/web)/eslint/build/smoke:orchestration 保持绿。
