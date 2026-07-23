/**
 * 局部重构 diff utilityProcess worker 入口 (I6 refactor-worker-runtime task 3.1)
 *
 * spec: refactor-worker-runtime——CPU 密集的最小差异 + hunk 拆分在 utilityProcess 执行。
 * 本文件为**薄壳**：经 process.parentPort 收 compute-diff/abort-diff 任务消息 → 调纯函数
 * computeDiffResult → 回 diff-done/diff-error；无业务算法（算法在 core/refactor/diff-compute.ts），
 * 不读 SQLite/磁盘正文（只据 Main 传入的原片段 + 改写片段计算）。
 *
 * 错误即消息：计算异常以 diff-error 回传，绝不抛异常穿越进程边界。镜像 audit-worker.ts。
 */

import {
  computeDiffResult,
  type DiffTaskCommand,
  type DiffTaskResponse,
} from '../core/refactor/index.js';

/** utilityProcess 由 Electron 在 process 上注入 parentPort。 */
const parentPort = process.parentPort;

/** 已请求中止的 taskId 集合：compute 前若已收到 abort 则直接回 aborted。 */
const aborted = new Set<string>();

function post(message: DiffTaskResponse): void {
  parentPort.postMessage(message);
}

parentPort.on('message', (event: { data: DiffTaskCommand }) => {
  const command = event.data;
  if (command.type === 'abort-diff') {
    aborted.add(command.taskId);
    return;
  }
  // compute-diff
  const { taskId, fragment, rewrittenFragment } = command;
  if (aborted.has(taskId)) {
    post({ type: 'diff-error', taskId, error: { category: 'aborted', message: '局部重构已中断' } });
    return;
  }
  try {
    const result = computeDiffResult(fragment, rewrittenFragment);
    if (aborted.has(taskId)) {
      post({ type: 'diff-error', taskId, error: { category: 'aborted', message: '局部重构已中断' } });
      return;
    }
    post({ type: 'diff-done', taskId, result });
  } catch (err) {
    post({
      type: 'diff-error',
      taskId,
      error: { category: 'internal', message: err instanceof Error ? err.message : String(err) },
    });
  }
});
