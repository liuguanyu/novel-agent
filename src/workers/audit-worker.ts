/**
 * 全书总检 utilityProcess worker 入口 (I5 audit-worker-runtime task 3.1)
 *
 * spec: audit-worker-runtime——CPU 密集的 Map-Reduce 骨架对撞在 utilityProcess 执行。
 * 本文件为**薄壳**：经 process.parentPort 收 start/abort 任务消息 → 调纯函数 runAuditTask → 回 done/error；
 * 无业务算法（算法在 core/audit/audit-task-runner.ts 纯函数），不读 SQLite/文件（只据 Main 传入快照计算）。
 *
 * 错误即消息：计算异常以 audit-error 回传，绝不抛异常穿越进程边界。
 */

import { runAuditTask, type AuditTaskCommand, type AuditTaskResponse } from '../core/audit/index.js';

/** utilityProcess 由 Electron 在 process 上注入 parentPort（类型见 electron 声明）。 */
const parentPort = process.parentPort;

/** 已请求中止的 taskId 集合：start 前若已收到 abort 则直接回 aborted。 */
const aborted = new Set<string>();

function post(message: AuditTaskResponse): void {
  parentPort.postMessage(message);
}

parentPort.on('message', (event: { data: AuditTaskCommand }) => {
  const command = event.data;
  if (command.type === 'abort-audit') {
    aborted.add(command.taskId);
    return;
  }
  // start-audit
  const { taskId, snapshot } = command;
  if (aborted.has(taskId)) {
    post({ type: 'audit-error', taskId, error: { category: 'aborted', message: '全书总检已中断' } });
    return;
  }
  try {
    const result = runAuditTask(snapshot);
    if (aborted.has(taskId)) {
      post({ type: 'audit-error', taskId, error: { category: 'aborted', message: '全书总检已中断' } });
      return;
    }
    post({ type: 'audit-done', taskId, result });
  } catch (err) {
    post({
      type: 'audit-error',
      taskId,
      error: { category: 'internal', message: err instanceof Error ? err.message : String(err) },
    });
  }
});
