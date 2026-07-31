import type { IssueEvidence } from '../story-bible/consistency-issue.js';

export interface SourceLocationCandidate {
  readonly from: number;
  readonly to: number;
  readonly quote: string;
}

export type SourceLocationResult =
  | { readonly status: 'located'; readonly candidate: SourceLocationCandidate; readonly matchMethod: 'exact' | 'context' }
  | { readonly status: 'not-found'; readonly reason: string }
  | {
      readonly status: 'ambiguous';
      /** 候选来源：精确/上下文重复命中，或精确失败后的近似匹配。 */
      readonly matchMethod: 'exact' | 'context' | 'approximate';
      readonly candidates: ReadonlyArray<SourceLocationCandidate>;
      readonly reason: string;
    };

/** 近似匹配的双字组相似度阈值（低于此值视为不相关，避免误命中）。 */
const APPROXIMATE_THRESHOLD = 0.6;
/** 近似候选上限，避免正文中大量相近片段淹没作者。 */
const MAX_APPROXIMATE_CANDIDATES = 5;

function occurrences(content: string, quote: string): ReadonlyArray<SourceLocationCandidate> {
  const matches: SourceLocationCandidate[] = [];
  let offset = 0;
  while (offset <= content.length - quote.length) {
    const from = content.indexOf(quote, offset);
    if (from < 0) break;
    matches.push({ from, to: from + quote.length, quote });
    offset = from + Math.max(quote.length, 1);
  }
  return matches;
}

/** 字符二元组多重集（用于 Dice 相似度）。 */
function bigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const gram = text.slice(i, i + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

/** Sørensen–Dice 系数：2|A∩B| / (|A|+|B|)，对错别字/局部改写稳健且确定。 */
function diceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  let intersection = 0;
  for (const [gram, count] of aGrams) {
    const other = bGrams.get(gram);
    if (other !== undefined) intersection += Math.min(count, other);
  }
  const total = (a.length - 1) + (b.length - 1);
  return total === 0 ? 0 : (2 * intersection) / total;
}

/**
 * 精确匹配失败时的近似匹配：等长滑窗计算 Dice 相似度，阈值以上者按分数贪心去重。
 * 返回按位置升序的候选（引文取实际命中的正文片段，供高亮真实文本）。
 */
function approximateMatches(content: string, quote: string): ReadonlyArray<SourceLocationCandidate> {
  const windowSize = quote.length;
  if (windowSize < 2 || content.length < windowSize) return [];
  const scored: Array<SourceLocationCandidate & { readonly score: number }> = [];
  for (let from = 0; from + windowSize <= content.length; from += 1) {
    const window = content.slice(from, from + windowSize);
    const score = diceSimilarity(window, quote);
    if (score >= APPROXIMATE_THRESHOLD) scored.push({ from, to: from + windowSize, quote: window, score });
  }
  scored.sort((a, b) => b.score - a.score || a.from - b.from);
  const selected: Array<SourceLocationCandidate & { readonly score: number }> = [];
  for (const candidate of scored) {
    if (selected.length >= MAX_APPROXIMATE_CANDIDATES) break;
    const overlaps = selected.some((chosen) => candidate.from < chosen.to && chosen.from < candidate.to);
    if (!overlaps) selected.push(candidate);
  }
  return selected
    .sort((a, b) => a.from - b.from)
    .map(({ from, to, quote: matched }) => ({ from, to, quote: matched }));
}

function matchesContext(content: string, candidate: SourceLocationCandidate, evidence: IssueEvidence): boolean {
  const before = evidence.before?.trim();
  const after = evidence.after?.trim();
  const beforeMatches = before === undefined || before.length === 0
    ? true
    : content.slice(Math.max(0, candidate.from - before.length - 80), candidate.from).includes(before);
  const afterMatches = after === undefined || after.length === 0
    ? true
    : content.slice(candidate.to, Math.min(content.length, candidate.to + after.length + 80)).includes(after);
  return beforeMatches && afterMatches;
}

/**
 * Deterministically locate audit evidence in manuscript text.
 * It never guesses: zero matches fail, multiple unresolved matches wait for the author.
 */
export function locateSourceEvidence(content: string, evidence: IssueEvidence): SourceLocationResult {
  const quote = evidence.quote.trim();
  if (quote.length === 0) return { status: 'not-found', reason: '诊断证据缺少可定位的原文引文' };
  const exact = occurrences(content, quote);
  if (exact.length === 0) {
    // 精确匹配失败：执行近似匹配。近似结果天然不确定，一律交作者确认，绝不自动落定。
    const approximate = approximateMatches(content, quote);
    if (approximate.length === 0) {
      return { status: 'not-found', reason: '当前正文中未找到诊断证据引文，原文可能已经变化' };
    }
    return {
      status: 'ambiguous',
      matchMethod: 'approximate',
      candidates: approximate,
      reason: `精确匹配未命中，通过近似匹配找到 ${approximate.length} 处相近原文，无法在不猜测的情况下确定修改位置`,
    };
  }
  if (exact.length === 1) return { status: 'located', candidate: exact[0]!, matchMethod: 'exact' };
  const contextual = exact.filter((candidate) => matchesContext(content, candidate, evidence));
  if (contextual.length === 1) return { status: 'located', candidate: contextual[0]!, matchMethod: 'context' };
  const candidates = contextual.length > 1 ? contextual : exact;
  return {
    status: 'ambiguous',
    matchMethod: contextual.length > 1 ? 'context' : 'exact',
    candidates,
    reason: `找到 ${candidates.length} 处相同引文，无法在不猜测的情况下确定修改位置`,
  };
}
