/**
 * 编辑器标注契约 (electron-shell-ui editor-annotations tasks 3.1, 3.2, 3.3；design D4)
 *
 * spec: editor-annotations——正文轴基于 TipTap/ProseMirror，MUST 承载 bug 高亮、diff 双栏视图、
 * 逐 hunk accept/reject 控件;所有标注 MUST 以稳定标识符 + ProseMirror 位置锚定，编辑时按位置映射
 * 修正、MUST NOT 漂移，无法安全映射 MUST 标记失效不盲渲染;accept/reject 仅收集意图经 IPC 上报，
 * diff 计算与正文拼回在后端（surgical-refactor），Renderer MUST NOT 执行 diff 或正文写入业务。
 *
 * 本文件为类型契约（无 I/O、无 diff 算法）。标注种类复用既有模型:bug 高亮=ConsistencyIssue、
 * hunk 控件=refactor 的 DiffHunk/HunkId;锚点复用 NodeRef + ProseMirror 位置;失效语义复用
 * refactor 的 HunkValidity 思路。
 */

import type { NodeRef } from '../manuscript/node-id.js';
import type { RunId } from '../../shared/ipc/stream-messages.js';
import type { ConsistencyIssue } from '../story-bible/consistency-issue.js';
import type { DiffHunk, HunkId } from '../refactor/diff-engine.js';
import type { HunkDecisionKind, HunkValidity } from '../refactor/hunk-review.js';

/**
 * 标注在文档中的锚点 (task 3.3 / spec「标注锚定防漂移」)。
 * MUST 以 story-workspace 稳定标识符（NodeRef）+ ProseMirror 位置双重锚定:
 * NodeRef 定位到节点（重命名/移序不失效），[from, to) 定位到节点内文本区间（编辑时按位置映射修正）。
 * MUST NOT 使用会随编辑失效的裸文本位置作为唯一锚（spec「不用裸文本位置」）。
 */
export interface AnnotationAnchor {
  /** 稳定标识符锚:定位到卷/章/场景节点 */
  readonly node: NodeRef;
  /** ProseMirror 位置区间起（节点文档内的绝对位置） */
  readonly from: number;
  /** ProseMirror 位置区间止（> from） */
  readonly to: number;
}

/**
 * 标注在编辑期的有效性 (task 3.3 / spec「无法映射即失效」)。
 * 复用 refactor 的 HunkValidity 语义（valid / remapped / invalidated），使高亮与 hunk 同构:
 * 文档被编辑时按 ProseMirror 映射修正为 remapped;无法安全映射即 invalidated，MUST NOT 在错误位置渲染。
 */
export type AnnotationValidity = HunkValidity;

/**
 * bug 高亮标注 (task 3.1)。承载 story-bible 的 ConsistencyIssue（不另立模型）。
 * 一个问题可有多个锚点（如反向冲突的双锚点），高亮逐锚点渲染。
 */
export interface BugHighlightAnnotation {
  readonly kind: 'bug-highlight';
  /** 承载的一致性问题（后端产出） */
  readonly issue: ConsistencyIssue;
  /** 该高亮实例的锚点（取自 issue.anchors 之一 + ProseMirror 区间） */
  readonly anchor: AnnotationAnchor;
  /** 编辑期有效性 */
  readonly validity: AnnotationValidity;
}

/**
 * 逐 hunk accept/reject 标注 (task 3.1)。承载 refactor 的 DiffHunk（不另立模型）。
 * diff 双栏视图由这些 hunk 聚合呈现;每个 hunk 提供独立的 accept/reject 控件。
 */
export interface HunkAnnotation {
  readonly kind: 'diff-hunk';
  /** 承载的 hunk（后端 diff 引擎产出） */
  readonly hunk: DiffHunk;
  /** 该 hunk 在正文文档中的锚点（片段锚点映射到 ProseMirror 区间） */
  readonly anchor: AnnotationAnchor;
  /** 编辑期有效性 */
  readonly validity: AnnotationValidity;
}

/** 正文轴承载的标注（判别联合，task 3.1）。 */
export type EditorAnnotation = BugHighlightAnnotation | HunkAnnotation;

/**
 * 作者对单个 hunk 的裁决意图上报 (task 3.2 / spec「accept/reject 只上报意图」)。
 * Renderer 仅收集意图并经 IPC 上报;实际 diff 计算与正文拼回在后端（surgical-refactor 的
 * spliceAcceptedHunks），携 runId 关联本次重构运行。
 */
export interface HunkDecisionIntent {
  /** 关联运行 */
  readonly runId: RunId;
  /** 被裁决的 hunk */
  readonly hunkId: HunkId;
  /** 裁决（accept / reject，复用 refactor 的 HunkDecisionKind） */
  readonly decision: HunkDecisionKind;
}

/**
 * accept/reject 只上报意图原则 (task 3.2 / spec「accept/reject 只上报意图」)。
 * 前端 MUST 仅收集裁决意图并经 IPC 上报;实际 diff 计算与正文拼回 MUST 在后端执行，
 * Renderer MUST NOT 执行 diff 计算或正文写入业务逻辑。此常量为该边界的显式契约标记。
 */
export const RENDERER_REPORTS_INTENT_ONLY = true as const;

/**
 * 标注锚定防漂移原则 (task 3.3 / spec「标注锚定防漂移」)。
 * 所有标注 MUST 以稳定标识符 + ProseMirror 位置锚定;文档编辑时 MUST 按 ProseMirror 位置映射修正，
 * MUST NOT 漂移或错位;无法安全映射 MUST 标记 invalidated 并提示重算，MUST NOT 在错误位置渲染。
 * 此常量为该约束的显式契约标记（与 surgical-refactor 偏移修正一致）。
 */
export const ANNOTATIONS_ANCHORED_AND_REMAPPED = true as const;
