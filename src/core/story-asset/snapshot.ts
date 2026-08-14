/**
 * 故事资产 — 快照与版本化 (Roadmap M1)
 *
 * 当前故事资产快照是某一时刻全部情节线、人物、关系和成长弧的完整切面。
 * 快照有版本号，支持草案/确认/正式三态。
 * 未采纳的草案不得污染正式资产（Roadmap §10.3 约束 3）。
 */

import type { AssetStatus, CredibleClaim } from './credibility.js';
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
    foreshadowings: snapshot.foreshadowings.filter((f) => f.status === 'formal' && f.state !== 'abandoned'),
  };
}

/** 故事资产引用与证据完整性问题。发布正式资产前必须为零。 */
export interface StoryAssetValidationIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * 校验资产内部引用；explicit/inferred 结论必须有可核验的原文证据。
 *
 * outlineSourceQuotes：从旧稿大纲构建的 plotNodeId → 原文引用片段列表映射。
 * 当提供时，会检查每条 Evidence.quote 是否确实出现在对应 plot-beat 的 sources 中。
 * 这防止模型或手工编辑伪造证据——quote 非空但实际不存在于原文。
 */
export function validateStoryAssetSnapshot(
  snapshot: StoryAssetSnapshot,
  outlinePlotNodeIds?: ReadonlySet<string>,
  outlineSourceQuotes?: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<StoryAssetValidationIssue> {
  const issues: StoryAssetValidationIssue[] = [];
  const characterIds = new Set(snapshot.characters.map((item) => item.id));
  const threadIds = new Set(snapshot.plotThreads.map((item) => item.id));
  const checkPlot = (id: string, path: string): void => {
    if (outlinePlotNodeIds !== undefined && !outlinePlotNodeIds.has(id)) issues.push({ path, message: `引用了不存在的情节节点 ${id}` });
  };
  const checkEvidence = (evidence: { readonly plotNodeId?: string; readonly quote: string }, path: string): void => {
    if (evidence.plotNodeId !== undefined) checkPlot(evidence.plotNodeId, path);
    if (outlineSourceQuotes !== undefined && evidence.plotNodeId !== undefined && evidence.quote.trim().length > 0) {
      const sourceQuotes = outlineSourceQuotes.get(evidence.plotNodeId);
      if (sourceQuotes === undefined || sourceQuotes.length === 0) {
        issues.push({ path, message: `证据引用的情节节点 ${evidence.plotNodeId} 在旧稿大纲中无原文来源` });
      } else if (!sourceQuotes.some((source) => source.includes(evidence.quote.trim()) || evidence.quote.trim().includes(source.trim()))) {
        issues.push({ path, message: `证据引用片段与旧稿大纲来源不匹配` });
      }
    }
  };
  const checkClaim = (claim: CredibleClaim<unknown>, path: string): void => {
    if ((claim.credibility === 'explicit' || claim.credibility === 'inferred') && !claim.evidence.some((item) => item.quote.trim().length > 0)) issues.push({ path, message: '“原文明确”结论缺少原文证据' });
    claim.evidence.forEach((item, index) => checkEvidence(item, `${path}.evidence[${index}]`));
  };
  snapshot.plotThreads.forEach((thread, index) => {
    checkClaim(thread.goal, `plotThreads[${index}].goal`);
    thread.plotNodeIds.forEach((id, nodeIndex) => checkPlot(id, `plotThreads[${index}].plotNodeIds[${nodeIndex}]`));
    thread.characterIds.forEach((id, characterIndex) => { if (!characterIds.has(id)) issues.push({ path: `plotThreads[${index}].characterIds[${characterIndex}]`, message: `引用了不存在的人物 ${id}` }); });
    thread.stages.forEach((stage, stageIndex) => stage.plotNodeIds.forEach((id, nodeIndex) => checkPlot(id, `plotThreads[${index}].stages[${stageIndex}].plotNodeIds[${nodeIndex}]`)));
  });
  snapshot.characters.forEach((character, index) => {
    const claims: ReadonlyArray<readonly [string, CredibleClaim<unknown>]> = [['identity', character.identity], ['appearance', character.appearance], ['abilities', character.abilities], ['personality', character.personality], ['languageStyle', character.languageStyle], ['desire', character.desire], ['goal', character.goal], ['fear', character.fear], ['weakness', character.weakness], ['currentStatus', character.currentStatus]];
    claims.forEach(([name, claim]) => checkClaim(claim, `characters[${index}].${name}`));
    character.plotThreadIds.forEach((id, threadIndex) => { if (!threadIds.has(id)) issues.push({ path: `characters[${index}].plotThreadIds[${threadIndex}]`, message: `引用了不存在的情节线 ${id}` }); });
  });
  snapshot.relations.forEach((relation, index) => {
    if (!characterIds.has(relation.fromCharacterId)) issues.push({ path: `relations[${index}].fromCharacterId`, message: `引用了不存在的人物 ${relation.fromCharacterId}` });
    if (!characterIds.has(relation.toCharacterId)) issues.push({ path: `relations[${index}].toCharacterId`, message: `引用了不存在的人物 ${relation.toCharacterId}` });
    if (relation.fromCharacterId === relation.toCharacterId) issues.push({ path: `relations[${index}]`, message: '人物关系不能指向自身' });
    checkClaim(relation.description, `relations[${index}].description`);
    relation.changes.forEach((change, changeIndex) => checkPlot(change.plotNodeId, `relations[${index}].changes[${changeIndex}]`));
  });
  snapshot.arcs.forEach((arc, index) => { if (!characterIds.has(arc.characterId)) issues.push({ path: `arcs[${index}].characterId`, message: `引用了不存在的人物 ${arc.characterId}` }); arc.turningPoints.forEach((point, pointIndex) => checkPlot(point.plotNodeId, `arcs[${index}].turningPoints[${pointIndex}]`)); });
  snapshot.foreshadowings.forEach((item, index) => { checkPlot(item.plantedPlotNodeId, `foreshadowings[${index}].plantedPlotNodeId`); if (item.paidOffPlotNodeId !== undefined) checkPlot(item.paidOffPlotNodeId, `foreshadowings[${index}].paidOffPlotNodeId`); item.advancedPlotNodeIds.forEach((id, nodeIndex) => checkPlot(id, `foreshadowings[${index}].advancedPlotNodeIds[${nodeIndex}]`)); if (item.credibility === 'explicit' && !item.evidence.some((evidence) => evidence.quote.trim().length > 0)) issues.push({ path: `foreshadowings[${index}].evidence`, message: '“原文明确”伏笔缺少原文证据' }); item.evidence.forEach((evidence, evidenceIndex) => checkEvidence(evidence, `foreshadowings[${index}].evidence[${evidenceIndex}]`)); });
  return issues;
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
