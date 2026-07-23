## 1. useRefactor hook（渲染层状态机）

- [x] 1.1 新增 `src/renderer/hooks/useRefactor.ts`：状态 `idle/computing/reviewing/applying/applied/failed`，`runId` 用 `crypto.randomUUID() as RunId`。
- [x] 1.2 `computeDiff(anchor: FragmentAnchorDto, rewrittenFragment)`：发 `compute-refactor-diff`，置 `computing`。
- [x] 1.3 订阅 `onControlEvent`：`refactor-diff-computed`（存 hunks/originalFragment/rewrittenFragment/anchor，进 `reviewing`，逐 hunk 默认 accept）、`refactor-diff-failed`（进 `failed`，存错误）、`refactor-applied`（进 `applied`，存 checkpointId/acceptedHunkIds，触发 onApplied 回调）、`refactor-apply-failed`（进 `failed`）；`switch` 带 `default: return prev;`，只处理本 hook runId。
- [x] 1.4 逐 hunk 本地裁决：`setDecision(hunkId, 'accept'|'reject')`。
- [x] 1.5 `apply()`：发 `apply-hunk-decisions`（携 anchor + rewrittenFragment + decisions），置 `applying`。
- [x] 1.6 `clear()` 复位到 `idle`；`exactOptionalPropertyTypes` 守卫展开。

## 2. RefactorReviewPanel（diff 双栏 + 逐 hunk 控件）

- [x] 2.1 新增 `src/renderer/components/RefactorReviewPanel.tsx`：作者输入「原片段」（默认可预填当前章节正文全文/选区）与「改写片段」，计算 diff。
- [x] 2.2 由「原片段」在当前章节正文字符串中 `indexOf` 定位得 `FragmentAnchorDto{nodeId,from,to}`；定位失败给出结构化提示，不发命令。
- [x] 2.3 diff 双栏视图：左原片段/右改写片段，按 hunk 高亮差异；每个 hunk 提供 accept/reject 控件（复用 `HunkDecisionKind` 语义，只上报意图）。
- [x] 2.4 提交裁决按钮 → 调 `apply()`；展示 `applied`（checkpointId + 接受 hunk 数）与 `failed`（错误消息 + 相关 hunkIds）。
- [x] 2.5 无选中章节或原/改片段为空时禁用相应操作。

## 3. 装配与章节重载

- [x] 3.1 `App.tsx` 引入 `useRefactor`，`onApplied` 回调重载当前章节（`selectChapter(selectedNodeId)`）。
- [x] 3.2 面板入口置顶栏（与 Story Bible/仪表盘同排），传入当前 `selectedNodeId` 与章节正文 `content`。

## 4. 校验（逐条单独跑，cwd novel-agent）

- [x] 4.1 `tsc -p tsconfig.web.json` 绿。
- [x] 4.2 `tsc -p tsconfig.node.json` 绿（未回归）。
- [x] 4.3 eslint（src/renderer 等）绿：无 any、无未用、switch default。
- [x] 4.4 `electron-vite build` 绿。
- [x] 4.5 `openspec validate refactor-review-ui --strict` 通过。
