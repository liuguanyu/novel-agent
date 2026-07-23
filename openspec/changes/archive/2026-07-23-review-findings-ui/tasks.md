## 1. IPC 契约：review-completed 控制事件

- [x] 1.1 `src/shared/ipc/control-messages.ts` 新增 `ReviewCompletedEvent` 接口（`type:'review-completed'`, `runId: RunId`, `agent: string`, `issues: ReadonlyArray<ConsistencyIssueDto>`），带中文注释说明与内容流分离。
- [x] 1.2 并入 `BackendControlEvent` 判别联合（barrel `index.ts` 经 `export *` 自动导出，无需改）。

## 2. 运行时下发 review-completed

- [x] 2.1 `src/main/orchestration/runtime.ts` 的 `#drive`：在正常完成分支与 interrupt 挂起分支后，若 `run.assembly.agent` 属审校类（reviewer/fact-checker/plagiarism-checker）且最终态 `activeBugs` 非空，经 `#sendControl` 下发 `review-completed`（`issues` 用既有 `toIssueDto` 投影）。
- [x] 2.2 从 `#graph.invoke` 的 `result` 取 `activeBugs`（interrupt 分支从 result 或 pending 取）；审校类判定用一个私有常量集合，避免魔法字符串散落。
- [x] 2.3 `graph.ts` reviewer/fact-checker/plagiarism-checker 节点：对话流回推改为简短摘要行（如「审校完成：发现 N 个问题（详见右侧卡片）」），`chatHistory` 仍保留完整 `renderReviewDialogue` 文本供后续轮模型上下文。

## 3. useReviewFindings hook

- [x] 3.1 新增 `src/renderer/hooks/useReviewFindings.ts`：订阅 `onControlEvent` 过滤 `review-completed`，按 runId 存 `{ agent, issues }`；`switch`/`if` 只处理该事件，其余忽略。
- [x] 3.2 暴露 `findingsByRun: Map/Record`、`activeFinding: { runId, index } | undefined`、`selectFinding(runId, index)`、`clearFinding()`；`exactOptionalPropertyTypes` 守卫。

## 4. FindingsPanel 审校卡片

- [x] 4.1 新增 `src/renderer/components/FindingsPanel.tsx`：把 `ConsistencyIssueDto[]` 渲染为严重度配色卡片（critical=红 / warning=琥珀 / info=灰：左边框 + 徽标），含 type/severity 徽标、描述、证据引文 blockquote、建议修复。
- [x] 4.2 点击卡片触发 `onSelect(index)`；选中态高亮卡片（环/底色）；卡片带稳定 `data-finding-id` 供连线测量。
- [x] 4.3 无 evidence.quote 的卡片不可定位，点击不触发跳转（或禁用定位视觉）。

## 5. 对话轴接线

- [x] 5.1 `DialogueAxis` 新增 props：`findingsByRun`、`activeFinding`、`onSelectFinding`、`onClearFinding`；在审校助手 turn（该 runId 有 findings）下渲染 `FindingsPanel`。
- [x] 5.2 `App.tsx` 装配 `useReviewFindings`，把 findings 与回调传入 `DialogueAxis`。

## 6. 正文定位高亮（ManuscriptAxis）

- [x] 6.1 `ManuscriptAxis` 新增自定义 ProseMirror `Decoration` 插件（PluginKey + 内联高亮 class），据引文在 `doc` 内定位得 from/to。
- [x] 6.2 用 `forwardRef` + `useImperativeHandle` 暴露 `highlightQuote(quote)`（定位、滚动到位 `scrollIntoView`、加高亮 decoration）与 `clearHighlight()`；被高亮的文本 DOM 带 `data-review-highlight` 供连线测量。
- [x] 6.3 `index.css` 加高亮样式（琥珀底色 + 圆角，明暗主题适配）。
- [x] 6.4 `App.tsx`：`activeFinding` 变化时据对应 issue 的 `evidence.quote` 调 `highlightQuote`，取消选中/换章时 `clearHighlight`。

## 7. FindingConnector 连线覆盖层

- [x] 7.1 新增 `src/renderer/components/FindingConnector.tsx`：绝对定位 SVG（`pointer-events-none`，`fixed inset-0`），测量选中卡片（`data-finding-id`）右缘与高亮文本（`data-review-highlight`）左缘 rect，画二次贝塞尔曲线，按严重度着色。
- [x] 7.2 随滚动/尺寸变化重算：对两侧滚动容器加 scroll 监听 + `ResizeObserver` + `window` resize；`requestAnimationFrame` 节流；两端任一 rect 缺失时不渲染。
- [x] 7.3 `App.tsx` 挂载 `FindingConnector`，传入 `activeFinding` 与其严重度。

## 8. 校验（逐条单独跑，cwd novel-agent）

- [x] 8.1 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` 绿。
- [x] 8.2 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json` 绿。
- [x] 8.3 `node node_modules/eslint/bin/eslint.js src/main src/preload src/shared src/renderer src/core src/workers` 绿：无 any、无未用、switch default。
- [x] 8.4 `node node_modules/electron-vite/bin/electron-vite.js build` 绿。
- [x] 8.5 `npm run smoke:orchestration` 绿（未回归）。
- [x] 8.6 `npx openspec validate review-findings-ui --strict` 通过。
