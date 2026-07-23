/**
 * utilityProcess 总检派发 (I5 audit-worker-runtime tasks 4.1, 3.x)
 *
 * spec: audit-worker-runtime「全书总检在 utilityProcess worker 执行」——fork audit worker、
 * 转发 start/abort、收敛 audit-done/audit-error 为 Promise。CPU 密集对撞在 worker，Main 不阻塞。
 *
 * 本文件**依赖 Electron**（value import 'electron' 的 utilityProcess）：仅 main/index 装配时引用，
 * 绝不被 runtime.ts / Node 冒烟直接 import（冒烟无 utilityProcess，走 InlineAuditRunner）。
 * fork 或计算失败时回退内联（InlineAuditRunner），保证功能不因 worker 不可用而中断。
 */

import { utilityProcess } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AuditTaskResponse,
  AuditTaskResult,
  StartAuditTaskRequest,
  AbortAuditTaskRequest,
} from '../../core/audit/index.js';
import type { AuditRun } from '../../core/audit/index.js';
import type { FactView } from '../../core/story-bible/index.js';
import { AuditAbortedError, InlineAuditRunner, type AuditRunner } from './audit-runner.js';

const baseDir = dirname(fileURLToPath(import.meta.url));
/** worker 产物与 main/index 同级（electron.vite 把 worker 入口产到 out/main/audit-worker.js）。 */
const WORKER_PATH = join(baseDir, 'audit-worker.js');

/**
 * 经 utilityProcess.fork 派发总检；fork/通信失败回退内联。
 * 每次 run 起一个短命 worker（总检为离线批处理、低频手动触发，无需常驻）。
 */
export class UtilityProcessAuditRunner implements AuditRunner {
  readonly #fallback = new InlineAuditRunner();

  run(snapshot: FactView, signal: AbortSignal): Promise<AuditTaskResult> {
    let child: ReturnType<typeof utilityProcess.fork>;
    try {
      child = utilityProcess.fork(WORKER_PATH);
    } catch {
      // utilityProcess 不可用（如 fork 失败）：回退内联，语义/输出一致。
      return this.#fallback.run(snapshot, signal);
    }

    return new Promise<AuditTaskResult>((resolve, reject) => {
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
        const abort: AbortAuditTaskRequest = { type: 'abort-audit', taskId };
        try {
          child.postMessage(abort);
        } catch {
          /* 忽略：随后 kill */
        }
        finish(() => reject(new AuditAbortedError()));
      };

      if (signal.aborted) {
        finish(() => reject(new AuditAbortedError()));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      child.on('message', (message: AuditTaskResponse) => {
        if (message.taskId !== taskId) return;
        if (message.type === 'audit-done') {
          finish(() => resolve(message.result));
        } else if (message.type === 'audit-error') {
          const err =
            message.error.category === 'aborted'
              ? new AuditAbortedError(message.error.message)
              : new Error(message.error.message);
          finish(() => reject(err));
        }
      });

      child.on('exit', () => {
        finish(() => reject(new Error('audit worker 意外退出')));
      });

      const run: AuditRun = { runId: taskId, startedAt: Date.now(), scopeHint: 'whole-book' };
      child.once('spawn', () => {
        const start: StartAuditTaskRequest = { type: 'start-audit', taskId, run, snapshot };
        child.postMessage(start);
      });
    }).catch((err: unknown) => {
      // 通信层异常（非中断）时回退内联，保证功能可用。
      if (err instanceof AuditAbortedError) throw err;
      return this.#fallback.run(snapshot, signal);
    });
  }
}
