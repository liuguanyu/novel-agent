## 1. Specification

- [x] 1.1 新增 capability `audit-worker-runtime` delta（ADDED：worker 执行、快照派发、控制事件下发、可中断、内联回退且语义一致、纯函数可校验）。

## 2. 契约与纯计算（core）

- [x] 2.1 扩展 `core/audit/audit-worker-task.ts`：`StartAuditTaskRequest` 携带 `FactView` 快照（worker 自足）；补齐 worker→Main 响应所需字段（评分/计数在 Main 聚合，worker 回传问题集）。
- [x] 2.2 新增 `core/audit/audit-task-runner.ts`：纯函数 `runAuditTask(snapshot): AuditTaskResult`，复用现有 detect* 对撞 + 评分逻辑，无 I/O、无 Electron。
- [x] 2.3 `core/audit/index.ts`：导出新增出口。

## 3. worker 入口

- [x] 3.1 新增 `src/worker/audit-worker.ts`：utilityProcess 薄壳，`parentPort` 收 start/abort、调 `runAuditTask`、回 done/error。
- [x] 3.2 `electron.vite.config.ts`：main 段加 worker 入口，产物可被 `utilityProcess.fork` 定位。

## 4. Main 派发与接线

- [x] 4.1 新增 `main/audit/audit-runner.ts`：`AuditRunner` 接口 + `UtilityProcessAuditRunner`（fork/转发/收敛）+ `InlineAuditRunner`（直调纯函数，回退与冒烟）。
- [x] 4.2 `main/orchestration/runtime.ts`：`runGlobalAudit` 经注入 `AuditRunner` 派发（默认 utilityProcess，fork 不可用回退内联），保留控制事件与 abort；`RuntimeDeps` 加可选 `getAuditRunner`。
- [x] 4.3 `main/index.ts`：装配 `UtilityProcessAuditRunner` 注入 runtime。
- [x] 4.4 `main/audit/global-audit.ts`：抽出纯对撞部分供 runner 复用（或 runner 直接复用现有导出）。

## 5. 冒烟与校验

- [x] 5.1 `orchestration-smoke.ts`：用 `InlineAuditRunner` 验证总检端到端仍产红黄牌 + abort 中断路径。
- [x] 5.2 Run node and web TypeScript checks.
- [x] 5.3 Run ESLint.
- [x] 5.4 Run OpenSpec strict validation.
- [x] 5.5 Run production build（校验 worker 产物）。
- [x] 5.6 Run orchestration smoke。
