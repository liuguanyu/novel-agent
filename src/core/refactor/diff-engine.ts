/**
 * diff 引擎:最小差异 + hunk 拆分 (surgical-refactor tasks 2.1–2.4)
 *
 * spec: diff-engine——对「原片段 vs agent 改写」计算最小差异并拆分为可独立接受/拒绝的 hunk；
 * 每个 hunk MUST 携带锚点（稳定标识符 + 偏移）、原文、改写文本，强类型禁 any；差异 MUST 仅在片段
 * 范围内产生，越界不产生 hunk；diff 计算属 CPU 密集，MUST 在 utilityProcess（见 design D2、D6）。
 *
 * 本文件为类型契约（无 I/O，不含 diff 算法实现——算法在 utilityProcess 实现层）。
 * hunk 锚点复用 fragment 的 FragmentAnchor（稳定标识符 + 偏移）。
 */

import type { FragmentAnchor, RefactorFragment } from './fragment.js';

/** hunk 标识（关联同一 diff 内各 hunk 的评审状态）。 */
export type HunkId = string;

/**
 * 一个可独立接受/拒绝的 hunk (task 2.2)。强类型，禁 any。
 * 携带:自身锚点（片段锚点 + hunk 在片段内的相对偏移）、原文、改写文本。
 */
export interface DiffHunk {
  /** hunk 标识 */
  id: HunkId;
  /** hunk 定位:所属片段锚点 + hunk 在片段内 [from, to) 的相对偏移（task 2.2） */
  anchor: FragmentAnchor;
  /** hunk 在片段文本内的相对起始偏移 */
  fragmentFrom: number;
  /** hunk 在片段文本内的相对结束偏移（> fragmentFrom；纯删除时 == fragmentFrom） */
  fragmentTo: number;
  /** 原文（片段内 [fragmentFrom, fragmentTo) 切片；纯插入时为空串） */
  original: string;
  /** 改写文本（纯删除时为空串） */
  rewritten: string;
}

/**
 * 一次 diff 的产物 (task 2.1)：原片段 + 其改写拆出的 hunk 列表。
 * hunk 列表 MUST 仅覆盖片段范围内的差异（task 2.3），越界内容不产生 hunk。
 */
export interface DiffResult {
  /** 被 diff 的原片段（含锚点） */
  fragment: RefactorFragment;
  /** agent 改写后的完整片段文本（供全览与拼回校验） */
  rewrittenFragment: string;
  /** 拆分出的可独立裁决 hunk（按片段内偏移升序） */
  hunks: ReadonlyArray<DiffHunk>;
}

/**
 * 差异仅在片段范围内原则 (task 2.3 / spec「差异仅在片段范围内」)。
 * diff MUST 仅在待修片段范围内产生 hunk;越出片段边界的内容 MUST NOT 产生 hunk。
 * 因重构 agent 只见片段（fragment.ts），其改写天然限于片段;此常量为该边界的显式契约标记。
 */
export const HUNKS_CONFINED_TO_FRAGMENT = true as const;

/**
 * diff 计算的进程归属声明 (task 2.4 / spec「diff 计算在 utilityProcess」)。
 * 大文本 diff 属 CPU 密集，MUST 在 utilityProcess/worker 执行，主进程事件循环 MUST NOT 阻塞。
 */
export const DIFF_ENGINE_PLACEMENT = {
  /** 最小差异计算 + hunk 拆分:CPU 密集 → utilityProcess/worker。 */
  diffComputation: 'utility-process',
  /** 片段裁剪、hunk 拼回、状态写入编排:Main。 */
  spliceOrchestration: 'main',
} as const;
