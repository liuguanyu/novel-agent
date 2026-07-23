/**
 * 局部重构 diff 派发抽象 (I6 refactor-worker-runtime task 4.1)
 *
 * spec: refactor-worker-runtime——`computeRefactorDiff` 经本抽象派发 diff 计算：默认走 utilityProcess
 * worker（见 utility-process-diff-runner.ts），worker 不可用时回退 Main 内联（InlineDiffRunner，语义/输出一致）。
 *
 * 本文件**不依赖 Electron**：仅接口 + 纯内联实现，供 runtime.ts 与 Node 冒烟共用（冒烟无 utilityProcess）。
 * utilityProcess 具体派发（value import 'electron'）隔离在 utility-process-diff-runner.ts，仅 main/index 装配。
 */

import { computeDiffResult, type DiffResult, type RefactorFragment } from '../../core/refactor/index.js';

/** diff 计算被中断时以此错误 reject，runtime 据此下发 aborted 类别。 */
export class DiffAbortedError extends Error {
  constructor(message = '局部重构已中断') {
    super(message);
    this.name = 'DiffAbortedError';
  }
}

/** 派发一次 diff 计算。中断经 signal，中断后 MUST 以 DiffAbortedError reject。 */
export interface DiffRunner {
  run(fragment: RefactorFragment, rewrittenFragment: string, signal: AbortSignal): Promise<DiffResult>;
}

/**
 * 内联派发（回退/冒烟）：在当前进程直调纯 diff 函数。
 * spec「worker 不可用时可回退内联」——可中断、输出与 worker 路径一致。
 * 中断检查在计算前后各一次（纯 diff 极快，不切片）。
 */
export class InlineDiffRunner implements DiffRunner {
  async run(
    fragment: RefactorFragment,
    rewrittenFragment: string,
    signal: AbortSignal,
  ): Promise<DiffResult> {
    if (signal.aborted) throw new DiffAbortedError();
    const result = computeDiffResult(fragment, rewrittenFragment);
    if (signal.aborted) throw new DiffAbortedError();
    return result;
  }
}
