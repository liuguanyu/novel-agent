/**
 * 片段圈定 (surgical-refactor tasks 1.1–1.3)
 *
 * spec: fragment-scoping——只将待修片段 + 作者指令 + 必要只读上下文（相关事实）交给重构 agent，
 * MUST NOT 把片段之外「写得好、无需改」的正文交给它；裁片段时 MUST 记录稳定标识符锚点与位置偏移
 * 供拼回定位；片段与上下文 MUST 强类型、禁 any（见 design D1）。
 *
 * 本文件为类型契约 + 纯裁剪 helper（无 I/O）。锚点复用 story-workspace 稳定标识符（NodeRef）；
 * 只读事实上下文复用 orchestration 的 FactContextRef（以引用进入，非整库）。
 */

import type { NodeRef } from '../manuscript/node-id.js';
import type { FactContextRef } from '../orchestration/context-refs.js';

/**
 * 片段锚点：稳定标识符 + 在其节点正文内的位置偏移 (task 1.3 / design D1)。
 * 偏移以 ProseMirror 位置表达；重命名/移序/改文不漂移由 NodeRef 保证。
 */
export interface FragmentAnchor {
  /** 所属节点（场景/章/卷）稳定标识符 */
  node: NodeRef;
  /** 片段在该节点正文内的起始位置 */
  from: number;
  /** 片段在该节点正文内的结束位置（> from） */
  to: number;
}

/**
 * 待修片段 (task 1.1)：程序从选区/节点范围裁出的「坏片段」正文 + 其锚点。
 * 这是交给重构 agent 的唯一正文——agent 看不到片段外的好文笔（task 1.2）。
 */
export interface RefactorFragment {
  /** 片段锚点（供 diff 与拼回定位） */
  anchor: FragmentAnchor;
  /** 片段正文文本（[from, to) 切片） */
  text: string;
}

/**
 * 重构 agent 的完整输入 (task 1.3)。强类型，禁 any。
 * 只含:坏片段 + 作者指令 + 只读事实引用；MUST NOT 含片段外正文（spec「隔离好的部分」）。
 */
export interface RefactorInput {
  /** 待修片段 */
  fragment: RefactorFragment;
  /** 作者的修正指令（自然语言） */
  instruction: string;
  /** 只读相关事实引用（以版本引用进入，非整库；无则 null） */
  facts: FactContextRef | null;
}

/**
 * 从节点正文裁出待修片段 (task 1.1)。纯函数。
 * 仅返回 [from, to) 切片与锚点，MUST NOT 携带片段外正文（隔离好的部分）。
 * 越界/非法区间返回 null（由上层处理，不静默产错）。
 */
export function carveFragment(nodeText: string, anchor: FragmentAnchor): RefactorFragment | null {
  if (anchor.from < 0 || anchor.to > nodeText.length || anchor.to <= anchor.from) {
    return null;
  }
  return {
    anchor,
    text: nodeText.slice(anchor.from, anchor.to),
  };
}

/**
 * 只喂片段原则 (tasks 1.1, 1.2 / spec「只喂待修片段」)。
 * 重构 agent 的输入 MUST 仅含片段 + 指令 + 只读上下文，MUST NOT 含片段外周边正文。
 * 此常量为该不变量的显式契约标记。
 */
export const REFACTOR_SEES_ONLY_FRAGMENT = true as const;
