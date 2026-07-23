## 1. Specification

- [x] 1.1 新增 capability `refactor-worker-runtime` delta（ADDED：diff 在 utilityProcess worker、Main 派发原片段+改写、逐 hunk 裁决纯函数拼回、仅替换接受区间写回磁盘正文且绝不整章覆盖、变更进 checkpointer 可回滚、可中断、内联回退且语义一致、diff 纯函数可校验）。

## 2. 契约与纯计算（core）

- [x] 2.1 新增 `core/refactor/diff-compute.ts`：纯函数 `computeDiffResult(fragment, rewrittenFragment): DiffResult`，确定性最小差异 + hunk 拆分（片段内偏移升序，携锚点/原文/改写），hunk 限于片段范围；无 I/O、无 Electron。
- [x] 2.2 `core/refactor/index.ts`：导出 `diff-compute` 出口。

## 3. worker 入口

- [x] 3.1 新增 `src/workers/diff-worker.ts`：utilityProcess 薄壳，`parentPort` 收 compute-diff/abort-diff、调 `computeDiffResult`、回 diff-done/diff-error（错误即消息）。
- [x] 3.2 `electron.vite.config.ts`：main 段加 `diff-worker` 入口，产到 `out/main/diff-worker.js`。

## 4. Main 派发、落盘与接线

- [x] 4.1 新增 `main/refactor/diff-runner.ts`：`DiffRunner` 接口 + `InlineDiffRunner`（直调纯函数）+ `DiffAbortedError`。
- [x] 4.2 新增 `main/refactor/utility-process-diff-runner.ts`：fork diff worker、转发 compute/abort、收敛响应；fork/通信失败回退内联。
- [x] 4.3 新增 `main/refactor/refactor-writeback.ts`：拼回后的片段仅替换锚点区间写回磁盘 Markdown（读原文→按 [from,to) splice→写盘→失效缓存），绝不整章覆盖。
- [x] 4.4 `shared/ipc/command-messages.ts`：增 `compute-refactor-diff` / `apply-hunk-decisions` 命令并入判别联合。
- [x] 4.5 `shared/ipc/control-messages.ts`：增 `refactor-diff-computed` / `refactor-diff-failed` / `refactor-applied` / `refactor-apply-failed` 控制事件并入判别联合。
- [x] 4.6 `main/orchestration/runtime.ts`：新增 `computeRefactorDiff`（派发 diff + 下发事件）与 `applyHunkDecisions`（裁决→拼回→写盘→提交 checkpointer→下发事件）；`RuntimeDeps` 加可选 `getDiffRunner`。
- [x] 4.7 `main/ipc-handlers.ts`：接 `compute-refactor-diff` / `apply-hunk-decisions` 委托 runtime。
- [x] 4.8 `main/index.ts`：装配 `UtilityProcessDiffRunner` 注入 runtime。

## 5. 冒烟与校验

- [x] 5.1 `orchestration-smoke.ts`：用 `InlineDiffRunner` 验证 裁片段→diff 拆 hunk→接受部分 hunk→拼回仅改接受区间（片段外不动）→写盘→checkpointer 可回滚。
- [x] 5.2 Run node and web TypeScript checks.
- [x] 5.3 Run ESLint.
- [x] 5.4 Run OpenSpec strict validation.
- [x] 5.5 Run production build（校验 diff-worker 产物）。
- [x] 5.6 Run orchestration smoke。
