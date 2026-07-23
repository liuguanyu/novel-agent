## 1. 重构面板支持程序化预填

- [x] 1.1 `RefactorReviewPanel` 新增可选 prop `prefill?: { readonly original: string; readonly rewritten: string }`
- [x] 1.2 当面板打开且 `prefill` 引用变化时，把 `prefill.original` / `prefill.rewritten` 写入 `original` / `rewritten` 输入态（`useEffect` 依赖 `open` + `prefill`），并清空 `localError`
- [x] 1.3 保留手动录入路径：无 prefill 时行为不变；预填后作者仍可编辑再「计算差异」

## 2. 审校卡片新增采纳入口

- [x] 2.1 `FindingsPanel` / `FindingCard` 新增回调 prop `onAdopt?: (issue: ConsistencyIssueDto) => void`
- [x] 2.2 卡片在 `evidence.quote` 非空时渲染「采纳并修改」按钮；点击调 `onAdopt(issue)` 且 `stopPropagation`（不触发卡片定位选中）

## 3. 回调贯通与 App 接线

- [x] 3.1 `DialogueAxis` 透传 `onAdoptFinding: (issue) => void` 到每个 `FindingsPanel`
- [x] 3.2 `App.tsx` 新增 `refactorPrefill` 态与 `handleAdoptFinding(issue)`：设 prefill = `{ original: issue.evidence.quote, rewritten: issue.suggestedFix ?? '' }`，`setRefactorOpen(true)`
- [x] 3.3 `App.tsx` 把 `prefill={refactorPrefill}` 传入 `RefactorReviewPanel`，把 `onAdoptFinding` 传入 `DialogueAxis`

## 4. 校验

- [x] 4.1 `tsc -p tsconfig.node.json` / `tsc -p tsconfig.web.json` 通过
- [x] 4.2 eslint 通过
- [x] 4.3 `electron-vite build` 通过
- [x] 4.4 `npm run smoke:orchestration` 通过
- [x] 4.5 `openspec validate adopt-finding-refactor --strict` 通过
