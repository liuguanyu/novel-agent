/**
 * 故事资产生命周期领域服务 (Roadmap M2 验收加固)
 *
 * 把确认、修正、发布和 DTO 投影逻辑从 ipc-handlers.ts 中提取为独立领域服务，
 * 让 IPC handler 和 smoke 测试共用同一代码路径，避免手工复制逻辑导致的行为漂移。
 *
 * 纯函数部分（confirmAsset/editAsset/publishAsset/projectSnapshot）不涉及 I/O，
 * 可被测试直接调用。I/O 包装（confirmAssetPersisted 等）封装读盘→变换→版本→存盘流程。
 */

import type { StoryAssetSnapshot, Evidence } from '../../core/story-asset/index.js';
import { validateStoryAssetSnapshot } from '../../core/story-asset/index.js';
import type { LegacyOutline } from '../../core/legacy-organization/index.js';
import type {
  StoryAssetSnapshotDto,
  CredibleClaimDto,
  PlotThreadDto,
  CharacterProfileDto,
  CharacterRelationDto,
  CharacterArcDto,
  ForeshadowingDto,
} from '../../shared/ipc/index.js';
import * as assetStore from './asset-store.js';

/* ── 类型别名 ──────────────────────────────────────────────── */

export type AssetKind = 'plotThread' | 'character' | 'relation' | 'arc' | 'foreshadowing';

/* ── 纯领域操作（无 I/O） ──────────────────────────────────── */

/**
 * 确认单个故事资产：draft → confirmed。
 * 已确认或已正式的资产不受影响。
 */
export function confirmAsset(snapshot: StoryAssetSnapshot, kind: AssetKind, assetId: string): StoryAssetSnapshot {
  const now = new Date().toISOString();
  const confirmItem = <T extends { readonly id: string; readonly status: string }>(items: ReadonlyArray<T>): ReadonlyArray<T> =>
    items.map((item) => item.id === assetId && item.status === 'draft' ? { ...item, status: 'confirmed' as const } : item);
  return {
    ...snapshot,
    updatedAt: now,
    plotThreads: kind === 'plotThread' ? confirmItem(snapshot.plotThreads) : snapshot.plotThreads,
    characters: kind === 'character' ? confirmItem(snapshot.characters) : snapshot.characters,
    relations: kind === 'relation' ? confirmItem(snapshot.relations) : snapshot.relations,
    arcs: kind === 'arc' ? confirmItem(snapshot.arcs) : snapshot.arcs,
    foreshadowings: kind === 'foreshadowing'
      ? snapshot.foreshadowings.map((item) => item.id === assetId && item.status === 'draft' ? { ...item, status: 'confirmed' as const } : item)
      : snapshot.foreshadowings,
  };
}

/**
 * 修正单个故事资产的结论值和作者备注。
 * 修正后资产状态回退为 draft（需要重新确认）。
 */
export function editAsset(
  snapshot: StoryAssetSnapshot,
  kind: AssetKind,
  assetId: string,
  value: string,
  authorNote?: string,
): StoryAssetSnapshot {
  const now = new Date().toISOString();
  const update = <T extends { readonly id: string }>(items: ReadonlyArray<T>, fn: (item: T) => T): ReadonlyArray<T> =>
    items.map((item) => item.id === assetId ? fn(item) : item);
  const note = authorNote?.trim();
  const updateClaim = <T extends { readonly value: string }>(claim: T): T => ({
    ...claim,
    value: value.trim(),
    ...(note === undefined || note.length === 0 ? {} : { authorNote: note }),
  });
  return {
    ...snapshot,
    updatedAt: now,
    plotThreads: kind === 'plotThread'
      ? update(snapshot.plotThreads, (item) => ({ ...item, goal: updateClaim(item.goal) }))
      : snapshot.plotThreads,
    characters: kind === 'character'
      ? update(snapshot.characters, (item) => ({ ...item, identity: updateClaim(item.identity) }))
      : snapshot.characters,
    relations: kind === 'relation'
      ? update(snapshot.relations, (item) => ({ ...item, description: updateClaim(item.description) }))
      : snapshot.relations,
    arcs: kind === 'arc'
      ? update(snapshot.arcs, (item) => ({ ...item, description: value.trim() }))
      : snapshot.arcs,
    foreshadowings: snapshot.foreshadowings,
  };
}

/**
 * 从旧稿大纲构建 plotNodeId → 原文引用片段列表 的映射。
 * 用于 validateStoryAssetSnapshot 的 quote↔source 匹配验证。
 */
export function buildOutlineSourceQuotes(outline: LegacyOutline): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of outline.nodes) {
    if (node.kind !== 'plot-beat') continue;
    const quotes: string[] = [];
    for (const source of node.sources) {
      if (source.quote !== undefined && source.quote.trim().length > 0) {
        quotes.push(source.quote);
      }
    }
    if (quotes.length > 0) {
      map.set(node.id, quotes);
    }
  }
  return map;
}

/**
 * 发布正式资产：校验通过 + 全部 confirmed → 全部转 formal。
 * 返回新的 formal 快照（尚未保存）。
 * 如果校验失败或存在未确认资产，抛出错误。
 */
export function publishAsset(
  snapshot: StoryAssetSnapshot,
  outlinePlotNodeIds?: ReadonlySet<string>,
  outlineSourceQuotes?: ReadonlyMap<string, ReadonlyArray<string>>,
): StoryAssetSnapshot {
  const validationIssues = validateStoryAssetSnapshot(snapshot, outlinePlotNodeIds, outlineSourceQuotes);
  if (validationIssues.length > 0) {
    throw new Error(`故事资产校验失败：${validationIssues[0]?.message ?? '未知问题'}`);
  }
  const allItems = [...snapshot.plotThreads, ...snapshot.characters, ...snapshot.relations, ...snapshot.arcs, ...snapshot.foreshadowings];
  if (allItems.some((item) => item.status !== undefined && item.status !== 'confirmed' && item.status !== 'formal')) {
    throw new Error('仍有未确认的故事资产，不能发布');
  }
  const now = new Date().toISOString();
  return {
    ...snapshot,
    updatedAt: now,
    plotThreads: snapshot.plotThreads.map((item) => ({ ...item, status: 'formal' as const })),
    characters: snapshot.characters.map((item) => ({ ...item, status: 'formal' as const })),
    relations: snapshot.relations.map((item) => ({ ...item, status: 'formal' as const })),
    arcs: snapshot.arcs.map((item) => ({ ...item, status: 'formal' as const })),
    foreshadowings: snapshot.foreshadowings.map((item) => ({ ...item, status: 'formal' as const })),
  };
}

/* ── DTO 投影（core → IPC DTO） ────────────────────────────── */

export function projectClaim(claim: { readonly value: string; readonly credibility: string; readonly evidence: ReadonlyArray<Evidence>; readonly authorNote?: string }): CredibleClaimDto {
  return {
    value: claim.value,
    credibility: claim.credibility as CredibleClaimDto['credibility'],
    evidence: claim.evidence,
    ...(claim.authorNote === undefined ? {} : { authorNote: claim.authorNote }),
  };
}

export function projectSnapshot(snapshot: StoryAssetSnapshot): StoryAssetSnapshotDto {
  const plotThreads: ReadonlyArray<PlotThreadDto> = snapshot.plotThreads.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    goal: projectClaim(t.goal),
    plotNodeIds: t.plotNodeIds,
    characterIds: t.characterIds,
    stages: t.stages,
    keyEvents: t.keyEvents,
    ...(t.timeAnchor === undefined ? {} : { timeAnchor: projectClaim(t.timeAnchor) }),
    status: t.status,
  }));
  const characters: ReadonlyArray<CharacterProfileDto> = snapshot.characters.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    identity: projectClaim(c.identity),
    appearance: projectClaim(c.appearance),
    abilities: projectClaim(c.abilities),
    personality: projectClaim(c.personality),
    languageStyle: projectClaim(c.languageStyle),
    desire: projectClaim(c.desire),
    goal: projectClaim(c.goal),
    fear: projectClaim(c.fear),
    weakness: projectClaim(c.weakness),
    currentStatus: projectClaim(c.currentStatus),
    plotThreadIds: c.plotThreadIds,
    ...(c.narrativeFunction === undefined ? {} : { narrativeFunction: projectClaim(c.narrativeFunction) }),
    status: c.status,
  }));
  const relations: ReadonlyArray<CharacterRelationDto> = snapshot.relations.map((r) => ({
    id: r.id,
    fromCharacterId: r.fromCharacterId,
    toCharacterId: r.toCharacterId,
    kind: r.kind,
    description: projectClaim(r.description),
    changes: r.changes,
    status: r.status,
  }));
  const arcs: ReadonlyArray<CharacterArcDto> = snapshot.arcs.map((a) => ({
    id: a.id,
    characterId: a.characterId,
    description: a.description,
    turningPoints: a.turningPoints,
    ...(a.startState === undefined ? {} : { startState: a.startState }),
    ...(a.endState === undefined ? {} : { endState: a.endState }),
    status: a.status,
  }));
  const foreshadowings: ReadonlyArray<ForeshadowingDto> = snapshot.foreshadowings.map((f) => ({
    id: f.id,
    description: f.description,
    state: f.state,
    plantedPlotNodeId: f.plantedPlotNodeId,
    ...(f.paidOffPlotNodeId === undefined ? {} : { paidOffPlotNodeId: f.paidOffPlotNodeId }),
    advancedPlotNodeIds: f.advancedPlotNodeIds,
    credibility: f.credibility,
    evidence: f.evidence,
    status: f.status,
  }));
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    plotThreads,
    characters,
    relations,
    arcs,
    foreshadowings,
    sourceOutlineVersion: snapshot.sourceOutlineVersion,
  };
}

/* ── I/O 包装（读盘 → 变换 → 版本 → 存盘） ──────────────────── */

/**
 * 确认单个故事资产并持久化。
 * 1. 读取当前草案
 * 2. 版本检查
 * 3. 应用 confirmAsset 变换
 * 4. 分配新版本号
 * 5. 保存到 draft lane
 */
export async function confirmAssetPersisted(
  projectDir: string,
  kind: AssetKind,
  assetId: string,
  expectedVersion?: number,
): Promise<StoryAssetSnapshot> {
  const snapshot = await assetStore.loadStoryAssetSnapshot(projectDir);
  if (snapshot === undefined) throw new Error('故事资产快照不存在，请先提炼');
  if (expectedVersion !== undefined && expectedVersion !== snapshot.version) {
    throw new Error(`故事资产版本冲突：当前版本为 ${snapshot.version}`);
  }
  const updated = confirmAsset(snapshot, kind, assetId);
  const targetItems = kind === 'plotThread' ? updated.plotThreads
    : kind === 'character' ? updated.characters
    : kind === 'relation' ? updated.relations
    : kind === 'arc' ? updated.arcs
    : updated.foreshadowings;
  const target = targetItems.find((item) => item.id === assetId);
  if (target === undefined) throw new Error(`故事资产不存在：${assetId}`);
  if (target.status !== 'confirmed') throw new Error(`故事资产无法确认，当前状态为 ${target.status}`);
  const version = await assetStore.nextStoryAssetVersion(projectDir);
  const versioned: StoryAssetSnapshot = { ...updated, id: `snapshot-${Date.now()}`, version };
  await assetStore.saveStoryAssetSnapshot(projectDir, versioned, 'draft', snapshot.version);
  return versioned;
}

/**
 * 修正单个故事资产并持久化。
 */
export async function editAssetPersisted(
  projectDir: string,
  kind: AssetKind,
  assetId: string,
  value: string,
  authorNote: string | undefined,
  expectedVersion: number,
): Promise<StoryAssetSnapshot> {
  const snapshot = await assetStore.loadStoryAssetSnapshot(projectDir);
  if (snapshot === undefined) throw new Error('故事资产快照不存在，请先提炼');
  if (snapshot.version !== expectedVersion) {
    throw new Error(`故事资产版本冲突：当前版本为 ${snapshot.version}`);
  }
  const updated = editAsset(snapshot, kind, assetId, value, authorNote);
  const version = await assetStore.nextStoryAssetVersion(projectDir);
  const versioned: StoryAssetSnapshot = { ...updated, id: `snapshot-${Date.now()}`, version };
  await assetStore.saveStoryAssetSnapshot(projectDir, versioned, 'draft', snapshot.version);
  return versioned;
}

/**
 * 发布正式资产并持久化。
 * 1. 读取当前草案
 * 2. 版本检查
 * 3. 加载旧稿大纲，构建 plotNodeIds 和 sourceQuotes
 * 4. 调用 publishAsset（校验 + 全 confirmed 检查 + 转 formal）
 * 5. 保存到 formal lane
 */
export async function publishAssetPersisted(
  projectDir: string,
  outline: LegacyOutline | undefined,
  expectedVersion: number,
): Promise<StoryAssetSnapshot> {
  const snapshot = await assetStore.loadStoryAssetSnapshot(projectDir);
  if (snapshot === undefined) throw new Error('故事资产草案不存在，请先提炼');
  if (snapshot.version !== expectedVersion) {
    throw new Error(`故事资产版本冲突：当前版本为 ${snapshot.version}`);
  }
  const plotIds = outline === undefined ? undefined : new Set(outline.nodes.filter((item) => item.kind === 'plot-beat').map((item) => item.id));
  const sourceQuotes = outline === undefined ? undefined : buildOutlineSourceQuotes(outline);
  const formal = publishAsset(snapshot, plotIds, sourceQuotes);
  const versioned: StoryAssetSnapshot = { ...formal, id: `snapshot-${Date.now()}`, version: await assetStore.nextStoryAssetVersion(projectDir) };
  await assetStore.saveStoryAssetSnapshot(projectDir, versioned, 'formal', snapshot.version);
  return versioned;
}
