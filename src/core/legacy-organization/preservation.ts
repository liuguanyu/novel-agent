/**
 * 老书整理 v2 — 保留内容模型
 *
 * 保留情节：该情节在新版中必须存在，但允许调整位置和写法。
 * 保留原文：作者选定的文字内容默认不变，允许移动到新版其他位置。
 */

import type { NodeRef } from '../manuscript/index.js';

/* ── 保留情节 ──────────────────────────────────────────────────── */

export interface PreservedPlot {
  /** 唯一标识 */
  readonly id: string;
  /** 关联的大纲节点 id */
  readonly outlineNodeId: string;
  /** 情节标题（来自大纲节点） */
  readonly title: string;
  /** 情节来源的原稿位置 */
  readonly sourceRefs: ReadonlyArray<NodeRef>;
  /** 作者备注 */
  readonly authorNote: string | undefined;
  /** 标记时间 */
  readonly preservedAt: string;
}

/* ── 保留原文 ──────────────────────────────────────────────────── */

export interface PreservedQuote {
  /** 唯一标识 */
  readonly id: string;
  /** 保留的原文文字 */
  readonly text: string;
  /** 原文在原稿中的精确位置 */
  readonly sourceNodeRef: NodeRef;
  /** 来源章节标题 */
  readonly sourceChapterTitle: string;
  /** 关联的大纲节点 id（可选，用于展示上下文） */
  readonly outlineNodeId: string | undefined;
  /** 是否为系统推荐候选 */
  readonly recommended: boolean;
  /** 作者备注 */
  readonly authorNote: string | undefined;
  /** 标记时间 */
  readonly preservedAt: string;
}

/* ── 保留清单 ──────────────────────────────────────────────────── */

export interface PreservationManifest {
  /** 所属项目 */
  readonly projectId: string;
  /** 大纲版本关联 */
  readonly outlineId: string;
  /** 保留情节列表 */
  readonly plots: ReadonlyArray<PreservedPlot>;
  /** 保留原文列表 */
  readonly quotes: ReadonlyArray<PreservedQuote>;
  /** 最后修改时间 */
  readonly updatedAt: string;
}

/* ── 辅助函数 ──────────────────────────────────────────────────── */

/** 检查保留原文是否已有大纲节点关联 */
export function countUnplacedQuotes(manifest: PreservationManifest): number {
  return manifest.quotes.filter((q) => q.outlineNodeId === undefined).length;
}

/** 检查保留情节是否都有对应大纲节点 */
export function findUnplacedPlots(
  manifest: PreservationManifest,
  outlineNodeIds: ReadonlySet<string>,
): ReadonlyArray<PreservedPlot> {
  return manifest.plots.filter((p) => !outlineNodeIds.has(p.outlineNodeId));
}
