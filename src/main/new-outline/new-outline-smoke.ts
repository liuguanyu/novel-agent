/**
 * 新版大纲生成 smoke — M3 验收
 *
 * 验证：
 * 1. formal-only 守卫：draft 状态资产生成时必须拒绝
 * 2. 正式生成：mock LLM 返回合法 JSON → 产出 NewOutline draft，记录来源快照 ID/版本
 * 3. 不可变存储：save/load/版本递增/draft-formal 隔离
 * 4. 保留覆盖计算：computePreservationCoverage 识别缺失项
 * 5. 节点映射：computeNodeMapping 建立旧→新映射
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { OutlineGenerator, renderGenerationPrompt } from './outline-generator.js';
import {
  loadNewOutline,
  loadFormalNewOutline,
  saveNewOutline,
  nextNewOutlineVersion,
} from './new-outline-store.js';
import {
  computePreservationCoverage,
  computeNodeMapping,
  type NewOutline,
} from '../../core/new-outline/index.js';
import type { StoryAssetSnapshot } from '../../core/story-asset/index.js';
import type { LegacyOutline, PreservationManifest } from '../../core/legacy-organization/index.js';
import type { ModelAdapter, ModelResult, CapabilityTier } from '../../core/model/index.js';

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

/* ── 测试数据 ─────────────────────────────────────────────── */

function makeClaim(value: string): { readonly value: string; readonly credibility: 'explicit'; readonly evidence: [] } {
  return { value, credibility: 'explicit' as const, evidence: [] };
}

function makeFormalAssets(): StoryAssetSnapshot {
  return {
    id: 'snapshot-test-1',
    projectId: 'project-test',
    version: 3,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T01:00:00.000Z',
    sourceOutlineVersion: 1,
    plotThreads: [
      {
        id: 'pt-1',
        name: '主线复仇',
        kind: 'main',
        goal: makeClaim('揭露灭门真相'),
        plotNodeIds: ['plot-1', 'plot-2'],
        characterIds: ['ch-1'],
        stages: [
          { kind: 'setup' as const, plotNodeIds: ['plot-1'], description: '收到密信' },
          { kind: 'rising' as const, plotNodeIds: ['plot-2'], description: '追查线索' },
        ],
        keyEvents: [],
        status: 'formal' as const,
      },
    ],
    characters: [
      {
        id: 'ch-1',
        name: '顾长风',
        aliases: ['长风'],
        identity: makeClaim('落魄将军之子'),
        appearance: makeClaim(''),
        abilities: makeClaim(''),
        personality: makeClaim('沉稳隐忍'),
        languageStyle: makeClaim(''),
        desire: makeClaim(''),
        goal: makeClaim('为父报仇'),
        fear: makeClaim('真相太残酷'),
        weakness: makeClaim('过于执着'),
        currentStatus: makeClaim('隐姓埋名'),
        plotThreadIds: ['pt-1'],
        status: 'formal' as const,
      },
    ],
    relations: [],
    arcs: [],
    foreshadowings: [],
  };
}

function makeDraftAssets(): StoryAssetSnapshot {
  const formal = makeFormalAssets();
  return {
    ...formal,
    plotThreads: formal.plotThreads.map((t) => ({ ...t, status: 'draft' as const })),
  };
}

function makeLegacyOutline(): LegacyOutline {
  return {
    id: 'outline-legacy',
    projectId: 'project-test',
    version: 1,
    createdAt: '2026-08-14T00:00:00.000Z',
    sourceChapterTreeVersion: undefined,
    nodes: [
      {
        id: 'ch-1', parentId: undefined, order: 0, kind: 'chapter', title: '第一章 密信',
        summary: '', characters: [], sources: [], crossChapter: false, preserved: false, authorNote: undefined,
      },
      {
        id: 'plot-1', parentId: 'ch-1', order: 0, kind: 'plot-beat', title: '收到密信',
        summary: '主角收到密信', characters: ['顾长风'],
        sources: [], crossChapter: false, preserved: true, authorNote: undefined,
      },
      {
        id: 'plot-2', parentId: 'ch-1', order: 1, kind: 'plot-beat', title: '追查线索',
        summary: '主角开始追查', characters: ['顾长风'],
        sources: [], crossChapter: false, preserved: false, authorNote: undefined,
      },
      {
        id: 'plot-3', parentId: 'ch-1', order: 2, kind: 'plot-beat', title: '旧友相助',
        summary: '旧友出现', characters: ['顾长风'],
        sources: [], crossChapter: false, preserved: false, authorNote: undefined,
      },
    ],
  };
}

function makePreservations(): PreservationManifest {
  return {
    projectId: 'project-test',
    outlineId: 'outline-legacy',
    plots: [
      {
        id: 'pp-1',
        outlineNodeId: 'plot-1',
        title: '收到密信',
        sourceRefs: [],
        authorNote: '这个情节必须保留',
        preservedAt: '2026-08-14T00:00:00.000Z',
      },
    ],
    quotes: [
      {
        id: 'pq-1',
        text: '顾长风打开信封，里面是一张密信',
        sourceNodeRef: { id: 'ch-1' as unknown as string & { readonly __brand: 'NodeId' }, kind: 'chapter' as const },
        sourceChapterTitle: '第一章',
        outlineNodeId: 'plot-1',
        recommended: false,
        authorNote: undefined,
        preservedAt: '2026-08-14T00:00:00.000Z',
      },
    ],
    updatedAt: '2026-08-14T00:00:00.000Z',
  };
}

const VALID_LLM_RESPONSE = JSON.stringify({
  nodes: [
    {
      id: 'no-1',
      parentId: null,
      order: 0,
      kind: 'chapter',
      title: '第一章 密信再现',
      summary: '顾长风收到密信',
      goal: '引入主线',
      conflict: '身份危机',
      outcome: '决定追查',
      sourceRelation: 'carried-over',
      sourceNodeIds: ['plot-1'],
      plotThreadIds: ['pt-1'],
      characterIds: ['ch-1'],
      preservedPlotIds: ['pp-1'],
      preservedQuoteIds: ['pq-1'],
    },
    {
      id: 'no-2',
      parentId: null,
      order: 1,
      kind: 'chapter',
      title: '第二章 追查线索',
      summary: '追查密信来源',
      goal: '推进主线',
      conflict: '线索断裂',
      outcome: '发现新方向',
      sourceRelation: 'adjusted',
      sourceNodeIds: ['plot-2'],
      plotThreadIds: ['pt-1'],
      characterIds: ['ch-1'],
      preservedPlotIds: [],
      preservedQuoteIds: [],
    },
    {
      id: 'no-3',
      parentId: null,
      order: 2,
      kind: 'chapter',
      title: '第三章 旧友重逢',
      summary: '与旧友重逢',
      goal: '引入助力',
      conflict: '信任危机',
      outcome: '结盟',
      sourceRelation: 'merged',
      sourceNodeIds: ['plot-3'],
      plotThreadIds: ['pt-1'],
      characterIds: ['ch-1'],
      preservedPlotIds: [],
      preservedQuoteIds: [],
    },
  ],
});

/* ── 测试 ──────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'new-outline-smoke-'));
  try {
    // 1. formal-only 守卫
    console.log('1. formal-only 守卫 — draft 资产必须拒绝');
    const draftAssets = makeDraftAssets();
    const generator1 = new OutlineGenerator(new MockModelResolver(VALID_LLM_RESPONSE));
    await assert.rejects(
      () => generator1.generate(draftAssets, undefined, undefined, undefined, 1),
      (err: Error) => {
        assert.ok(err.message.includes('formal'), `错误消息应包含 formal：${err.message}`);
        return true;
      },
    );
    console.log('   ✓ draft 资产被正确拒绝');

    // 2. 正常生成
    console.log('2. 正常生成 — formal 资产 → 产出 NewOutline draft');
    const formalAssets = makeFormalAssets();
    const legacyOutline = makeLegacyOutline();
    const preservations = makePreservations();
    const generator2 = new OutlineGenerator(new MockModelResolver(VALID_LLM_RESPONSE));
    const outline = await generator2.generate(formalAssets, legacyOutline, preservations, '重写前三章', 1);

    assert.equal(outline.status, 'draft');
    assert.equal(outline.version, 1);
    assert.equal(outline.sourceSnapshotId, 'snapshot-test-1');
    assert.equal(outline.sourceSnapshotVersion, 3);
    assert.equal(outline.sourceLegacyOutlineVersion, 1);
    assert.equal(outline.authorIntent, '重写前三章');
    assert.equal(outline.nodes.length, 3);
    assert.equal(outline.nodes[0]!.sourceRelation, 'carried-over');
    assert.deepEqual(outline.nodes[0]!.sourceNodeIds, ['plot-1']);
    assert.deepEqual(outline.nodes[0]!.preservedPlotIds, ['pp-1']);
    assert.deepEqual(outline.nodes[0]!.preservedQuoteIds, ['pq-1']);
    console.log('   ✓ 生成结果正确，来源快照和旧版大纲版本已记录');

    // 3. 不可变存储
    console.log('3. 不可变存储 — save/load/版本递增/draft-formal 隔离');
    await saveNewOutline(tmpDir, outline, 'draft');
    const loaded = await loadNewOutline(tmpDir);
    assert.notEqual(loaded, undefined);
    assert.equal(loaded!.id, outline.id);
    assert.equal(loaded!.status, 'draft');

    // draft 不出现在 formal lane
    const formalLoaded = await loadFormalNewOutline(tmpDir);
    assert.equal(formalLoaded, undefined);

    // 版本递增
    const v2 = await nextNewOutlineVersion(tmpDir);
    assert.equal(v2, 2);

    // 发布 formal 后 draft 不可见，formal 可见
    const formalOutline: NewOutline = { ...outline, id: 'outline-formal-1', version: 2, status: 'formal' as const, updatedAt: new Date().toISOString() };
    await saveNewOutline(tmpDir, formalOutline, 'formal');
    const formalLoaded2 = await loadFormalNewOutline(tmpDir);
    assert.notEqual(formalLoaded2, undefined);
    assert.equal(formalLoaded2!.status, 'formal');
    console.log('   ✓ 存储正确：draft/formal 隔离、版本递增');

    // 4. 保留覆盖计算
    console.log('4. 保留覆盖计算');
    const coverage = computePreservationCoverage(outline, ['pp-1', 'pp-missing'], ['pq-1']);
    assert.equal(coverage.totalPreservedPlots, 2);
    assert.equal(coverage.coveredPreservedPlots, 1);
    assert.deepEqual(coverage.missingPreservedPlotIds, ['pp-missing']);
    assert.equal(coverage.totalPreservedQuotes, 1);
    assert.equal(coverage.coveredPreservedQuotes, 1);
    assert.deepEqual(coverage.missingPreservedQuoteIds, []);
    console.log('   ✓ 保留覆盖计算正确');

    // 5. 节点映射
    console.log('5. 节点映射 — 旧稿 → 新版');
    const mappings = computeNodeMapping(outline, legacyOutline.nodes.map((n) => ({ id: n.id, title: n.title })));
    assert.equal(mappings.length, 4); // 3 plot-beats + 1 chapter
    const plot1Mapping = mappings.find((m) => m.sourceNodeId === 'plot-1');
    assert.notEqual(plot1Mapping, undefined);
    assert.equal(plot1Mapping!.relation, 'carried-over');
    assert.equal(plot1Mapping!.targetNodeId, 'no-1');
    // plot-2 被 adjusted
    const plot2Mapping = mappings.find((m) => m.sourceNodeId === 'plot-2');
    assert.notEqual(plot2Mapping, undefined);
    assert.equal(plot2Mapping!.relation, 'adjusted');
    // chapter node 没有映射 → deleted
    const chMapping = mappings.find((m) => m.sourceNodeId === 'ch-1');
    assert.notEqual(chMapping, undefined);
    assert.equal(chMapping!.relation, 'deleted');
    assert.equal(chMapping!.targetNodeId, undefined);
    console.log('   ✓ 节点映射正确');

    // 6. prompt 构建
    console.log('6. prompt 构建包含所有必要信息');
    const prompt = renderGenerationPrompt(formalAssets, legacyOutline, preservations, '重写前三章');
    assert.ok(prompt.includes('顾长风'), 'prompt 应包含人物名');
    assert.ok(prompt.includes('主线复仇'), 'prompt 应包含情节线名');
    assert.ok(prompt.includes('收到密信'), 'prompt 应包含保留情节');
    assert.ok(prompt.includes('重写前三章'), 'prompt 应包含作者意图');
    assert.ok(prompt.includes('plot-1'), 'prompt 应包含旧稿节点 ID');
    console.log('   ✓ prompt 构建正确');

    console.log('\n✅ 新版大纲生成 smoke 全部通过');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ smoke 失败:', err);
  process.exit(1);
});
