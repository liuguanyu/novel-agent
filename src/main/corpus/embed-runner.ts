/**
 * 素材 embedding 派发抽象 (I7 corpus-worker-runtime task 4.1)
 *
 * spec: corpus-worker-runtime——`retrieveCorpus` 经本抽象派发 embedding 计算：默认走 utilityProcess
 * worker（见 utility-process-embed-runner.ts），worker 不可用时回退 Main 内联（InlineEmbedRunner，语义/输出一致）。
 *
 * 本文件**不依赖 Electron**：仅接口 + 纯内联实现，供 runtime.ts 与 Node 冒烟共用（冒烟无 utilityProcess）。
 * utilityProcess 具体派发（value import 'electron'）隔离在 utility-process-embed-runner.ts，仅 main/index 装配。
 */

import { computeEmbeddings, type EmbeddingVector } from '../../core/corpus/index.js';

/** embedding 计算被中断时以此错误 reject，runtime 据此下发 aborted 类别。 */
export class EmbedAbortedError extends Error {
  constructor(message = '素材检索已中断') {
    super(message);
    this.name = 'EmbedAbortedError';
  }
}

/** 派发一批文本的 embedding 计算。中断经 signal，中断后 MUST 以 EmbedAbortedError reject。 */
export interface EmbedRunner {
  run(texts: ReadonlyArray<string>, signal: AbortSignal): Promise<EmbeddingVector[]>;
}

/**
 * 内联派发（回退/冒烟）：在当前进程直调纯 embedding 函数。
 * spec「worker 不可用时可回退内联」——可中断、输出与 worker 路径一致。
 * 中断检查在计算前后各一次（本地哈希 embedding 极快，不切片）。
 */
export class InlineEmbedRunner implements EmbedRunner {
  async run(texts: ReadonlyArray<string>, signal: AbortSignal): Promise<EmbeddingVector[]> {
    if (signal.aborted) throw new EmbedAbortedError();
    const vectors = computeEmbeddings(texts);
    if (signal.aborted) throw new EmbedAbortedError();
    return vectors;
  }
}
