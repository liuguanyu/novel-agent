/**
 * utilityProcess 局部重构 diff 派发 (I6 refactor-worker-runtime task 4.2)
 *
 * spec: refactor-worker-runtime「diff 计算在 utilityProcess worker 执行」——fork diff worker、
 * 转发 compute/abort、收敛 diff-done/diff-error 为 Promise。CPU 密集 diff 在 worker，Main 不阻塞。
 *
 * 本文件**依赖 Electron**（value import 'electron' 的 utilityProcess）：仅 main/index 装配时引用，
 * 绝不被 runtime.ts / Node 冒烟直接 import（冒烟无 utilityProcess，走 InlineDiffRunner）。
 * fork 或计算失败时回退内联（InlineDiffRunner），保证功能不因 worker 不可用而中断。镜像 audit 版。
 */

import { utilityProcess } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DiffResult,
  DiffTaskResponse,
  DiffTaskRequest,
  AbortDiffTaskRequest,
  RefactorFragment,
} from '../../core/refactor/index.js';
import { DiffAbortedError, InlineDiffRunner, type DiffRunner } from './diff-runner.js';

const baseDir = dirname(fileURLToPath(import.meta.url));
/** worker 产物与 main/index 同级（electron.vite 把 worker 入口产到 out/main/diff-worker.js）。 */
const WORKER_PATH = join(baseDir, 'diff-worker.js');

/**
 * 经 utilityProcess.fork 派发 diff；fork/通信失败回退内联。
 * 每次 run 起一个短命 worker（局部重构为交互触发、低频，无需常驻）。
 */
export class UtilityProcessDiffRunner implements DiffRunner {
  readonly #fallback = new InlineDiffRunner();

  run(
    fragment: RefactorFragment,
    rewrittenFragment: string,
    signal: AbortSignal,
  ): Promise<DiffResult> {
    let child: ReturnType<typeof utilityProcess.fork>;
    try {
      child = utilityProcess.fork(WORKER_PATH);
    } catch {
      return this.#fallback.run(fragment, rewrittenFragment, signal);
    }

    return new Promise<DiffResult>((resolve, reject) => {
      const taskId = randomUUID();
      let settled = false;

      const cleanup = (): void => {
        signal.removeEventListener('abort', onAbort);
        try {
          child.kill();
        } catch {
          /* 已退出 */
        }
      };
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const onAbort = (): void => {
        const abort: AbortDiffTaskRequest = { type: 'abort-diff', taskId };
        try {
          child.postMessage(abort);
        } catch {
          /* 忽略：随后 kill */
        }
        finish(() => reject(new DiffAbortedError()));
      };

      if (signal.aborted) {
        finish(() => reject(new DiffAbortedError()));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      child.on('message', (message: DiffTaskResponse) => {
        if (message.taskId !== taskId) return;
        if (message.type === 'diff-done') {
          finish(() => resolve(message.result));
        } else if (message.type === 'diff-error') {
          const err =
            message.error.category === 'aborted'
              ? new DiffAbortedError(message.error.message)
              : new Error(message.error.message);
          finish(() => reject(err));
        }
      });

      child.on('exit', () => {
        finish(() => reject(new Error('diff worker 意外退出')));
      });

      child.once('spawn', () => {
        const request: DiffTaskRequest = {
          type: 'compute-diff',
          taskId,
          fragment,
          rewrittenFragment,
        };
        child.postMessage(request);
      });
    }).catch((err: unknown) => {
      // 通信层异常（非中断）时回退内联，保证功能可用。
      if (err instanceof DiffAbortedError) throw err;
      return this.#fallback.run(fragment, rewrittenFragment, signal);
    });
  }
}
