/**
 * 最小差异计算 + hunk 拆分 (I6 refactor-worker-runtime task 2.1)
 *
 * spec: refactor-worker-runtime「局部重构 diff 计算在 utilityProcess worker 执行」+ diff-engine——
 * 对「原片段 vs agent 改写片段」计算确定性最小差异并拆分为片段内偏移升序的可独立裁决 hunk；
 * 每个 hunk 携锚点（片段锚点 + 片段内相对偏移）、原文、改写文本；hunk 天然限于片段范围（越界不产生）。
 *
 * 本文件为**纯函数**（无 I/O、无 Electron）：worker 薄壳与 Main 内联回退共用同一实现，可 Node 冒烟直调校验。
 * 算法：先求公共前缀/后缀收敛不变边界，中间以字符级 LCS（Myers 精神的 DP 回溯）拆出交替的「相等 / 变更」
 * 段，每个「变更」段（替换/纯插入/纯删除）产出一个 hunk。确定性：同输入恒产同 hunk 序列。
 */

import type { RefactorFragment } from './fragment.js';
import type { DiffHunk, DiffResult, HunkId } from './diff-engine.js';

/** 稳定 hunk id：片段锚点 id + 序号，确定性可复现（同输入同序列）。 */
function hunkId(fragment: RefactorFragment, index: number): HunkId {
  const nodeId = fragment.anchor.node.id;
  return `${nodeId}:${fragment.anchor.from}-${fragment.anchor.to}#${index}`;
}

/** 公共前缀长度（字符级）。 */
function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

/** 公共后缀长度（字符级），不与已计入的前缀重叠。 */
function commonSuffixLen(a: string, b: string, prefix: number): number {
  const maxA = a.length - prefix;
  const maxB = b.length - prefix;
  const max = Math.min(maxA, maxB);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

/**
 * 对中段（去前后缀）做字符级 LCS DP，回溯出交替的相等/变更段边界。
 * 返回相对中段起点的一组 [replaceFrom, replaceTo, insText] 变更（origSlice 由调用方据边界切）。
 * 为控内存，仅当中段规模适中时走 DP；超大中段退化为「整段替换」单 hunk（仍确定性、仍限于片段）。
 */
interface MidChange {
  /** 中段内原文起（相对中段） */
  origFrom: number;
  /** 中段内原文止（相对中段） */
  origTo: number;
  /** 该段改写文本 */
  rewritten: string;
}

const MAX_LCS_CELLS = 4_000_000; // ~2000×2000 字符，超出则退化整段替换

function diffMid(orig: string, rewritten: string): ReadonlyArray<MidChange> {
  if (orig.length === 0 && rewritten.length === 0) return [];
  if (orig.length === 0) {
    return [{ origFrom: 0, origTo: 0, rewritten }];
  }
  if (rewritten.length === 0) {
    return [{ origFrom: 0, origTo: orig.length, rewritten: '' }];
  }
  if (orig.length * rewritten.length > MAX_LCS_CELLS) {
    // 退化：整段替换（确定性、限于片段；避免超大 DP）。
    return [{ origFrom: 0, origTo: orig.length, rewritten }];
  }

  const n = orig.length;
  const m = rewritten.length;
  // LCS 长度 DP：lcs[i][j] = orig[i:] 与 rewritten[j:] 的 LCS 长度。
  const lcs: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  const idx = (i: number, j: number): number => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (orig[i] === rewritten[j]) {
        lcs[idx(i, j)] = (lcs[idx(i + 1, j + 1)] ?? 0) + 1;
      } else {
        const down = lcs[idx(i + 1, j)] ?? 0;
        const right = lcs[idx(i, j + 1)] ?? 0;
        lcs[idx(i, j)] = down >= right ? down : right;
      }
    }
  }

  // 回溯：产出交替的相等/变更段。累积一个待提交的变更缓冲。
  const changes: MidChange[] = [];
  let i = 0;
  let j = 0;
  let pendingOrigFrom = -1;
  let pendingOrigTo = -1;
  let pendingRewritten = '';
  const flush = (): void => {
    if (pendingOrigFrom !== -1 || pendingRewritten.length > 0) {
      changes.push({
        origFrom: pendingOrigFrom === -1 ? i : pendingOrigFrom,
        origTo: pendingOrigTo === -1 ? i : pendingOrigTo,
        rewritten: pendingRewritten,
      });
    }
    pendingOrigFrom = -1;
    pendingOrigTo = -1;
    pendingRewritten = '';
  };
  const extendDelete = (): void => {
    if (pendingOrigFrom === -1) pendingOrigFrom = i;
    pendingOrigTo = i + 1;
  };
  const extendInsert = (ch: string): void => {
    if (pendingOrigFrom === -1) {
      pendingOrigFrom = i;
      pendingOrigTo = i;
    }
    pendingRewritten += ch;
  };

  while (i < n && j < m) {
    if (orig[i] === rewritten[j]) {
      flush();
      i += 1;
      j += 1;
    } else if ((lcs[idx(i + 1, j)] ?? 0) >= (lcs[idx(i, j + 1)] ?? 0)) {
      extendDelete();
      i += 1;
    } else {
      extendInsert(rewritten[j] ?? '');
      j += 1;
    }
  }
  while (i < n) {
    extendDelete();
    i += 1;
  }
  while (j < m) {
    extendInsert(rewritten[j] ?? '');
    j += 1;
  }
  flush();
  return changes;
}

/**
 * 计算一次局部重构的 diff (task 2.1)。纯函数。
 *
 * 语义：对原片段文本与改写片段全文求最小差异，拆为片段内偏移升序、互不重叠的 hunk；
 * 每个 hunk 的 [fragmentFrom, fragmentTo) 为片段内原文相对偏移，`original` 为该切片、`rewritten` 为改写。
 * 无差异时返回空 hunk 列表。hunk 天然限于片段（原文偏移始终落在 [0, fragment.text.length]）。
 */
export function computeDiffResult(
  fragment: RefactorFragment,
  rewrittenFragment: string,
): DiffResult {
  const orig = fragment.text;
  const rew = rewrittenFragment;

  const prefix = commonPrefixLen(orig, rew);
  const suffix = commonSuffixLen(orig, rew, prefix);

  const midOrig = orig.slice(prefix, orig.length - suffix);
  const midRew = rew.slice(prefix, rew.length - suffix);

  const midChanges = diffMid(midOrig, midRew);

  const hunks: DiffHunk[] = midChanges.map((change, index) => ({
    id: hunkId(fragment, index),
    anchor: fragment.anchor,
    fragmentFrom: prefix + change.origFrom,
    fragmentTo: prefix + change.origTo,
    original: midOrig.slice(change.origFrom, change.origTo),
    rewritten: change.rewritten,
  }));

  return {
    fragment,
    rewrittenFragment: rew,
    hunks,
  };
}
