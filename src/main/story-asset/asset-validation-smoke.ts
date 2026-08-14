/**
 * 故事资产校验层验收 smoke — 证据真实性、引用完整性、发布门槛
 *
 * 所有核心类型属性为 readonly，测试用 spread 替换而非直接赋值。
 */

import assert from 'node:assert/strict';
import {
  validateStoryAssetSnapshot,
  formalAssets,
  explicitClaim,
  inferredClaim,
  pendingDesignClaim,
  type StoryAssetSnapshot,
  type PlotThread,
  type CharacterProfile,
  type CharacterRelation,
  type CharacterArc,
  type Foreshadowing,
  type CredibleClaim,
} from '../../core/story-asset/index.js';

/* ── 夹具 ──────────────────────────────────────────────────── */

const NOW = '2026-08-14T00:00:00.000Z';
const PLOT_IDS = new Set(['plot-1', 'plot-2', 'plot-3']);

function claim(value: string, credibility: CredibleClaim<string>['credibility'], evidence: ReadonlyArray<{ quote: string; plotNodeId?: string }> = []): CredibleClaim<string> {
  return { value, credibility, evidence };
}

function makeValidPlotThread(id: string, status: 'draft' | 'formal' = 'draft'): PlotThread {
  return {
    id,
    name: `情节线-${id}`,
    kind: 'main',
    goal: explicitClaim('拿到密信', '顾长风收到了一封密信', 'plot-1'),
    plotNodeIds: ['plot-1', 'plot-2'],
    characterIds: ['ch-1'],
    stages: [],
    keyEvents: [],
    status,
  };
}

function makeValidCharacter(id: string, status: 'draft' | 'formal' = 'draft', plotThreadIds: ReadonlyArray<string> = ['pt-1']): CharacterProfile {
  return {
    id,
    name: `人物-${id}`,
    aliases: [],
    identity: explicitClaim('特工', '他是特工', 'plot-1'),
    appearance: pendingDesignClaim('短发'),
    abilities: pendingDesignClaim('撬锁'),
    personality: inferredClaim('沉稳', [{ quote: '他一言不发', plotNodeId: 'plot-1' }]),
    languageStyle: pendingDesignClaim('简练'),
    desire: pendingDesignClaim('完成任务'),
    goal: pendingDesignClaim('破译密信'),
    fear: pendingDesignClaim('暴露身份'),
    weakness: pendingDesignClaim('过于自信'),
    currentStatus: pendingDesignClaim('活跃'),
    plotThreadIds,
    status,
  };
}

function makeValidRelation(status: 'draft' | 'formal' = 'draft'): CharacterRelation {
  return {
    id: 'rel-1',
    fromCharacterId: 'ch-1',
    toCharacterId: 'ch-2',
    kind: 'ally',
    description: inferredClaim('合作关系', [{ quote: '他们一起行动', plotNodeId: 'plot-1' }]),
    changes: [],
    status,
  };
}

function makeValidArc(status: 'draft' | 'formal' = 'draft'): CharacterArc {
  return {
    id: 'arc-1',
    characterId: 'ch-1',
    description: '从盲信到独立判断',
    turningPoints: [{ plotNodeId: 'plot-2', description: '发现真相' }],
    status,
  };
}

function makeValidForeshadowing(status: 'draft' | 'formal' = 'draft'): Foreshadowing {
  return {
    id: 'fs-1',
    description: '密信中的暗号',
    state: 'planted',
    plantedPlotNodeId: 'plot-1',
    advancedPlotNodeIds: [],
    credibility: 'explicit',
    evidence: [{ quote: '信上有暗号', plotNodeId: 'plot-1' }],
    status,
  };
}

function makeValidSnapshot(status: 'draft' | 'formal' = 'draft'): StoryAssetSnapshot {
  return {
    id: 'snapshot-valid',
    projectId: 'project-test',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    plotThreads: [makeValidPlotThread('pt-1', status)],
    characters: [makeValidCharacter('ch-1', status), makeValidCharacter('ch-2', status, [])],
    relations: [makeValidRelation(status)],
    arcs: [makeValidArc(status)],
    foreshadowings: [makeValidForeshadowing(status)],
    sourceOutlineVersion: 1,
  };
}

/** 替换情节线列表中的指定项 */
function replacePlotThread(snap: StoryAssetSnapshot, index: number, patch: Partial<PlotThread>): StoryAssetSnapshot {
  const plotThreads = snap.plotThreads.map((t, i) => i === index ? { ...t, ...patch } : t);
  return { ...snap, plotThreads };
}

function replaceCharacter(snap: StoryAssetSnapshot, index: number, patch: Partial<CharacterProfile>): StoryAssetSnapshot {
  const characters = snap.characters.map((c, i) => i === index ? { ...c, ...patch } : c);
  return { ...snap, characters };
}

function replaceRelation(snap: StoryAssetSnapshot, index: number, patch: Partial<CharacterRelation>): StoryAssetSnapshot {
  const relations = snap.relations.map((r, i) => i === index ? { ...r, ...patch } : r);
  return { ...snap, relations };
}

function replaceArc(snap: StoryAssetSnapshot, index: number, patch: Partial<CharacterArc>): StoryAssetSnapshot {
  const arcs = snap.arcs.map((a, i) => i === index ? { ...a, ...patch } : a);
  return { ...snap, arcs };
}

function replaceForeshadowing(snap: StoryAssetSnapshot, index: number, patch: Partial<Foreshadowing>): StoryAssetSnapshot {
  const foreshadowings = snap.foreshadowings.map((f, i) => i === index ? { ...f, ...patch } : f);
  return { ...snap, foreshadowings };
}

/* ── 测试 1：证据真实性 ────────────────────────────────────── */

function testEvidenceTruthfulness(): void {
  // explicit 无证据 → 失败
  let snap = replacePlotThread(makeValidSnapshot(), 0, {
    goal: claim('目标', 'explicit', []),
  });
  let issues = validateStoryAssetSnapshot(snap, PLOT_IDS);
  assert.ok(issues.some((i) => i.message.includes('原文证据')), 'explicit 无证据应校验失败');

  // inferred 无证据 → 失败
  snap = replacePlotThread(makeValidSnapshot(), 0, {
    goal: claim('目标', 'inferred', []),
  });
  issues = validateStoryAssetSnapshot(snap, PLOT_IDS);
  assert.ok(issues.some((i) => i.message.includes('原文证据')), 'inferred 无证据应校验失败');

  // pending-confirmation 无证据 → 不校验证据
  snap = replacePlotThread(makeValidSnapshot(), 0, {
    goal: claim('目标', 'pending-confirmation', []),
  });
  issues = validateStoryAssetSnapshot(snap, PLOT_IDS);
  assert.ok(!issues.some((i) => i.message.includes('原文证据')), 'pending-confirmation 无证据不报错');

  // pending-design 无证据 → 不校验证据
  snap = replacePlotThread(makeValidSnapshot(), 0, {
    goal: claim('目标', 'pending-design', []),
  });
  issues = validateStoryAssetSnapshot(snap, PLOT_IDS);
  assert.ok(!issues.some((i) => i.message.includes('原文证据')), 'pending-design 无证据不报错');

  // 证据 quote 有值但 plotNodeId 不在 plotIds → 失败
  snap = replacePlotThread(makeValidSnapshot(), 0, {
    goal: claim('目标', 'explicit', [{ quote: '有引用', plotNodeId: 'plot-nonexistent' }]),
  });
  issues = validateStoryAssetSnapshot(snap, PLOT_IDS);
  assert.ok(issues.some((i) => i.message.includes('不存在的情节节点')), '证据引用不存在情节节点应校验失败');
}

/* ── 测试 2：无效情节节点引用 ──────────────────────────────── */

function testInvalidPlotNodeReference(): void {
  const snap = replacePlotThread(makeValidSnapshot(), 0, {
    plotNodeIds: ['plot-1', 'plot-nonexistent'],
  });
  const issues = validateStoryAssetSnapshot(snap, PLOT_IDS);
  assert.ok(issues.some((i) => i.message.includes('不存在的情节节点')), '情节线引用不存在 plotNode 应校验失败');

  const snap2 = replacePlotThread(makeValidSnapshot(), 0, {
    stages: [{ kind: 'setup', plotNodeIds: ['plot-nonexistent'], description: '阶段' }],
  });
  const issues2 = validateStoryAssetSnapshot(snap2, PLOT_IDS);
  assert.ok(issues2.some((i) => i.message.includes('不存在的情节节点')), '阶段引用不存在 plotNode 应校验失败');
}

/* ── 测试 3：无效人物引用 ────────────────────────────────────── */

function testInvalidCharacterReference(): void {
  const snap = replacePlotThread(makeValidSnapshot(), 0, {
    characterIds: ['ch-nonexistent'],
  });
  const issues = validateStoryAssetSnapshot(snap);
  assert.ok(issues.some((i) => i.message.includes('不存在的人物')), '情节线引用不存在的人物应校验失败');
}

/* ── 测试 4：无效情节线引用 ──────────────────────────────── */

function testInvalidPlotThreadReference(): void {
  const snap = replaceCharacter(makeValidSnapshot(), 0, {
    plotThreadIds: ['pt-nonexistent'],
  });
  const issues = validateStoryAssetSnapshot(snap);
  assert.ok(issues.some((i) => i.message.includes('不存在的情节线')), '人物引用不存在的情节线应校验失败');
}

/* ── 测试 5：人物自指关系 ──────────────────────────────────── */

function testSelfRelation(): void {
  const snap = replaceRelation(makeValidSnapshot(), 0, {
    fromCharacterId: 'ch-1',
    toCharacterId: 'ch-1',
  });
  const issues = validateStoryAssetSnapshot(snap);
  assert.ok(issues.some((i) => i.message.includes('自身')), '人物与自身的关系应校验失败');
}

/* ── 测试 6：关系引用不存在的人物 ──────────────────────────── */

function testRelationInvalidCharacter(): void {
  const snap = replaceRelation(makeValidSnapshot(), 0, {
    fromCharacterId: 'ch-nonexistent',
  });
  const issues = validateStoryAssetSnapshot(snap);
  assert.ok(issues.some((i) => i.message.includes('不存在的人物')), '关系引用不存在的人物应校验失败');
}

/* ── 测试 7：成长弧引用不存在的人物 ──────────────────────────── */

function testArcInvalidCharacter(): void {
  const snap = replaceArc(makeValidSnapshot(), 0, {
    characterId: 'ch-nonexistent',
  });
  const issues = validateStoryAssetSnapshot(snap);
  assert.ok(issues.some((i) => i.message.includes('不存在的人物')), '成长弧引用不存在的人物应校验失败');
}

/* ── 测试 8：伏笔引用不存在的情节节点 ──────────────────────────── */

function testForeshadowingInvalidPlotNode(): void {
  const snap = replaceForeshadowing(makeValidSnapshot(), 0, {
    plantedPlotNodeId: 'plot-nonexistent',
  });
  const issues = validateStoryAssetSnapshot(snap, PLOT_IDS);
  assert.ok(issues.some((i) => i.message.includes('不存在的情节节点')), '伏笔引用不存在的情节节点应校验失败');

  const snap2 = replaceForeshadowing(makeValidSnapshot(), 0, {
    evidence: [],
  });
  const issues2 = validateStoryAssetSnapshot(snap2, PLOT_IDS);
  assert.ok(issues2.some((i) => i.message.includes('原文证据')), '伏笔 explicit 无证据应校验失败');
}

/* ── 测试 9：完整快照通过校验 ──────────────────────────────── */

function testValidSnapshotPasses(): void {
  const snap = makeValidSnapshot();
  const issues = validateStoryAssetSnapshot(snap, PLOT_IDS);
  assert.equal(issues.length, 0, '完整有效快照应无校验问题');
}

/* ── 测试 10：formalAssets 过滤 ────────────────────────────── */

function testFormalAssetsFiltering(): void {
  // 混合 draft 和 formal
  const snap: StoryAssetSnapshot = {
    ...makeValidSnapshot('draft'),
    plotThreads: [
      makeValidPlotThread('pt-1', 'formal'),
    ],
    characters: [
      makeValidCharacter('ch-1', 'formal'),
      makeValidCharacter('ch-2', 'draft', []),
    ],
    relations: [{ ...makeValidRelation('draft') }],
    arcs: [{ ...makeValidArc('draft') }],
    foreshadowings: [{ ...makeValidForeshadowing('draft') }],
  };
  const formal = formalAssets(snap);
  assert.equal(formal.plotThreads.length, 1, 'formalAssets 只返回 formal 情节线');
  assert.equal(formal.characters.length, 1, 'formalAssets 只返回 formal 人物');
  assert.equal(formal.relations.length, 0, 'draft 关系不进入 formal');
  assert.equal(formal.arcs.length, 0, 'draft 成长弧不进入 formal');
  assert.equal(formal.foreshadowings.length, 0, 'draft 伏笔不进入 formal');
}

/* ── 测试 11：draft/formal 隔离 ────────────────────────────── */

function testDraftFormalIsolation(): void {
  // 全部 formal
  const formalSnap = makeValidSnapshot('formal');
  const formal = formalAssets(formalSnap);
  assert.equal(formal.plotThreads.length, 1);
  assert.equal(formal.characters.length, 2);
  assert.equal(formal.relations.length, 1);
  assert.equal(formal.arcs.length, 1);
  assert.equal(formal.foreshadowings.length, 1);

  // 全部 draft → formalAssets 为空
  const draftSnap = makeValidSnapshot('draft');
  const formalFromDraft = formalAssets(draftSnap);
  assert.equal(formalFromDraft.plotThreads.length, 0, 'draft 快照不应产出 formal 资产');
  assert.equal(formalFromDraft.characters.length, 0);
  assert.equal(formalFromDraft.relations.length, 0);
  assert.equal(formalFromDraft.arcs.length, 0);
  assert.equal(formalFromDraft.foreshadowings.length, 0);
}

/* ── 测试 12：abandoned 伏笔被 formalAssets 排除 ─────────── */

function testAbandonedForeshadowingExcluded(): void {
  const snap: StoryAssetSnapshot = {
    ...makeValidSnapshot('formal'),
    foreshadowings: [
      makeValidForeshadowing('formal'),
      {
        id: 'fs-2',
        description: '废弃伏笔',
        state: 'abandoned',
        plantedPlotNodeId: 'plot-1',
        advancedPlotNodeIds: [],
        credibility: 'explicit',
        evidence: [{ quote: '废弃了', plotNodeId: 'plot-1' }],
        status: 'formal',
      },
    ],
  };
  const formal = formalAssets(snap);
  assert.equal(formal.foreshadowings.length, 1, 'abandoned 伏笔不进入 formal');
  assert.equal(formal.foreshadowings[0]!.state, 'planted');
}

/* ── 主入口 ─────────────────────────────────────────────────── */

function main(): void {
  console.log('═'.repeat(60));
  console.log('故事资产校验层验收');
  console.log('═'.repeat(60));

  console.log('\n━ testEvidenceTruthfulness');
  testEvidenceTruthfulness();
  console.log('✅ 证据真实性：explicit/inferred 无证据失败，pending-* 不校验');

  console.log('\n━ testInvalidPlotNodeReference');
  testInvalidPlotNodeReference();
  console.log('✅ 无效情节节点引用校验');

  console.log('\n━ testInvalidCharacterReference');
  testInvalidCharacterReference();
  console.log('✅ 无效人物引用校验');

  console.log('\n━ testInvalidPlotThreadReference');
  testInvalidPlotThreadReference();
  console.log('✅ 无效情节线引用校验');

  console.log('\n━ testSelfRelation');
  testSelfRelation();
  console.log('✅ 人物自指关系校验');

  console.log('\n━ testRelationInvalidCharacter');
  testRelationInvalidCharacter();
  console.log('✅ 关系引用不存在人物校验');

  console.log('\n━ testArcInvalidCharacter');
  testArcInvalidCharacter();
  console.log('✅ 成长弧引用不存在人物校验');

  console.log('\n━ testForeshadowingInvalidPlotNode');
  testForeshadowingInvalidPlotNode();
  console.log('✅ 伏笔引用无效情节节点 + 伏笔证据校验');

  console.log('\n━ testValidSnapshotPasses');
  testValidSnapshotPasses();
  console.log('✅ 完整有效快照通过校验');

  console.log('\n━ testFormalAssetsFiltering');
  testFormalAssetsFiltering();
  console.log('✅ formalAssets 过滤草案');

  console.log('\n━ testDraftFormalIsolation');
  testDraftFormalIsolation();
  console.log('✅ draft/formal 隔离');

  console.log('\n━ testAbandonedForeshadowingExcluded');
  testAbandonedForeshadowingExcluded();
  console.log('✅ abandoned 伏笔被 formalAssets 排除');

  console.log('\n' + '═'.repeat(60));
  console.log('全部校验层验收通过');
  console.log('═'.repeat(60));
}

main();
