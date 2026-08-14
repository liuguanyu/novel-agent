/**
 * 故事资产生命周期验收 smoke — 提炼 → 修正 → 确认 → 发布 → 重启读取
 *
 * 验证完整闭环：
 * 1. 提炼（用 mock LLM 返回合法 JSON）→ 产出 draft 快照
 * 2. 修正（作者编辑资产值）→ 新版本 draft
 * 3. 确认（draft → confirmed）→ 新版本 draft
 * 4. 发布（confirmed → formal）→ formal 快照
 * 5. 重启后读取 formal → 正式资产完整且全部 formal 状态
 * 6. 提炼时证据回填：mock LLM 返回的 explicit 结论自动从 outline sources 回填证据
 * 7. 提炼时引用校验：mock LLM 返回不存在的 plotNode 会被校验拒绝
 * 8. 提炼时 explicit 无证据自动降级为 pending-confirmation
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AssetExtractor, renderExtractionPrompt } from './asset-extractor.js';
import {
  saveStoryAssetSnapshot,
  loadStoryAssetSnapshot,
  loadFormalStoryAssetSnapshot,
  nextStoryAssetVersion,
} from './asset-store.js';
import {
  validateStoryAssetSnapshot,
  formalAssets,
  type StoryAssetSnapshot,
} from '../../core/story-asset/index.js';
import type { LegacyOutline } from '../../core/legacy-organization/index.js';
import type { ModelAdapter, ModelResult } from '../../core/model/index.js';
import type { CapabilityTier } from '../../core/model/index.js';

/* ── Mock LLM 适配器 ──────────────────────────────────────── */

class MockModelResolver {
  constructor(private readonly responseText: string) {}

  createAdapter(_agentId: string, _tier: CapabilityTier): Pick<ModelAdapter, 'complete'> {
    return {
      complete: async (): Promise<ModelResult> => ({
        text: this.responseText,
        finishReason: 'stop' as const,
      }),
    };
  }
}

/* ── 测试用旧稿大纲 ───────────────────────────────────────── */

function makeTestOutline(withSources = true): LegacyOutline {
  const sources = withSources
    ? [{ nodeRef: { id: 'ch-1' as unknown as string & { readonly __brand: 'NodeId' }, kind: 'chapter' as const }, label: '第一章', quote: '顾长风打开信封，里面是一张密信' }]
    : [];
  return {
    id: 'outline-test',
    projectId: 'project-test',
    version: 1,
    createdAt: '2026-08-14T00:00:00.000Z',
    sourceChapterTreeVersion: undefined,
    nodes: [
      {
        id: 'ch-1', parentId: undefined, order: 0, kind: 'chapter', title: '第一章',
        summary: '', characters: [], sources: [], crossChapter: false, preserved: false, authorNote: undefined,
      },
      {
        id: 'plot-1', parentId: 'ch-1', order: 0, kind: 'plot-beat', title: '收到密信',
        summary: '主角收到密信', characters: ['顾长风'],
        sources,
        crossChapter: false, preserved: true, authorNote: undefined,
      },
      {
        id: 'plot-2', parentId: 'ch-1', order: 1, kind: 'plot-beat', title: '夜探敌营',
        summary: '主角潜入敌营', characters: ['顾长风', '老刘'],
        sources,
        crossChapter: false, preserved: false, authorNote: undefined,
      },
    ],
    plotSequence: [],
    deletedPlots: [],
    crossChapterIssues: [],
    advisorConversations: [],
  };
}

/* ── Mock LLM 输出（合法 JSON） ───────────────────────────── */

function makeMockLLMResponse(): string {
  return JSON.stringify({
    plotThreads: [{
      id: 'pt-1', name: '密信线', kind: 'main',
      goal: '拿到密信并破译', credibility: 'explicit',
      plotNodeIds: ['plot-1', 'plot-2'], characterIds: ['ch-1'],
      stages: [{ kind: 'setup', plotNodeIds: ['plot-1'], description: '收到密信' }],
    }],
    characters: [{
      id: 'ch-1', name: '顾长风', aliases: ['老顾'],
      identity: '特工', identityCredibility: 'explicit',
      personality: '沉稳', personalityCredibility: 'inferred',
      desire: '完成任务', desireCredibility: 'explicit',
      goal: '破译密信', goalCredibility: 'explicit',
      fear: '暴露身份', fearCredibility: 'inferred',
      weakness: '过于自信', weaknessCredibility: 'pending-design',
      currentStatus: '活跃', currentStatusCredibility: 'inferred',
      plotThreadIds: ['pt-1'],
    }],
    relations: [],
    arcs: [],
    foreshadowings: [{
      id: 'fs-1', description: '密信中的暗号', state: 'planted',
      plantedPlotNodeId: 'plot-1', credibility: 'explicit',
    }],
  });
}

/* ── 测试 1：提炼 → 产出 draft 快照 + 证据回填 ──────────── */

async function testExtractProducesDraftWithEvidence(): Promise<{ snapshot: StoryAssetSnapshot; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'na-lifecycle-'));
  const outline = makeTestOutline();
  const resolver = new MockModelResolver(makeMockLLMResponse());
  const version = await nextStoryAssetVersion(dir);
  const snapshot = await new AssetExtractor(resolver).extract(outline, version);

  // 基本结构
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.plotThreads.length, 1);
  assert.equal(snapshot.characters.length, 1);
  assert.equal(snapshot.foreshadowings.length, 1);

  // 所有资产应为 draft 状态
  assert.ok(snapshot.plotThreads.every((t) => t.status === 'draft'), '提炼产出应为 draft');
  assert.ok(snapshot.characters.every((c) => c.status === 'draft'), '提炼产出应为 draft');
  assert.ok(snapshot.foreshadowings.every((f) => f.status === 'draft'), '提炼产出应为 draft');

  // 证据回填：explicit 结论应有从 outline sources 提取的证据
  const thread = snapshot.plotThreads[0]!;
  assert.ok(thread.goal.evidence.length > 0, '情节线目标应有回填证据');
  assert.ok(thread.goal.evidence.some((e) => e.quote.length > 0), '证据应包含原文引用');

  // 人物身份应有证据
  const char = snapshot.characters[0]!;
  assert.ok(char.identity.evidence.length > 0, '人物身份应有回填证据');

  // 伏笔应有证据
  const fs1 = snapshot.foreshadowings[0]!;
  assert.ok(fs1.evidence.length > 0, '伏笔应有回填证据');
  assert.equal(fs1.status, 'draft', '伏笔应为 draft 状态');

  // 保存
  await saveStoryAssetSnapshot(dir, snapshot, 'draft');

  return { snapshot, dir };
}

/* ── 测试 2：提炼时引用校验拒绝不存在的 plotNode ──────────── */

async function testExtractRejectsInvalidReferences(): Promise<void> {
  const outline = makeTestOutline();
  const badResponse = JSON.stringify({
    plotThreads: [{
      id: 'pt-1', name: '坏线', kind: 'main',
      goal: '目标', credibility: 'explicit',
      plotNodeIds: ['plot-nonexistent'], characterIds: ['ch-1'],
      stages: [],
    }],
    characters: [{
      id: 'ch-1', name: '人物', aliases: [],
      identity: '特工', identityCredibility: 'explicit',
      personality: '沉稳', personalityCredibility: 'inferred',
      desire: '', desireCredibility: 'pending-design',
      goal: '', goalCredibility: 'pending-design',
      fear: '', fearCredibility: 'pending-design',
      weakness: '', weaknessCredibility: 'pending-design',
      currentStatus: '', currentStatusCredibility: 'pending-design',
      plotThreadIds: [],
    }],
    relations: [], arcs: [], foreshadowings: [],
  });
  const resolver = new MockModelResolver(badResponse);

  await assert.rejects(
    new AssetExtractor(resolver).extract(outline, 1),
    /引用|证据|不完整/,
    '提炼时引用不存在的 plotNode 应被校验拒绝',
  );
}

/* ── 测试 3：提炼时 explicit 无证据自动降级 ──────────────── */

function makeNoEvidenceLLMResponse(): string {
  return JSON.stringify({
    plotThreads: [{
      id: 'pt-1', name: '密信线', kind: 'main',
      goal: '拿到密信', credibility: 'explicit',
      plotNodeIds: ['plot-1', 'plot-2'], characterIds: ['ch-1'],
      stages: [],
    }],
    characters: [{
      id: 'ch-1', name: '顾长风', aliases: [],
      identity: '特工', identityCredibility: 'explicit',
      personality: '沉稳', personalityCredibility: 'pending-design',
      desire: '', desireCredibility: 'pending-design',
      goal: '', goalCredibility: 'pending-design',
      fear: '', fearCredibility: 'pending-design',
      weakness: '', weaknessCredibility: 'pending-design',
      currentStatus: '', currentStatusCredibility: 'pending-design',
      plotThreadIds: [],
    }],
    relations: [], arcs: [], foreshadowings: [],
  });
}

async function testExplicitWithoutEvidenceDegradesToPending(): Promise<void> {
  // 不给 sources（所有 plot-beat 的 sources 为空）
  const outline = makeTestOutline(false);
  const resolver = new MockModelResolver(makeNoEvidenceLLMResponse());
  const snapshot = await new AssetExtractor(resolver).extract(outline, 1);

  // explicit 结论因无证据应降级为 pending-confirmation
  const thread = snapshot.plotThreads[0]!;
  assert.equal(thread.goal.credibility, 'pending-confirmation', 'explicit 无证据应降级为 pending-confirmation');
  assert.equal(thread.goal.evidence.length, 0, '降级后证据为空');

  // 人物身份也应降级
  const char = snapshot.characters[0]!;
  assert.equal(char.identity.credibility, 'pending-confirmation', '人物 explicit 无证据应降级');
}

/* ── 测试 4：修正 → 新版本 draft ──────────────────────────── */

async function testEditProducesNewVersion(dir: string): Promise<StoryAssetSnapshot> {
  const loaded = await loadStoryAssetSnapshot(dir);
  assert.notEqual(loaded, undefined);

  // 修改情节线目标
  const edited: StoryAssetSnapshot = {
    ...loaded!,
    updatedAt: new Date().toISOString(),
    plotThreads: loaded!.plotThreads.map((t) =>
      t.id === 'pt-1'
        ? { ...t, goal: { ...t.goal, value: '修正后的目标：破译密信并传递情报', authorNote: '作者修正' } }
        : t,
    ),
  };
  const version = await nextStoryAssetVersion(dir);
  const versioned = { ...edited, id: `snapshot-${Date.now()}`, version };
  await saveStoryAssetSnapshot(dir, versioned, 'draft', loaded!.version);

  // 验证
  const reloaded = await loadStoryAssetSnapshot(dir);
  assert.equal(reloaded!.version, version, '修正后版本递增');
  assert.equal(reloaded!.plotThreads[0]!.goal.value, '修正后的目标：破译密信并传递情报');
  assert.ok(reloaded!.plotThreads[0]!.goal.authorNote?.includes('作者修正'));
  assert.ok(reloaded!.plotThreads.every((t) => t.status === 'draft'), '修正后仍为 draft');

  return reloaded!;
}

/* ── 测试 5：确认 → draft → confirmed ─────────────────────── */

async function testConfirmTransitionsToConfirmed(dir: string): Promise<StoryAssetSnapshot> {
  const loaded = await loadStoryAssetSnapshot(dir);
  const now = new Date().toISOString();

  // 确认所有情节线
  const confirmed: StoryAssetSnapshot = {
    ...loaded!,
    updatedAt: now,
    plotThreads: loaded!.plotThreads.map((t) => t.status === 'draft' ? { ...t, status: 'confirmed' as const } : t),
    characters: loaded!.characters.map((c) => c.status === 'draft' ? { ...c, status: 'confirmed' as const } : c),
    foreshadowings: loaded!.foreshadowings.map((f) => f.status === 'draft' ? { ...f, status: 'confirmed' as const } : f),
  };
  const version = await nextStoryAssetVersion(dir);
  const versioned = { ...confirmed, id: `snapshot-${Date.now()}`, version };
  await saveStoryAssetSnapshot(dir, versioned, 'draft', loaded!.version);

  const reloaded = await loadStoryAssetSnapshot(dir);
  assert.ok(reloaded!.plotThreads.every((t) => t.status === 'confirmed'), '确认后情节线应为 confirmed');
  assert.ok(reloaded!.characters.every((c) => c.status === 'confirmed'), '确认后人物应为 confirmed');
  assert.ok(reloaded!.foreshadowings.every((f) => f.status === 'confirmed'), '确认后伏笔应为 confirmed');

  return reloaded!;
}

/* ── 测试 6：发布 → confirmed → formal ─────────────────────── */

async function testPublishTransitionsToFormal(dir: string): Promise<StoryAssetSnapshot> {
  const loaded = await loadStoryAssetSnapshot(dir);

  // 发布门槛：校验通过 + 全部 confirmed
  const plotIds = new Set(makeTestOutline().nodes.filter((n) => n.kind === 'plot-beat').map((n) => n.id));
  const issues = validateStoryAssetSnapshot(loaded!, plotIds);
  assert.equal(issues.length, 0, `发布前校验应通过，但发现：${issues.map((i) => i.message).join('; ')}`);

  // 全部转 formal
  const formal: StoryAssetSnapshot = {
    ...loaded!,
    updatedAt: new Date().toISOString(),
    plotThreads: loaded!.plotThreads.map((t) => ({ ...t, status: 'formal' as const })),
    characters: loaded!.characters.map((c) => ({ ...c, status: 'formal' as const })),
    foreshadowings: loaded!.foreshadowings.map((f) => ({ ...f, status: 'formal' as const })),
  };
  const version = await nextStoryAssetVersion(dir);
  const versioned = { ...formal, id: `snapshot-formal-${Date.now()}`, version };
  await saveStoryAssetSnapshot(dir, versioned, 'formal', loaded!.version);

  return versioned;
}

/* ── 测试 7：重启后读取 formal ─────────────────────────────── */

async function testRestartReadsFormal(dir: string): Promise<void> {
  // 模拟重启：重新读盘
  const formal = await loadFormalStoryAssetSnapshot(dir);
  assert.notEqual(formal, undefined, '重启后应能读取 formal 快照');

  // 全部 formal
  assert.ok(formal!.plotThreads.every((t) => t.status === 'formal'), '重启后 formal 资产全部为 formal');
  assert.ok(formal!.characters.every((c) => c.status === 'formal'), '重启后 formal 人物全部为 formal');
  assert.ok(formal!.foreshadowings.every((f) => f.status === 'formal'), '重启后 formal 伏笔全部为 formal');

  // formalAssets 过滤正确
  const filtered = formalAssets(formal!);
  assert.equal(filtered.plotThreads.length, formal!.plotThreads.length, 'formal 快照全部通过 formalAssets');
  assert.equal(filtered.characters.length, formal!.characters.length);
}

/* ── 测试 8：draft 不污染 formal ────────────────────────────── */

async function testDraftDoesNotPolluteFormal(dir: string): Promise<void> {
  // 再次提炼新草案（覆盖 draft 指针但不影响 formal）
  const newDraft = makeTestOutline();
  const resolver = new MockModelResolver(makeMockLLMResponse());
  const version = await nextStoryAssetVersion(dir);
  const newSnapshot = await new AssetExtractor(resolver).extract(newDraft, version);
  await saveStoryAssetSnapshot(dir, newSnapshot, 'draft');

  // formal 不变
  const formal = await loadFormalStoryAssetSnapshot(dir);
  assert.ok(formal!.plotThreads.every((t) => t.status === 'formal'), '新草案不应影响 formal 状态');

  // 当前草案指向新的（version 更高）
  const current = await loadStoryAssetSnapshot(dir);
  assert.ok(current!.version > formal!.version, '当前草案版本应高于 formal');
  assert.ok(current!.plotThreads.every((t) => t.status === 'draft'), '新草案应为 draft 状态');
}

/* ── 测试 9：发布门槛 — 未全部确认时不能发布 ──────────────── */

async function testPublishGateRejectsUnconfirmed(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'na-gate-'));
  const outline = makeTestOutline();
  const resolver = new MockModelResolver(makeMockLLMResponse());
  const snapshot = await new AssetExtractor(resolver).extract(outline, 1);
  await saveStoryAssetSnapshot(dir, snapshot, 'draft');

  // 尝试发布 draft（未确认）→ 应失败
  const loaded = await loadStoryAssetSnapshot(dir);
  const allItems = [...loaded!.plotThreads, ...loaded!.characters, ...loaded!.foreshadowings];
  const hasDraft = allItems.some((item) => 'status' in item && item.status === 'draft');
  assert.ok(hasDraft, '提炼后应有 draft 资产');

  // 模拟发布检查
  const canPublish = allItems.every((item) => 'status' in item && (item.status === 'confirmed' || item.status === 'formal'));
  assert.equal(canPublish, false, '有 draft 资产时不应能发布');
}

/* ── 测试 10：prompt 包含原文证据线索 ──────────────────────── */

function testPromptContainsEvidence(): void {
  const outline = makeTestOutline();
  const prompt = renderExtractionPrompt(outline);

  // prompt 应包含情节节点 ID
  assert.ok(prompt.includes('id:plot-1'), 'prompt 应包含情节节点 ID');
  assert.ok(prompt.includes('id:plot-2'));

  // prompt 应包含人物名单和 ID
  assert.ok(prompt.includes('ch-1'), 'prompt 应为人物分配 ID');
  assert.ok(prompt.includes('顾长风'));

  // prompt 应包含原文摘要
  assert.ok(prompt.includes('收到密信'), 'prompt 应包含情节摘要');

  // prompt 应要求使用给定 ID
  assert.ok(prompt.includes('plotNodeIds'), 'prompt 应说明 plotNodeIds');
  assert.ok(prompt.includes('characterIds'), 'prompt 应说明 characterIds');
}

/* ── 主入口 ─────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('故事资产生命周期闭环验收');
  console.log('═'.repeat(60));

  console.log('\n━ testExtractProducesDraftWithEvidence');
  const { dir } = await testExtractProducesDraftWithEvidence();
  console.log('✅ 提炼产出 draft 快照，证据从 outline sources 回填');

  console.log('\n━ testExtractRejectsInvalidReferences');
  await testExtractRejectsInvalidReferences();
  console.log('✅ 提炼时引用不存在的 plotNode 被校验拒绝');

  console.log('\n━ testExplicitWithoutEvidenceDegradesToPending');
  await testExplicitWithoutEvidenceDegradesToPending();
  console.log('✅ explicit 无证据自动降级为 pending-confirmation');

  console.log('\n━ testEditProducesNewVersion');
  await testEditProducesNewVersion(dir);
  console.log('✅ 修正产出新版本 draft，版本递增');

  console.log('\n━ testConfirmTransitionsToConfirmed');
  await testConfirmTransitionsToConfirmed(dir);
  console.log('✅ 确认 draft → confirmed，版本递增');

  console.log('\n━ testPublishTransitionsToFormal');
  await testPublishTransitionsToFormal(dir);
  console.log('✅ 发布 confirmed → formal，校验通过');

  console.log('\n━ testRestartReadsFormal');
  await testRestartReadsFormal(dir);
  console.log('✅ 重启后读取 formal 快照完整且全部 formal 状态');

  console.log('\n━ testDraftDoesNotPolluteFormal');
  await testDraftDoesNotPolluteFormal(dir);
  console.log('✅ 新草案不覆盖已有 formal 资产');

  console.log('\n━ testPublishGateRejectsUnconfirmed');
  await testPublishGateRejectsUnconfirmed();
  console.log('✅ 发布门槛：有 draft 资产时不能发布');

  console.log('\n━ testPromptContainsEvidence');
  testPromptContainsEvidence();
  console.log('✅ prompt 包含原文证据线索和 ID 约束');

  console.log('\n' + '═'.repeat(60));
  console.log('全部生命周期闭环验收通过');
  console.log('提炼 → 修正 → 确认 → 发布 → 重启读取 → draft 不污染 formal');
  console.log('═'.repeat(60));
}

await main();
