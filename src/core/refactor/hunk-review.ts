/**
 * 逐 hunk 评审:接受/拒绝 + 精确拼回 (surgical-refactor tasks 3.1–3.4)
 *
 * spec: hunk-review——作者对每个 hunk 独立 accept/reject，接受项精确拼回原位、未接受项原文 MUST NOT
 * 改动;MUST NOT 提供整章覆盖路径;hunk 定位基于稳定标识符，评审期文档被编辑 MUST 修正偏移、无法安全
 * 映射 MUST 标记失效不盲拼;接受变更 MUST 作为可回滚步进入 checkpointer/事实版本（见 design D3–D5）。
 *
 * 本文件为类型契约 + 纯拼回 helper（无 I/O）。**这是「无 tool_call 也能改文字」的核心:**
 * LLM 只产出改写文本 → diff 引擎拆 hunk → 本处纯函数按接受项确定性拼回，程序写入、非模型自主调工具。
 * 变更以 CheckpointId 关联可回滚步（复用 orchestration/story-bible 的 CheckpointId）。
 */

import type { DiffHunk, DiffResult, HunkId } from './diff-engine.js';
import type { CheckpointId } from '../orchestration/checkpointer.js';

/** 作者对单个 hunk 的裁决 (task 3.1)。 */
export type HunkDecisionKind = 'accept' | 'reject';

/** 一条 hunk 裁决记录。 */
export interface HunkDecision {
  hunkId: HunkId;
  decision: HunkDecisionKind;
}

/**
 * hunk 在评审期的有效性状态 (task 3.3 / spec「无法映射即失效」)。
 * - `valid`:偏移有效，可安全拼回。
 * - `remapped`:文档被编辑，偏移已按 ProseMirror 映射修正后仍有效。
 * - `invalidated`:无法安全映射到原位，MUST 标记失效并提示重算，MUST NOT 盲目拼回。
 */
export type HunkValidity = 'valid' | 'remapped' | 'invalidated';

/**
 * 拼回失败原因（不静默产错）。
 * - `hunk-invalidated`:存在被接受但已失效的 hunk，拒绝拼回（须重算）。
 * - `overlapping-hunks`:被接受的 hunk 区间重叠，无法确定性拼回。
 */
export type SpliceErrorReason = 'hunk-invalidated' | 'overlapping-hunks';

/** 拼回成功。 */
export interface SpliceOk {
  ok: true;
  /** 拼回后的片段文本 */
  fragmentText: string;
}

/** 拼回失败。 */
export interface SpliceErr {
  ok: false;
  reason: SpliceErrorReason;
  /** 相关 hunk 标识（供 UI 定位提示） */
  hunkIds: ReadonlyArray<HunkId>;
}

export type SpliceResult = SpliceOk | SpliceErr;

/**
 * 按接受的 hunk 精确拼回片段 (tasks 3.1, 3.2)。**纯函数——「改文字」的确定性执行点。**
 *
 * 语义（spec「逐 hunk 接受/拒绝」「绝不整章覆盖」）:
 * - 仅将被 accept 的 hunk 改写拼回其片段内原位;reject / 未裁决的原文分毫不动。
 * - 无「整段覆盖」路径:输出 = 原片段逐字节保留 + 仅在接受 hunk 的区间替换。
 * - 失效 hunk 被接受 → 返回 SpliceErr（不盲拼）;接受项区间重叠 → SpliceErr。
 *
 * 实现:对被接受 hunk 按 fragmentFrom 降序替换，使前序替换不移位后序偏移（确定性、无漂移）。
 */
export function spliceAcceptedHunks(
  diff: DiffResult,
  decisions: ReadonlyArray<HunkDecision>,
  validity: Readonly<Record<HunkId, HunkValidity>>,
): SpliceResult {
  const acceptedIds = new Set(
    decisions.filter((d) => d.decision === 'accept').map((d) => d.hunkId),
  );
  const accepted: DiffHunk[] = diff.hunks.filter((h) => acceptedIds.has(h.id));

  const invalidated = accepted.filter((h) => validity[h.id] === 'invalidated');
  if (invalidated.length > 0) {
    return { ok: false, reason: 'hunk-invalidated', hunkIds: invalidated.map((h) => h.id) };
  }

  // 升序检查区间重叠（接受项之间不得交叠，否则拼回不确定）。
  const sortedAsc = [...accepted].sort((a, b) => a.fragmentFrom - b.fragmentFrom);
  for (let i = 1; i < sortedAsc.length; i += 1) {
    const prev = sortedAsc[i - 1];
    const cur = sortedAsc[i];
    if (prev !== undefined && cur !== undefined && cur.fragmentFrom < prev.fragmentTo) {
      return { ok: false, reason: 'overlapping-hunks', hunkIds: [prev.id, cur.id] };
    }
  }

  // 降序替换:先改后段，前段偏移不受影响。
  let text = diff.fragment.text;
  const sortedDesc = [...accepted].sort((a, b) => b.fragmentFrom - a.fragmentFrom);
  for (const hunk of sortedDesc) {
    text = text.slice(0, hunk.fragmentFrom) + hunk.rewritten + text.slice(hunk.fragmentTo);
  }
  return { ok: true, fragmentText: text };
}

/**
 * 接受变更进入可回滚步的关联记录 (task 3.4 / spec「变更可回滚」)。
 * 接受 hunk 产生的正文变更 MUST 作为可回滚步进入 checkpointer/事实版本，供 time-travel 回退/分叉。
 * 复用 orchestration 的 CheckpointId（与事实版本共用同一标识空间）。
 */
export interface AcceptedChangeRecord {
  /** 本次接受涉及的 hunk */
  acceptedHunkIds: ReadonlyArray<HunkId>;
  /** 变更落定后产生的 checkpoint（供 time-travel 定位） */
  checkpoint: CheckpointId;
}

/**
 * 无整章覆盖原则 (task 3.2 / spec「绝不整章覆盖」)。
 * 写入 MUST 仅经逐 hunk 接受实现（spliceAcceptedHunks），系统 MUST NOT 提供整章/整节点覆盖路径。
 * 此常量为该核心交互不变量的显式契约标记。
 */
export const NO_WHOLE_CHAPTER_OVERWRITE = true as const;
