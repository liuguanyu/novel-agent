/**
 * 故事资产 — 快照与版本化 (Roadmap M1)
 *
 * 当前故事资产快照是某一时刻全部情节线、人物、关系和成长弧的完整切面。
 * 快照有版本号，支持草案/确认/正式三态。
 * 未采纳的草案不得污染正式资产（Roadmap §10.3 约束 3）。
 */

import type { AssetStatus } from './credibility.js';
import type { PlotThread, Foreshadowing } from './plot-thread.js';
import type { CharacterProfile, CharacterRelation, CharacterArc } from './character.js';

/** 故事资产快照 */
export interface StoryAssetSnapshot {
  /** 快照标识 */
  readonly id: string;
  /** 所属项目 */
  readonly projectId: string;
  /** 版本号（每次提炼或作者确认递增） */
  readonly version: number;
  /** 创建时间 */
  readonly createdAt: string;
  /** 上次更新时间 */
  readonly updatedAt: string;
  /** 情节线列表 */
  readonly plotThreads: ReadonlyArray<PlotThread>;
  /** 人物档案列表 */
  readonly characters: ReadonlyArray<CharacterProfile>;
  /** 人物关系列表 */
  readonly relations: ReadonlyArray<CharacterRelation>;
  /** 人物成长弧列表 */
  readonly arcs: ReadonlyArray<CharacterArc>;
  /** 伏笔列表 */
  readonly foreshadowings: ReadonlyArray<Foreshadowing>;
  /** 来源旧稿大纲版本 */
  readonly sourceOutlineVersion: number | undefined;
}

/** 从快照中提取正式资产（status === 'formal'），过滤草案和待确认 */
export function formalAssets(snapshot: StoryAssetSnapshot): StoryAssetSnapshot {
  return {
    ...snapshot,
    plotThreads: snapshot.plotThreads.filter((t) => t.status === 'formal'),
    characters: snapshot.characters.filter((c) => c.status === 'formal'),
    relations: snapshot.relations.filter((r) => r.status === 'formal'),
    arcs: snapshot.arcs.filter((a) => a.status === 'formal'),
    foreshadowings: snapshot.foreshadowings.filter((f) => f.state !== 'abandoned'),
  };
}

/** 统计各状态数量，供 UI 展示 */
export function assetStatusCounts(snapshot: StoryAssetSnapshot): {
  readonly plotThreads: Record<AssetStatus, number>;
  readonly characters: Record<AssetStatus, number>;
} {
  const countByStatus = <T extends { readonly status: AssetStatus }>(items: ReadonlyArray<T>): Record<AssetStatus, number> => {
    const result: Record<AssetStatus, number> = { draft: 0, confirmed: 0, formal: 0 };
    for (const item of items) result[item.status] += 1;
    return result;
  };
  return {
    plotThreads: countByStatus(snapshot.plotThreads),
    characters: countByStatus(snapshot.characters),
  };
}

/** 冲突检测结果：同一人物/情节线存在互斥解释 */
export interface AssetConflict {
  readonly kind: 'character-alias' | 'plot-overlap' | 'relation-contradiction' | 'timeline-contradiction';
  readonly description: string;
  readonly involvedAssetIds: ReadonlyArray<string>;
}

/** 检测人物别名冲突：两个人物共用同一别名 */
export function detectCharacterAliasConflicts(characters: ReadonlyArray<CharacterProfile>): ReadonlyArray<AssetConflict> {
  const aliasMap = new Map<string, string[]>();
  for (const char of characters) {
    for (const alias of char.aliases) {
      const existing = aliasMap.get(alias);
      if (existing === undefined) {
        aliasMap.set(alias, [char.id]);
      } else {
        existing.push(char.id);
      }
    }
  }
  const conflicts: AssetConflict[] = [];
  for (const [alias, charIds] of aliasMap) {
    if (charIds.length > 1) {
      conflicts.push({
        kind: 'character-alias',
        description: `别名"${alias}"同时属于人物 ${charIds.map((id) => characters.find((c) => c.id === id)?.name ?? id).join('、')}`,
        involvedAssetIds: charIds,
      });
    }
  }
  return conflicts;
}

/** 检测情节线重叠：两条情节线关联了相同的情节节点 */
export function detectPlotOverlapConflicts(threads: ReadonlyArray<PlotThread>): ReadonlyArray<AssetConflict> {
  const nodeMap = new Map<string, string[]>();
  for (const thread of threads) {
    for (const nodeId of thread.plotNodeIds) {
      const existing = nodeMap.get(nodeId);
      if (existing === undefined) {
        nodeMap.set(nodeId, [thread.id]);
      } else {
        existing.push(thread.id);
      }
    }
  }
  const conflicts: AssetConflict[] = [];
  for (const [nodeId, threadIds] of nodeMap) {
    if (threadIds.length > 1) {
      const names = threadIds.map((id) => threads.find((t) => t.id === id)?.name ?? id);
      conflicts.push({
        kind: 'plot-overlap',
        description: `情节节点 ${nodeId} 同时属于情节线 ${names.join('、')}`,
        involvedAssetIds: threadIds,
      });
    }
  }
  return conflicts;
}
