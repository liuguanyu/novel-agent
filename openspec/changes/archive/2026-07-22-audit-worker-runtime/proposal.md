## Why

I5 是「实现阶段」把全书总检的 Map-Reduce 从 **Main 内联同步执行**提升为 **utilityProcess worker** 的一波。

- `process-model` spec 明确「全书 Map-Reduce 总检」属 CPU 密集，MUST 在 utilityProcess/worker 执行，长任务 MUST NOT 阻塞 Main 事件循环与 IPC。
- `map-reduce-audit` spec 的「首版骨架对撞可降级」允许 MVP 在 Main 侧执行——当前 `runGlobalAudit`（runtime.ts）正是走该降级路径：`runGlobalAuditOnView` 在 Main 同步跑完对撞。
- 契约地基阶段已备好 worker 任务契约 `core/audit/audit-worker-task.ts`（`StartAuditTaskRequest`/`AbortAuditTaskRequest` ↔ `audit-progress`/`audit-done`/`audit-error`），但**运行层从未落地 worker**。本仓库此前无任何 utilityProcess 运行时。

本 change 落地本仓库**首个 utilityProcess worker**：Main 读事实库快照（`FactView`，纯可序列化）→ 派发给 audit worker 跑 Map-Reduce 对撞 → worker 回传进度/结果 → Main 聚合评分下发既有 `global-audit-*` 控制事件。为守住「无 Electron 也能冒烟」与「fork 失败不致命」，把对撞计算收敛为**纯函数**（`runAuditTask`），worker 仅为薄壳；Main 侧经可注入的 `AuditRunner` 抽象派发，并保留**内联回退**（utilityProcess 不可用时降级为 Main 内联，语义/输出一致、仍可中断）。

## What Changes

- 扩展 `core/audit/audit-worker-task.ts`：`StartAuditTaskRequest` 携带 worker 自足所需的 `FactView` 快照（worker 读不到 SQLite）；`AuditDoneMessage` 已含 `ReduceOutput`，补 worker 侧计算所需的评分/计数投影所需字段（或在 Main 聚合，见下）。保持判别联合 + taskId 关联 + 错误即消息。
- 新增 `core/audit/audit-task-runner.ts`（纯函数）：`runAuditTask(input): AuditTaskResult`——把 `FactView` 跑成 `GlobalAuditResult` 等价物（复用现有 detect* 对撞与评分逻辑，从 `main/audit/global-audit.ts` 抽出纯部分到 core 或就地复用）。无 I/O、无 Electron、可在 Node 冒烟直调。
- 新增 `src/worker/audit-worker.ts`：utilityProcess 入口薄壳——`parentPort` 收 `StartAuditTaskRequest` → 调 `runAuditTask` → 回 `audit-done`/`audit-error`；收 `AbortAuditTaskRequest` 置中止标志。仅编排消息与纯函数，无业务算法。
- `electron.vite.config.ts`：main 段增加 worker 入口（`out/main/audit-worker.js` 或独立 `out/worker/`），使 `utilityProcess.fork` 可定位产物。
- `main/audit/audit-runner.ts`（新）：`AuditRunner` 接口 + `UtilityProcessAuditRunner`（fork worker、转发 start/abort、收敛响应）+ `InlineAuditRunner`（直调 `runAuditTask`，作回退与冒烟注入）。
- `main/orchestration/runtime.ts`：`runGlobalAudit` 改为经注入的 `AuditRunner` 派发（默认 utilityProcess，fork 不可用回退内联），保留既有 `global-audit-started/progress/completed/failed` 控制事件与 abort 中断语义；`RuntimeDeps` 增加 `getAuditRunner?`（缺省内联，保后向兼容）。
- `main/index.ts`：装配 `UtilityProcessAuditRunner` 注入 runtime。
- 冒烟：`orchestration-smoke.ts` 用 `InlineAuditRunner`（Node 无 utilityProcess）验证总检端到端仍产红黄牌 + 中断路径。

## Impact

- Affected specs: 新增 capability `audit-worker-runtime`（ADDED：全书总检运行在 utilityProcess worker、Main 读快照派发、进度/结果经既有控制事件、可中断、fork 不可用可回退内联且语义一致）。不改 `process-model`/`map-reduce-audit`（本 change 是其运行层兑现，非重定义）。
- Affected code: `core/audit/audit-worker-task.ts`（扩契约）、`core/audit/audit-task-runner.ts`（新，纯函数）、`src/worker/audit-worker.ts`（新，worker 入口）、`main/audit/audit-runner.ts`（新）、`main/audit/global-audit.ts`（抽纯部分/复用）、`main/orchestration/runtime.ts`、`main/index.ts`、`electron.vite.config.ts`、`orchestration-smoke.ts`。
- 依赖 I3（orchestration-runtime，已归档，提供 `runGlobalAudit`/控制事件/abort 账本）+ global-audit 契约（已归档）。
- 兼容性：控制事件协议不变、仪表盘 DTO 不变；仅把计算位置从 Main 内联迁到 worker（带内联回退）。build/lint/tsc/smoke 保持绿。utilityProcess fork 路径受 Node 冒烟环境限制无法直跑，故以内联回退保证功能、以 build 校验 worker 产物、以纯函数冒烟校验对撞正确性。
