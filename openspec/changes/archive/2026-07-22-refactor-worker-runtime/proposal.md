## Why

I6 是「实现阶段」把外科手术式局部重构的 **diff/hunk 契约**提升为本仓库**第二个 utilityProcess worker** 的一波，兑现路线图 I6「局部重构 diff/hunk worker：改文字真拼回落库」。

- `diff-engine` spec 明确「diff 计算在 utilityProcess」——大文本 diff 属 CPU 密集，MUST 在 worker 执行，主进程事件循环 MUST NOT 阻塞。契约地基（surgical-refactor，已归档）已备好 `DiffHunk`/`DiffResult`/`DiffTaskCommand`/`DiffTaskResponse` 跨进程消息与纯拼回 `spliceAcceptedHunks`，但 **diff 算法从未实现、worker 运行时从未落地**：`diff-engine.ts` 仅有类型契约，无最小差异计算。
- `hunk-review` spec 要求「逐 hunk 接受/拒绝 + 精确拼回」「绝不整章覆盖」「变更可回滚（进 checkpointer/事实版本）」。`spliceAcceptedHunks` 纯拼回已实现，但**从未接入 Main 的编排/落盘/checkpoint**——即已落地的 editor/style-editor agent 产出的片段改写建议目前无法拼回正文。
- 本仓库此前仅有一个 utilityProcess worker（I5 audit-worker）。I6 复用同一套「纯函数 + 薄壳 worker + 可注入 Runner + 内联回退」模式落地第二个 worker。

本 change 落地：Main 从选区/节点裁出待修片段（`carveFragment`）→ 把「原片段 + 改写片段」派发给 diff worker 跑最小差异 + hunk 拆分 → worker 回传 `DiffResult` → Main 据作者逐 hunk 裁决用纯函数 `spliceAcceptedHunks` 拼回 → **把拼回后的片段写回磁盘 Markdown 正文（仅接受区间替换，绝不整章覆盖）并作为可回滚步提交 checkpointer**。diff 计算收敛为**纯函数** `computeDiffResult`，worker 仅为薄壳；Main 侧经可注入的 `DiffRunner` 抽象派发并保留**内联回退**（utilityProcess 不可用/非 Electron 冒烟时降级为 Main 内联，语义/输出一致、仍可中断）。

## What Changes

- 新增 `core/refactor/diff-compute.ts`（纯函数）：`computeDiffResult(fragment, rewrittenFragment): DiffResult`——对「原片段 vs 改写片段」计算最小差异（确定性行/字级 diff）并拆分为片段内偏移升序的 `DiffHunk`（携锚点/原文/改写），hunk 天然限于片段范围。无 I/O、无 Electron，可在 Node 冒烟直调校验。`core/refactor/index.ts` 导出。
- 新增 `src/workers/diff-worker.ts`：utilityProcess 入口薄壳——`process.parentPort` 收 `compute-diff`/`abort-diff` → 调 `computeDiffResult` → 回 `diff-done`/`diff-error`；错误即消息，绝不抛异常穿越进程边界。镜像 `audit-worker.ts`。
- 新增 `main/refactor/diff-runner.ts`（不依赖 Electron）：`DiffRunner` 接口 + `InlineDiffRunner`（直调纯函数，作回退与冒烟注入）+ `DiffAbortedError`。
- 新增 `main/refactor/utility-process-diff-runner.ts`（依赖 Electron `utilityProcess`，仅 main/index 装配）：fork diff worker、转发 compute/abort、收敛 `diff-done`/`diff-error` 为 Promise；fork/通信失败回退内联。
- `electron.vite.config.ts`：main 段增加 `'diff-worker'` 入口，产到 `out/main/diff-worker.js`，供 `utilityProcess.fork` 定位。
- `main/refactor/refactor-writeback.ts`（新）：把拼回后的片段以「仅替换片段区间」的方式写回磁盘 Markdown（`readChapterContent` 读原文 → 按锚点 [from,to) splice 片段 → 写盘），MUST NOT 整章覆盖；写盘后失效工作区缓存。
- `main/orchestration/runtime.ts`：新增 `computeRefactorDiff`（派发 diff、下发 diff 控制事件）与 `applyHunkDecisions`（据裁决拼回 + 写盘 + 提交 checkpointer 作可回滚步 + 下发结果事件）；`RuntimeDeps` 增加可选 `getDiffRunner?`（缺省内联）。
- IPC 契约：`command-messages.ts` 增 `compute-refactor-diff` / `apply-hunk-decisions` 命令；`control-messages.ts` 增 `refactor-diff-*` / `refactor-applied` / `refactor-failed` 控制事件（强类型判别联合，禁 any）。preload 无需新方法（复用 `sendCommand`/`onControlEvent` 泛型通道）。
- `main/index.ts`：装配 `UtilityProcessDiffRunner` 注入 runtime。
- 冒烟：`orchestration-smoke.ts` 用 `InlineDiffRunner` 端到端验证——裁片段→计算 diff 拆 hunk→接受部分 hunk→拼回→写盘仅改接受区间（片段外原文分毫不动）→提交 checkpointer 可回滚。

**范围切分**：本 change 落地后端运行时 + IPC 契约 + 落盘 + checkpoint + 冒烟。正文轴 ProseMirror 的 diff 双栏/逐 hunk accept-reject 交互 UI（`editor-annotations` spec）留作紧随其后的**渲染层跟进子 change**（与 I10 拆分同构），不在本 change。

## Impact

- Affected specs: 新增 capability `refactor-worker-runtime`（ADDED：diff 计算在 utilityProcess worker、Main 派发原片段+改写、逐 hunk 裁决经纯函数拼回、拼回结果仅替换接受区间写回磁盘正文且绝不整章覆盖、变更作为可回滚步进 checkpointer、可中断、worker 不可用可回退内联且语义一致、diff 为纯函数可独立校验）。不改 `diff-engine`/`hunk-review`/`fragment-scoping`（本 change 是其运行层兑现，非重定义）。
- Affected code: `core/refactor/diff-compute.ts`（新，纯函数）、`core/refactor/index.ts`、`src/workers/diff-worker.ts`（新）、`main/refactor/diff-runner.ts`（新）、`main/refactor/utility-process-diff-runner.ts`（新）、`main/refactor/refactor-writeback.ts`（新）、`main/orchestration/runtime.ts`、`main/ipc-handlers.ts`、`main/index.ts`、`shared/ipc/command-messages.ts`、`shared/ipc/control-messages.ts`、`electron.vite.config.ts`、`orchestration-smoke.ts`。
- 依赖 I3（orchestration-runtime，提供控制事件/abort 账本/checkpointer 提交）+ surgical-refactor 契约（已归档，提供 fragment/diff/hunk 类型与 splice）+ persistence-sqlite（提供工作区读盘/落盘）。
- 兼容性：既有控制事件/命令协议不变，仅新增成员；正文仍是磁盘 Markdown（MUST NOT 入 SQLite）。build/lint/tsc/smoke 保持绿。utilityProcess fork 路径受 Node 冒烟环境限制无法直跑，故以内联回退保证功能、以 build 校验 worker 产物、以纯函数冒烟校验 diff/拼回正确性。
