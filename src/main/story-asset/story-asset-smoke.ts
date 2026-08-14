/**
 * 故事资产模型 smoke 测试
 *
 * 验证：
 * 1. 类型可构造
 * 2. CredibleClaim 辅助函数正确标注可信度
 * 3. formalAssets 过滤草案
 * 4. 冲突检测（别名重叠、情节线重叠）
 */

import assert from 'node:assert/strict';
import {
  explicitClaim,
  inferredClaim,
  pendingConfirmationClaim,
  pendingDesignClaim,
  formalAssets,
  assetStatusCounts,
  detectCharacterAliasConflicts,
  detectPlotOverlapConflicts,
  type StoryAssetSnapshot,
  type PlotThread,
  type CharacterProfile,
  type CharacterRelation,
  type CharacterArc,
  type Foreshadowing,
} from '../../core/story-asset/index.js';

// ─── CredibleClaim 辅助函数 ───────────────────────────────────

function smokeClaimHelpers(): void {
  const explicit = explicitClaim('佐藤是日军特务机关驻上海负责人', '佐藤微微皱眉', 'plot-1');
  assert.equal(explicit.credibility, 'explicit');
  assert.equal(explicit.evidence.length, 1);
  assert.equal(explicit.evidence[0]?.plotNodeId, 'plot-1');

  const inferred = inferredClaim('顾长风对老刘有基本信任', [{ quote: '老刘送来的情报', plotNodeId: 'plot-1' }]);
  assert.equal(inferred.credibility, 'inferred');

  const pending = pendingConfirmationClaim('佐藤可能早已知道有人会来', [{ quote: '佐藤笑了', plotNodeId: 'plot-4' }]);
  assert.equal(pending.credibility, 'pending-confirmation');

  const design = pendingDesignClaim('需要补充佐藤的背景故事');
  assert.equal(design.credibility, 'pending-design');
  assert.equal(design.evidence.length, 0);
}

// ─── formalAssets 过滤 ────────────────────────────────────────

function smokeFormalAssets(): void {
  const snapshot: StoryAssetSnapshot = {
    id: 'snapshot-1',
    projectId: 'project-1',
    version: 1,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    plotThreads: [
      { id: 'thread-1', name: '主线', kind: 'main', goal: explicitClaim('拿到印章', '证据'), plotNodeIds: ['p1'], characterIds: ['c1'], stages: [], keyEvents: [], status: 'formal' },
      { id: 'thread-2', name: '支线', kind: 'sub', goal: explicitClaim('保护线人', '证据'), plotNodeIds: ['p2'], characterIds: ['c2'], stages: [], keyEvents: [], status: 'draft' },
    ],
    characters: [
      { id: 'c1', name: '顾长风', aliases: ['老顾'], identity: explicitClaim('特工', '正文'), appearance: explicitClaim('短发', '正文'), abilities: explicitClaim('撬锁', '正文'), personality: explicitClaim('沉稳', '正文'), languageStyle: explicitClaim('简练', '正文'), desire: explicitClaim('拿到印章', '正文'), goal: explicitClaim('完成任务', '正文'), fear: explicitClaim('暴露身份', '正文'), weakness: explicitClaim('过于自信', '正文'), currentStatus: explicitClaim('逃回公寓', '正文'), plotThreadIds: ['thread-1'], status: 'formal' },
      { id: 'c2', name: '老刘', aliases: [], identity: explicitClaim('线人', '正文'), appearance: explicitClaim('中年', '正文'), abilities: explicitClaim('情报收集', '正文'), personality: explicitClaim('谨慎', '正文'), languageStyle: explicitClaim('圆滑', '正文'), desire: explicitClaim('自保', '正文'), goal: explicitClaim('传递情报', '正文'), fear: explicitClaim('被发现', '正文'), weakness: explicitClaim('情报不一定准确', '正文'), currentStatus: explicitClaim('等待回复', '正文'), plotThreadIds: ['thread-2'], status: 'draft' },
    ],
    relations: [],
    arcs: [],
    foreshadowings: [],
    sourceOutlineVersion: 1,
  };

  const formal = formalAssets(snapshot);
  assert.equal(formal.plotThreads.length, 1);
  assert.equal(formal.plotThreads[0]?.id, 'thread-1');
  assert.equal(formal.characters.length, 1);
  assert.equal(formal.characters[0]?.id, 'c1');

  const counts = assetStatusCounts(snapshot);
  assert.equal(counts.plotThreads.draft, 1);
  assert.equal(counts.plotThreads.formal, 1);
  assert.equal(counts.characters.draft, 1);
  assert.equal(counts.characters.formal, 1);
}

// ─── 冲突检测 ────────────────────────────────────────────────

function smokeConflictDetection(): void {
  const characters: ReadonlyArray<CharacterProfile> = [
    { id: 'c1', name: '顾长风', aliases: ['老顾', '顾先生'], identity: explicitClaim('特工', '正文'), appearance: explicitClaim('短发', '正文'), abilities: explicitClaim('撬锁', '正文'), personality: explicitClaim('沉稳', '正文'), languageStyle: explicitClaim('简练', '正文'), desire: explicitClaim('拿到印章', '正文'), goal: explicitClaim('完成任务', '正文'), fear: explicitClaim('暴露身份', '正文'), weakness: explicitClaim('过于自信', '正文'), currentStatus: explicitClaim('逃回公寓', '正文'), plotThreadIds: [], status: 'formal' },
    { id: 'c2', name: '顾长风（伪）', aliases: ['老顾'], identity: explicitClaim('替身', '正文'), appearance: explicitClaim('短发', '正文'), abilities: explicitClaim('模仿', '正文'), personality: explicitClaim('沉稳', '正文'), languageStyle: explicitClaim('简练', '正文'), desire: explicitClaim('迷惑敌人', '正文'), goal: explicitClaim('掩护', '正文'), fear: explicitClaim('被识破', '正文'), weakness: explicitClaim('不是本体', '正文'), currentStatus: explicitClaim('活跃', '正文'), plotThreadIds: [], status: 'draft' },
  ];

  const aliasConflicts = detectCharacterAliasConflicts(characters);
  assert.equal(aliasConflicts.length, 1);
  assert.equal(aliasConflicts[0]?.kind, 'character-alias');
  assert.ok(aliasConflicts[0]?.description.includes('老顾'));

  const threads: ReadonlyArray<PlotThread> = [
    { id: 't1', name: '主线', kind: 'main', goal: explicitClaim('目标1', '证据'), plotNodeIds: ['p1', 'p2'], characterIds: [], stages: [], keyEvents: [], status: 'formal' },
    { id: 't2', name: '支线', kind: 'sub', goal: explicitClaim('目标2', '证据'), plotNodeIds: ['p2', 'p3'], characterIds: [], stages: [], keyEvents: [], status: 'formal' },
  ];

  const overlapConflicts = detectPlotOverlapConflicts(threads);
  assert.equal(overlapConflicts.length, 1);
  assert.equal(overlapConflicts[0]?.kind, 'plot-overlap');
  assert.ok(overlapConflicts[0]?.involvedAssetIds.includes('t1'));
  assert.ok(overlapConflicts[0]?.involvedAssetIds.includes('t2'));
}

// ─── 完整快照构造 ─────────────────────────────────────────────

function smokeFullSnapshot(): void {
  const foreshadowing: Foreshadowing = {
    id: 'f1',
    description: '老刘情报中的"佐藤今夜外出"',
    state: 'planted',
    plantedPlotNodeId: 'p1',
    advancedPlotNodeIds: [],
    credibility: 'explicit',
    evidence: [{ quote: '佐藤今夜外出', plotNodeId: 'p1' }],
    status: 'formal',
  };

  const relation: CharacterRelation = {
    id: 'r1',
    fromCharacterId: 'c1',
    toCharacterId: 'c2',
    kind: 'ally',
    description: explicitClaim('上下级情报关系', '正文'),
    changes: [{ plotNodeId: 'p4', description: '顾长风发现情报有误，信任动摇' }],
    status: 'formal',
  };

  const arc: CharacterArc = {
    id: 'a1',
    characterId: 'c1',
    description: '从盲信情报到学会独立判断',
    turningPoints: [{ plotNodeId: 'p3', description: '发现假印章' }],
    startState: '盲信情报',
    endState: '独立判断',
    status: 'formal',
  };

  const snapshot: StoryAssetSnapshot = {
    id: 'snap-full',
    projectId: 'project-1',
    version: 2,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T01:00:00.000Z',
    plotThreads: [],
    characters: [],
    relations: [relation],
    arcs: [arc],
    foreshadowings: [foreshadowing],
    sourceOutlineVersion: 1,
  };

  assert.equal(snapshot.relations.length, 1);
  assert.equal(snapshot.arcs.length, 1);
  assert.equal(snapshot.foreshadowings.length, 1);
  assert.equal(snapshot.foreshadowings[0]?.state, 'planted');
  assert.equal(snapshot.version, 2);
}

smokeClaimHelpers();
smokeFormalAssets();
smokeConflictDetection();
smokeFullSnapshot();
console.log('story asset model smoke passed');
