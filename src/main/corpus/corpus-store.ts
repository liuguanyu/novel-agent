/**
 * 素材条目向量存储抽象 (I7 corpus-worker-runtime task 5.x)
 *
 * spec: corpus-worker-runtime「限定检索作用域」——检索前据作用域筛出候选素材快照。
 * 向量库读写 I/O 归 Main（CORPUS_RETRIEVAL_PLACEMENT.vectorStoreIo='main'）；选型未锁定，
 * 本 change 以进程内 InMemoryCorpusStore 兑现接口（后续 change 可替换为 Chroma/LanceDB 等而不改契约）。
 *
 * 本文件**不依赖 Electron**：仅接口 + 纯内存实现，供 runtime.ts 与 Node 冒烟共用。
 */

import type { EmbeddedCorpusItem } from '../../core/corpus/index.js';
import type { CorpusResidence, CorpusScope } from '../../core/corpus/index.js';

/** 一条带归属的已向量化素材（归属决定其在各作用域的可见性）。 */
export interface StoredCorpusItem extends EmbeddedCorpusItem {
  residence: CorpusResidence;
}

/** 素材向量存储：按作用域返回可见的已向量化条目快照。 */
export interface CorpusStore {
  snapshot(scope: CorpusScope): Promise<ReadonlyArray<EmbeddedCorpusItem>>;
}

/**
 * 判断某归属条目在给定检索作用域是否可见。
 * - global 作用域：全部可见。
 * - project/work 作用域：全局仓库条目 + 属主项目为当前 projectId 的项目私有条目可见。
 *   （work 与 project 层级 MVP 暂不区分单篇细粒度，见 spec/handoff 界定。）
 */
function visibleInScope(residence: CorpusResidence, scope: CorpusScope): boolean {
  if (scope.level === 'global') return true;
  // project / work
  if (residence.scope === 'global') return true;
  return scope.projectId !== null && residence.projectId === scope.projectId;
}

/** 进程内素材向量存储（本 change 的向量库兑现，选型未锁定）。 */
export class InMemoryCorpusStore implements CorpusStore {
  readonly #items: StoredCorpusItem[];

  constructor(seed: ReadonlyArray<StoredCorpusItem> = []) {
    this.#items = [...seed];
  }

  /** 追加一条已向量化素材（供装配/冒烟落种）。 */
  add(entry: StoredCorpusItem): void {
    this.#items.push(entry);
  }

  async snapshot(scope: CorpusScope): Promise<ReadonlyArray<EmbeddedCorpusItem>> {
    return this.#items
      .filter((entry) => visibleInScope(entry.residence, scope))
      .map((entry) => ({ item: entry.item, vector: entry.vector }));
  }
}
