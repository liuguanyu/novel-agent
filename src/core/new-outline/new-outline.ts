/**
 * 新版大纲 — 核心模型 (Roadmap M3)
 *
 * 新版大纲是从正式故事资产、保留约束和作者要求生成的全新结构。
 * 每个节点记录与旧稿大纲的映射关系，支持沿用、调整、合并、新增和删除。
 *
 * 关键约束：
 * - 只读取 formal 状态的故事资产（不读 draft/confirmed）
 * - 记录来源快照 ID 和版本，保证可追溯
 * - 生成结果先进入草案态，经作者确认后才成为正式版
 * - 未采纳的草案不得污染正式新版大纲
 */

/** 新版大纲节点类型 */
export type NewOutlineNodeKind = 'volume' | 'chapter' | 'arc' | 'plot-beat' | 'scene';

/** 与旧稿的来源关系 */
export type SourceRelation =
  /** 沿用：旧稿节点直接保留到新版 */
  | 'carried-over'
  /** 调整：旧稿节点经修改后进入新版 */
  | 'adjusted'
  /** 合并：多个旧稿节点合并为一个新版节点 */
  | 'merged'
  /** 新增：旧稿中不存在的新节点 */
  | 'new'
  /** 删除：旧稿节点在新版中被删除 */
  | 'deleted';

/** 新版大纲节点状态 */
export type NewOutlineStatus = 'draft' | 'confirmed' | 'formal';

/** 新版大纲节点 */
export interface NewOutlineNode {
  /** 稳定标识符 */
  readonly id: string;
  /** 父节点 ID（根节点为 undefined） */
  readonly parentId: string | undefined;
  /** 排序序号 */
  readonly order: number;
  /** 节点类型 */
  readonly kind: NewOutlineNodeKind;
  /** 标题 */
  readonly title: string;
  /** 一句话摘要 */
  readonly summary: string;
  /** 节点目标（本章/本节点要达成什么） */
  readonly goal: string;
  /** 冲突或张力 */
  readonly conflict: string;
  /** 结果/后果 */
  readonly outcome: string;
  /** 与旧稿大纲的来源关系 */
  readonly sourceRelation: SourceRelation;
  /** 来源旧稿节点 ID 列表 */
  readonly sourceNodeIds: ReadonlyArray<string>;
  /** 所属情节线 ID 列表 */
  readonly plotThreadIds: ReadonlyArray<string>;
  /** 参与人物 ID 列表 */
  readonly characterIds: ReadonlyArray<string>;
  /** 承接的保留情节 ID 列表 */
  readonly preservedPlotIds: ReadonlyArray<string>;
  /** 承接的保留原文 ID 列表 */
  readonly preservedQuoteIds: ReadonlyArray<string>;
  /** 作者备注 */
  readonly authorNote: string | undefined;
}

/** 新版大纲 */
export interface NewOutline {
  /** 大纲标识 */
  readonly id: string;
  /** 所属项目 */
  readonly projectId: string;
  /** 版本号 */
  readonly version: number;
  /** 创建时间 */
  readonly createdAt: string;
  /** 更新时间 */
  readonly updatedAt: string;
  /** 来源故事资产快照 ID */
  readonly sourceSnapshotId: string;
  /** 来源故事资产快照版本 */
  readonly sourceSnapshotVersion: number;
  /** 来源旧稿大纲版本 */
  readonly sourceLegacyOutlineVersion: number | undefined;
  /** 作者生成意图（可选） */
  readonly authorIntent: string | undefined;
  /** 节点列表 */
  readonly nodes: ReadonlyArray<NewOutlineNode>;
  /** 状态 */
  readonly status: NewOutlineStatus;
}

/** 保留项覆盖情况 */
export interface PreservationCoverage {
  /** 保留情节总数 */
  readonly totalPreservedPlots: number;
  /** 已覆盖的保留情节数 */
  readonly coveredPreservedPlots: number;
  /** 遗漏的保留情节 ID 列表 */
  readonly missingPreservedPlotIds: ReadonlyArray<string>;
  /** 保留原文总数 */
  readonly totalPreservedQuotes: number;
  /** 已覆盖的保留原文数 */
  readonly coveredPreservedQuotes: number;
  /** 遗漏的保留原文 ID 列表 */
  readonly missingPreservedQuoteIds: ReadonlyArray<string>;
}

/** 计算保留项覆盖情况 */
export function computePreservationCoverage(
  outline: NewOutline,
  preservedPlotIds: ReadonlyArray<string>,
  preservedQuoteIds: ReadonlyArray<string>,
): PreservationCoverage {
  const coveredPlotIds = new Set(outline.nodes.flatMap((n) => n.preservedPlotIds));
  const coveredQuoteIds = new Set(outline.nodes.flatMap((n) => n.preservedQuoteIds));
  const missingPlotIds = preservedPlotIds.filter((id) => !coveredPlotIds.has(id));
  const missingQuoteIds = preservedQuoteIds.filter((id) => !coveredQuoteIds.has(id));
  return {
    totalPreservedPlots: preservedPlotIds.length,
    coveredPreservedPlots: preservedPlotIds.length - missingPlotIds.length,
    missingPreservedPlotIds: missingPlotIds,
    totalPreservedQuotes: preservedQuoteIds.length,
    coveredPreservedQuotes: preservedQuoteIds.length - missingQuoteIds.length,
    missingPreservedQuoteIds: missingQuoteIds,
  };
}

/** 旧稿到新版节点映射 */
export interface NodeMapping {
  /** 旧稿节点 ID */
  readonly sourceNodeId: string;
  /** 旧稿节点标题 */
  readonly sourceNodeTitle: string;
  /** 新版节点 ID（删除时为 undefined） */
  readonly targetNodeId: string | undefined;
  /** 新版节点标题 */
  readonly targetNodeTitle: string | undefined;
  /** 来源关系 */
  readonly relation: SourceRelation;
}

/** 计算旧稿到新版节点映射 */
export function computeNodeMapping(
  newOutline: NewOutline,
  legacyNodes: ReadonlyArray<{ readonly id: string; readonly title: string }>,
): ReadonlyArray<NodeMapping> {
  const newNodeBySource = new Map<string, { readonly id: string; readonly title: string; readonly relation: SourceRelation }>();
  for (const node of newOutline.nodes) {
    for (const sourceId of node.sourceNodeIds) {
      newNodeBySource.set(sourceId, { id: node.id, title: node.title, relation: node.sourceRelation });
    }
  }
  return legacyNodes.map((legacy) => {
    const mapped = newNodeBySource.get(legacy.id);
    return {
      sourceNodeId: legacy.id,
      sourceNodeTitle: legacy.title,
      targetNodeId: mapped?.id,
      targetNodeTitle: mapped?.title,
      relation: mapped?.relation ?? 'deleted',
    };
  });
}
