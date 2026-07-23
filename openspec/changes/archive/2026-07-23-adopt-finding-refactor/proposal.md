## Why

审校结构化卡片（`review-findings-ui`）已让作者能看到分级问题、点击跳原文并高亮；局部重构改写审阅面板（`refactor-review-ui`）也已能把「原片段 + 改写片段」算 diff、逐 hunk 裁决并拼回落盘。但两者之间**没有桥**：作者看到一条审校发现后，要修改它，只能手动把证据引文复制到重构面板的「原片段」、再把建议修复复制到「改写片段」，然后手动打开面板。这一步纯手工、易错、割裂了「审校 → 修改」的心流。

本 change 把审校卡片直接接到既有重构管线：带证据引文的卡片新增「采纳并修改」按钮，点击即以证据引文预填「原片段」、以建议修复预填「改写片段」，并打开重构审阅面板进入既有 diff → 逐 hunk → 落盘流程。纯渲染层接线，**不改后端、不加管线、不动 IPC 协议**。

## What Changes

- **重构面板可程序化预填**：`RefactorReviewPanel` 新增可选 prop `prefill?: { original: string; rewritten: string }`；当面板由采纳动作打开且 prefill 变化时，将其写入 `original`/`rewritten` 输入态，作者仍可编辑后再计算差异。手动录入路径完全保留。
- **审校卡片新增采纳入口**：`FindingsPanel` 的 `FindingCard` 在存在 `evidence.quote` 时渲染「采纳并修改」按钮，点击调新增回调 `onAdopt(issue)`（按钮点击不触发卡片的定位选中）。
- **回调贯通**：`onAdopt` 经 `FindingsPanel` → `DialogueAxis` → `App.tsx` 逐层透传。
- **App 接线**：`App.tsx` 新增 `handleAdoptFinding(issue)`，以 `issue.evidence.quote` 为原片段、`issue.suggestedFix ?? ''` 为改写片段设置 prefill 态，并 `setRefactorOpen(true)`。证据引文常含省略号（`……`）而非正文逐字子串，预填后由 `locateAnchor` 校验；定位失败时面板已有结构化提示，作者据提示微调原片段即可（可接受 UX，不引入回退定位复杂度）。

## Impact

- Affected specs: `refactor-review-ui`（MODIFIED：面板 MUST 支持由审校发现程序化预填「原片段 / 改写片段」并打开）。
- Affected code: `src/renderer/components/RefactorReviewPanel.tsx`、`src/renderer/components/FindingsPanel.tsx`、`src/renderer/components/DialogueAxis.tsx`、`src/renderer/App.tsx`。
- 兼容性：无后端 / IPC / preload 改动；`refactor-*` 与 `review-completed` 事件协议不变；手动录入重构与卡片点击定位两条既有路径均不受影响。tsc(node/web)/eslint/build/smoke:orchestration 保持绿。
