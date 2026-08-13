/**
 * 老书整理 v2 — 大纲领域模型
 *
 * 旧稿大纲是从现有正文还原的故事结构。每个节点关联到原稿章节来源，
 * 并支持标记保留状态。新版大纲是在旧稿大纲和保留内容基础上编辑形成。
 */

import type { NodeRef } from '../manuscript/index.js';

/* ── 大纲节点 ──────────────────────────────────────────────────── */

export type OutlineNodeKind = 'volume' | 'chapter' | 'arc' | 'plot-beat' | 'scene';

export type OutlineNodeSourceKind = 'preserved' | 'adjusted' | 'merged' | 'new';

/** 大纲节点在原稿中的来源引用 */
export interface OutlineSourceReference {
  /** 原稿节点引用（章节或场景） */
  readonly nodeRef: NodeRef;
  /** 在原稿中的位置描述 */
  readonly label: string;
  /** 引用的片段（可选） */
  readonly quote: string | undefined;
}

/** 大纲节点 */
export interface DeletedPlotSnapshot {
  readonly node: OutlineNode;
  readonly deletedAt: string;
}

export type CrossChapterIssueKind = 'timeline' | 'character-state' | 'causality' | 'duplicate-event' | 'continuity' | 'other';
export type CrossChapterIssueSeverity = 'low' | 'medium' | 'high' | 'unknown';
export type CrossChapterIssueStatus = 'open' | 'confirmed' | 'resolved' | 'dismissed';

/** 跨章节关联或冲突，不预设必须合并。 */
export interface CrossChapterIssue {
  readonly id: string;
  readonly plotNodeIds: ReadonlyArray<string>;
  readonly chapterNodeIds: ReadonlyArray<string>;
  readonly kind: CrossChapterIssueKind;
  readonly severity: CrossChapterIssueSeverity;
  readonly description: string;
  readonly evidence: ReadonlyArray<string>;
  readonly status: CrossChapterIssueStatus;
  readonly authorNote?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OutlineNode {
  /** 稳定标识符 */
  readonly id: string;
  /** 父节点 id（根节点为 undefined） */
  readonly parentId: string | undefined;
  /** 排序序号 */
  readonly order: number;
  /** 节点类型 */
  readonly kind: OutlineNodeKind;
  /** 标题 */
  readonly title: string;
  /** 一句话摘要 */
  readonly summary: string;
  /** 涉及的主要人物名称列表 */
  readonly characters: ReadonlyArray<string>;
  /** 原稿来源 */
  readonly sources: ReadonlyArray<OutlineSourceReference>;
  /** 情节可能跨越多个章节；parentId 仅表示主章节归属。 */
  readonly crossChapter?: boolean;
  /** 是否为保留情节 */
  readonly preserved: boolean;
  /** 作者备注 */
  readonly authorNote: string | undefined;
}

/* ── 大纲 ──────────────────────────────────────────────────────── */

/** 单轮参谋讨论记录。 */
export interface AdvisorConversationTurn {
  readonly question: string;
  readonly advice: string;
  readonly options: ReadonlyArray<string>;
  readonly askedAt: string;
}

/** 单个情节的参谋讨论记录。 */
export interface AdvisorConversation {
  readonly plotNodeId: string;
  readonly turns: ReadonlyArray<AdvisorConversationTurn>;
  readonly updatedAt: string;
}

/** 旧稿大纲 */
export interface LegacyOutline {
  /** 大纲标识 */
  readonly id: string;
  /** 所属项目 */
  readonly projectId: string;
  /** 大纲版本号 */
  readonly version: number;
  /** 生成时间 */
  readonly createdAt: string;
  /** 节点列表（树形结构由 parentId + order 表达） */
  readonly nodes: ReadonlyArray<OutlineNode>;
  /**
   * 作者用于重写的全书情节线顺序，与原文章节归属解耦。
   * 保存 plot-beat 的稳定 id；旧文件缺失时按卷/章/order 派生。
   */
  readonly plotSequence?: ReadonlyArray<string>;
  /** 已删除但可恢复的情节候选。 */
  readonly deletedPlots?: ReadonlyArray<DeletedPlotSnapshot>;
  /** 跨章关联、冲突和待作者裁决记录。 */
  readonly crossChapterIssues?: ReadonlyArray<CrossChapterIssue>;
  /** 按情节存储的参谋讨论记录；与作者最终改写要求（PreservationManifest.plots[].authorNote）分开。 */
  readonly advisorConversations?: ReadonlyArray<AdvisorConversation>;
  /** 生成来源的章节树版本标识 */
  readonly sourceChapterTreeVersion: string | undefined;
}

/* ── 辅助函数 ──────────────────────────────────────────────────── */

/** 获取大纲节点的根节点列表（parentId === undefined ） */
export function outlineRoots(nodes: ReadonlyArray<OutlineNode>): ReadonlyArray<OutlineNode> {
  return nodes
    .filter((node) => node.parentId === undefined)
    .sort((a, b) => a.order - b.order);
}

/** 获取指定节点的子节点列表 */
export function outlineChildren(
  nodes: ReadonlyArray<OutlineNode>,
  parentId: string,
): ReadonlyArray<OutlineNode> {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

/** 计算大纲中保留情节的数量 */
export function countPreservedPlots(nodes: ReadonlyArray<OutlineNode>): number {
  return nodes.filter((node) => node.preserved).length;
}
