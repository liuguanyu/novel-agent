/**
 * utilityProcess 素材 embedding 派发 (I7 corpus-worker-runtime task 4.2)
 *
 * spec: corpus-worker-runtime「查询 embedding 在 utilityProcess worker 执行」——fork embed worker、
 * 转发 embed-texts/abort-embed、收敛 embed-done/embed-error 为 Promise。CPU 密集 embedding 在 worker，Main 不阻塞。
 *
 * 本文件**依赖 Electron**（value import 'electron' 的 utilityProcess）：仅 main/index 装配时引用，
 * 绝不被 runtime.ts / Node 冒烟直接 import（冒烟无 utilityProcess，走 InlineEmbedRunner）。
 * fork 或计算失败时回退内联（InlineEmbedRunner），保证功能不因 worker 不可用而中断。镜像 diff/audit 版。
 */

import { utilityProcess } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CorpusTaskResponse,
  EmbedTextsTaskRequest,
  AbortEmbedTaskRequest,
  EmbeddingVector,
} from '../../core/corpus/index.js';
import { EmbedAbortedError, InlineEmbedRunner, type EmbedRunner } from './embed-runner.js';

const baseDir = dirname(fileURLToPath(import.meta.url));
/** worker 产物与 main/index 同级（electron.vite 把 worker 入口产到 out/main/embed-worker.js）。 */
const WORKER_PATH = join(baseDir, 'embed-worker.js');

/**
 * 经 utilityProcess.fork 派发 embedding；fork/通信失败回退内联。
 * 每次 run 起一个短命 worker（检索为交互触发、低频，无需常驻）。
 */
export class UtilityProcessEmbedRunner implements EmbedRunner {
  readonly #fallback = new InlineEmbedRunner();

  run(texts: ReadonlyArray<string>, signal: AbortSignal): Promise<EmbeddingVector[]> {
    let child: ReturnType<typeof utilityProcess.fork>;
    try {
      child = utilityProcess.fork(WORKER_PATH);
    } catch {
      return this.#fallback.run(texts, signal);
    }

    return new Promise<EmbeddingVector[]>((resolve, reject) => {
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
        const abort: AbortEmbedTaskRequest = { type: 'abort-embed', taskId };
        try {
          child.postMessage(abort);
        } catch {
          /* 忽略：随后 kill */
        }
        finish(() => reject(new EmbedAbortedError()));
      };

      if (signal.aborted) {
        finish(() => reject(new EmbedAbortedError()));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      child.on('message', (message: CorpusTaskResponse) => {
        if (message.taskId !== taskId) return;
        if (message.type === 'embed-done') {
          finish(() => resolve(message.vectors.map((v) => [...v])));
        } else if (message.type === 'embed-error') {
          const err =
            message.error.category === 'aborted'
              ? new EmbedAbortedError(message.error.message)
              : new Error(message.error.message);
          finish(() => reject(err));
        }
        // embed-progress：本 change 不分批上报，忽略。
      });

      child.on('exit', () => {
        finish(() => reject(new Error('embed worker 意外退出')));
      });

      child.once('spawn', () => {
        const request: EmbedTextsTaskRequest = {
          type: 'embed-texts',
          taskId,
          texts,
        };
        child.postMessage(request);
      });
    }).catch((err: unknown) => {
      // 通信层异常（非中断）时回退内联，保证功能可用。
      if (err instanceof EmbedAbortedError) throw err;
      return this.#fallback.run(texts, signal);
    });
  }
}
