/**
 * 素材 embedding utilityProcess worker 入口 (I7 corpus-worker-runtime task 3.1)
 *
 * spec: corpus-worker-runtime——CPU 密集的 embedding 计算在 utilityProcess 执行，不阻塞主进程。
 * 本文件为**薄壳**：经 process.parentPort 收 embed-texts/embed-candidates/abort-embed 任务消息 →
 * 调纯函数 computeEmbeddings → 回 embed-done/embed-error；无业务算法（算法在 core/corpus/corpus-embedding.ts），
 * 不读 SQLite/磁盘（只据 Main 传入的文本/候选内容计算）。
 *
 * 错误即消息：计算异常以 embed-error 回传，绝不抛异常穿越进程边界。镜像 diff-worker.ts / audit-worker.ts。
 */

import {
  computeEmbeddings,
  type CorpusTaskRequest,
  type CorpusTaskResponse,
} from '../core/corpus/index.js';

/** utilityProcess 由 Electron 在 process 上注入 parentPort。 */
const parentPort = process.parentPort;

/** 已请求中止的 taskId 集合：compute 前若已收到 abort 则直接回 aborted。 */
const aborted = new Set<string>();

function post(message: CorpusTaskResponse): void {
  parentPort.postMessage(message);
}

parentPort.on('message', (event: { data: CorpusTaskRequest }) => {
  const command = event.data;
  if (command.type === 'abort-embed') {
    aborted.add(command.taskId);
    return;
  }
  const { taskId } = command;
  if (aborted.has(taskId)) {
    post({ type: 'embed-error', taskId, error: { category: 'aborted', message: '素材检索已中断' } });
    return;
  }
  try {
    const texts =
      command.type === 'embed-texts'
        ? command.texts
        : command.candidates.map((c) => c.content);
    const vectors = computeEmbeddings(texts);
    if (aborted.has(taskId)) {
      post({ type: 'embed-error', taskId, error: { category: 'aborted', message: '素材检索已中断' } });
      return;
    }
    post({ type: 'embed-done', taskId, vectors });
  } catch (err) {
    post({
      type: 'embed-error',
      taskId,
      error: { category: 'internal', message: err instanceof Error ? err.message : String(err) },
    });
  }
});
