/**
 * 素材 embedding 与语义排序纯函数 (I7 corpus-worker-runtime tasks 1.x)
 *
 * spec: corpus-worker-runtime「embedding 计算为纯函数可独立校验」——
 * 本文件为**无 I/O、无 Electron 依赖的确定性纯函数**：字符 n-gram 哈希投影为定长向量 + L2 归一化，
 * 余弦相似度排序，按类型/标签/来源过滤与 topK/minScore 截断。既供 worker 侧（embed-worker）计算，
 * 也供 Main 回退内联与冒烟独立校验（同一套函数，语义一致）。
 *
 * 说明：这是不依赖外部模型/网络的**降级 embedding**（本地确定性），满足「进程归属 + 检索管道」骨架；
 * 真实向量库/模型选型（Chroma/LanceDB 等）本 change 不锁定，后续 change 可替换本实现而不改契约。
 */

import type { CorpusItem, CorpusItemType } from './corpus-item.js';
import type { CorpusQuery, CorpusRetrievalResult, CorpusHit } from './corpus-retrieval.js';
import type { EmbeddingVector } from './corpus-task.js';

/** embedding 维度（定长向量分量数）。 */
export const EMBEDDING_DIM = 256;

/** 一条已向量化的素材条目（条目 + 其内容向量）。 */
export interface EmbeddedCorpusItem {
  item: CorpusItem;
  vector: EmbeddingVector;
}

/**
 * FNV-1a 32 位字符串哈希（确定性、无依赖）。用于把 n-gram 映射到向量桶。
 * 以无符号右移 0 收敛为 32 位无符号整数。
 */
function hashGram(gram: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < gram.length; i += 1) {
    hash ^= gram.charCodeAt(i);
    // FNV prime 乘法，Math.imul 保证 32 位整数语义。
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 为一段文本计算 embedding：字符 unigram + bigram 哈希入桶计数，再 L2 归一化。
 * 空文本/全空白返回零向量（余弦相似度恒为 0，不误命中）。
 */
function embedText(text: string): EmbeddingVector {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 1) {
    const uni = chars[i] ?? '';
    if (uni.trim().length > 0) {
      const bucket = hashGram(uni) % EMBEDDING_DIM;
      vec[bucket] = (vec[bucket] ?? 0) + 1;
    }
    if (i + 1 < chars.length) {
      const bi = uni + (chars[i + 1] ?? '');
      const bucket = hashGram(bi) % EMBEDDING_DIM;
      vec[bucket] = (vec[bucket] ?? 0) + 1;
    }
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i += 1) {
    const v = vec[i] ?? 0;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < EMBEDDING_DIM; i += 1) {
    vec[i] = (vec[i] ?? 0) / norm;
  }
  return vec;
}

/**
 * 为一批文本计算 embedding（保持顺序，一一对应）。
 * 确定性：同一输入多次调用产出相等向量（供冒烟独立校验）。
 */
export function computeEmbeddings(texts: ReadonlyArray<string>): EmbeddingVector[] {
  return texts.map((t) => embedText(t));
}

/**
 * 余弦相似度。约定入参均已 L2 归一化（computeEmbeddings 的产物），故等于点积。
 * 维度不一致时按较短维度截断（防御性；正常路径同维）。
 */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

/** 判断条目是否通过过滤条件（各字段 OR 内部、AND 跨字段；缺省字段不过滤）。 */
function passesFilter(item: CorpusItem, query: CorpusQuery): boolean {
  const filter = query.filter;
  if (filter === undefined) return true;

  const { types, tags, sourceKinds } = filter;

  if (types !== undefined && types.length > 0) {
    const wanted = types as ReadonlyArray<string>;
    if (!wanted.includes(item.type as string)) return false;
  }

  if (tags !== undefined && tags.length > 0) {
    const itemTags = item.tags;
    const hit = tags.some((t) => itemTags.includes(t));
    if (!hit) return false;
  }

  if (sourceKinds !== undefined && sourceKinds.length > 0) {
    const kind = item.source?.kind;
    if (kind === undefined) return false;
    if (!sourceKinds.includes(kind as string)) return false;
  }

  return true;
}

/**
 * 对已向量化的素材以查询向量做语义相似度排序 + 过滤 + 截断。
 * - 先按 filter（类型/标签/来源）筛除不满足项；
 * - 以余弦相似度降序；相等时按条目 id 升序稳定排序（确定性）；
 * - 应用 minScore（严格小于则剔除）后再取 topK。
 * spec:「按相关度降序」「过滤与语义组合」「topK 与 minScore 截断」。
 */
export function rankCorpusHits(
  queryVector: EmbeddingVector,
  items: ReadonlyArray<EmbeddedCorpusItem>,
  query: CorpusQuery,
): CorpusRetrievalResult {
  const scored: CorpusHit[] = [];
  for (const entry of items) {
    if (!passesFilter(entry.item, query)) continue;
    const score = cosineSimilarity(queryVector, entry.vector);
    if (query.minScore !== undefined && score < query.minScore) continue;
    scored.push({ item: entry.item, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });

  const hits =
    query.topK !== undefined && query.topK >= 0 ? scored.slice(0, query.topK) : scored;
  return { hits };
}

/** 类型收窄辅助：把可扩展字符串标为 CorpusItemType（无副作用，仅供上层组装）。 */
export function asCorpusItemType(raw: string): CorpusItemType {
  return raw as CorpusItemType;
}
