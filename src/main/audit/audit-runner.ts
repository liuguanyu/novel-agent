/**
 * 全书总检派发抽象 (I5 audit-worker-runtime task 4.1)
 *
 * spec: audit-worker-runtime——`runGlobalAudit` 经本抽象派发总检对撞：默认走 utilityProcess worker
 * （见 utility-process-audit-runner.ts），worker 不可用时回退 Main 内联（InlineAuditRunner，语义/输出一致）。
 *
 * 本文件**不依赖 Electron**：仅接口 + 纯内联实现，供 runtime.ts 与 Node 冒烟共用（冒烟无 utilityProcess）。
 * utilityProcess 具体派发（value import 'electron'）隔离在 utility-process-audit-runner.ts，仅 main/index 装配。
 */

import { runAuditTask, type AuditTaskResult } from '../../core/audit/index.js';
import type { FactView } from '../../core/story-bible/index.js';

/** 总检被中断时以此错误 reject，runtime 据此下发 aborted 类别。 */
export class AuditAbortedError extends Error {
  constructor(message = '全书总检已中断') {
    super(message);
    this.name = 'AuditAbortedError';
  }
}

/** 派发一次总检对撞。中断经 signal，中断后 MUST 以 AuditAbortedError reject。 */
export interface AuditRunner {
  run(snapshot: FactView, signal: AbortSignal): Promise<AuditTaskResult>;
}

/**
 * 内联派发（回退/冒烟）：在当前进程直调纯对撞函数。
 * spec「worker 不可用时可回退内联」——只读快照、可中断、输出与 worker 路径一致。
 * 中断检查在计算前后各一次（纯对撞极快，不切片；与既有 Main 内联 MVP 行为一致）。
 */
export class InlineAuditRunner implements AuditRunner {
  async run(snapshot: FactView, signal: AbortSignal): Promise<AuditTaskResult> {
    if (signal.aborted) throw new AuditAbortedError();
    const result = runAuditTask(snapshot);
    if (signal.aborted) throw new AuditAbortedError();
    return result;
  }
}
