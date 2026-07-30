/**
 * 事实抽取冒烟脚本 (story-bible-extraction I4 tasks 2.x, 8.1)
 *
 * 当前先验证“模型输出文本 → 强类型候选事实”的最小闭环：完整 JSON、fenced JSON、
 * 半截 candidates 数组 salvage、字段漂移默认值，以及不把坏 JSON 字段值误当候选。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseExtractionOutput,
  normalizeCandidateFacts,
  buildIngestPlan,
  applyIngestPlan,
  FactExtractor,
  renderFactExtractionPrompt,
  type FactExtractorModelResolver,
} from './extraction/index.js';
import { openDatabase, SqliteFactStore } from './db/index.js';
import { retrieveFacts } from './retrieval/fact-retrieval.js';
import { asEntityId, asFactVersionId, type FactView } from '../core/story-bible/index.js';
import type { CapabilityTier, ModelAdapter } from '../core/model/index.js';
import { asNodeId } from '../core/manuscript/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function smokeCompleteJson(): void {
  const parsed = parseExtractionOutput(`{
    "candidates": [
      {
        "kind": "entity",
        "suggestedAnchor": {"id": "chapter-4", "kind": "chapter"},
        "confidence": 0.91,
        "payload": {
          "entityType": "person",
          "canonicalName": "顾长风",
          "aliases": ["顾兄弟"],
          "quote": "顾长风缓步走入茶馆"
        }
      }
    ]
  }`);
  check(
    '完整 JSON object 解析为候选事实',
    parsed.output.candidates.length === 1 && parsed.diagnostics.source === 'json-object',
    `count=${parsed.output.candidates.length} source=${parsed.diagnostics.source}`,
  );
  check(
    '候选 NodeRef 被保留',
    parsed.output.candidates[0]?.suggestedAnchor.id === 'chapter-4',
  );
}

function smokeFencedJson(): void {
  const parsed = parseExtractionOutput(`\`\`\`json
{
  "candidates": [
    {
      "kind": "plot-hook",
      "suggestedAnchor": {"id": "chapter-4", "kind": "chapter"},
      "confidence": 0.8,
      "payload": {"description": "八音盒暗格", "state": "planted", "quote": "把真东西藏进八音盒"}
    }
  ]
}
\`\`\``);
  check(
    'fenced JSON 可解析',
    parsed.output.candidates.length === 1 && parsed.output.candidates[0]?.kind === 'plot-hook',
  );
}

function smokeCandidateSalvage(): ReturnType<typeof parseExtractionOutput> {
  const parsed = parseExtractionOutput(`{
    "candidates": [
      {
        "kind": "entity",
        "anchor": {"id": "chapter-4", "kind": "chapter"},
        "payload": {"entityType": "person", "canonicalName": "豹头", "quote": "豹头接过八音盒"}
      },
      {
        "kind": "entity",
        "suggestedAnchor": {"id": "chapter-4", "kind": "chapter"},
        "confidence": 0.88,
        "payload": {"entityType": "person", "canonicalName": "顾长风", "quote": "顾长风把八音盒交给豹头"}
      },
      {
        "kind": "alias",
        "suggestedAnchor": {"id": "chapter-4", "kind": "chapter"},
        "confidence": 0.72,
        "payload": {"entityName": "顾长风", "alias": "姑爷", "quote": "称他为姑爷"}
      },
      {
        "kind": "attribute",
        "suggestedAnchor": {"id": "chapter-4", "kind": "chapter"},
        "confidence": 0.6,
        "payload": {"entityName": "顾长风", "key": "skill", "value": "听劲", "quote": "碎壶不伤手"}
      },
      {
        "kind": "timeline-event",
        "suggestedAnchor": {"id": "chapter-4", "kind": "chapter"},
        "confidence": 0.66,
        "payload": {"description": "豹头携八音盒去当铺接头", "relatedNames": ["豹头"], "quote": "豹头接过八音盒"}
      },
      {
        "kind": "relation",
        "suggestedAnchor": {"id": "chapter-4", "kind": "chapter"},
        "confidence": 0.64,
        "payload": {"fromName": "顾长风", "toName": "豹头", "kind": "委托", "quote": "让豹头带着八音盒"}
      },
      {
        "kind": "plot-hook",
        "suggestedAnchor": {"id": "chapter-4", "kind": "chapter"},
        "confidence": 0.8,
        "payload": {"description": "八音盒暗格", "state": "planted", "quote": "把真东西藏进八音盒"}
      },
      {
        "kind": "relation",
        "suggestedFix": "这条故意截断，不应被当成候选"`);
  check(
    '半截 candidates 数组可抢救完整 item',
    parsed.output.candidates.length === 7 && parsed.diagnostics.source === 'candidate-salvage',
    `count=${parsed.output.candidates.length} source=${parsed.diagnostics.source}`,
  );
  check(
    '字段漂移 anchor→suggestedAnchor 且 confidence 默认值可修复',
    parsed.output.candidates[0]?.confidence === 0.7 &&
      parsed.output.candidates[0]?.suggestedAnchor.id === 'chapter-4',
  );
  check(
    '不把 suggestedFix 字段值误当候选',
    parsed.output.candidates.filter((candidate) => candidate.kind === 'relation').length === 1,
  );
  return parsed;
}

function emptyView(): FactView {
  return {
    version: asFactVersionId('version-smoke'),
    entities: [],
    timeline: { events: [] },
    relations: [],
    plotHooks: [],
  };
}

function normalizedSmokeFacts(): { normalized: ReturnType<typeof normalizeCandidateFacts>; view: FactView } {
  const parsed = smokeCandidateSalvage();
  const initial = normalizeCandidateFacts(parsed.output.candidates, emptyView());
  const viewWithEntity: FactView = {
    ...emptyView(),
    entities: initial.facts.flatMap((fact) => (fact.kind === 'entity' ? [fact.entity] : [])),
  };
  return { normalized: normalizeCandidateFacts(parsed.output.candidates, viewWithEntity), view: viewWithEntity };
}

function smokeNormalizer(): void {
  const parsed = smokeCandidateSalvage();
  const initial = normalizeCandidateFacts(parsed.output.candidates, emptyView());
  const { normalized } = normalizedSmokeFacts();

  check(
    'normalizer：entity 候选转 Entity 并补 provenance',
    normalized.facts.some(
      (fact) =>
        fact.kind === 'entity' &&
        fact.entity.canonicalName === '豹头' &&
        fact.entity.provenance.sources[0]?.quote === '豹头接过八音盒',
    ),
  );
  check(
    'normalizer：alias/attribute 无目标实体时跳过且有诊断',
    initial.skipped.length >= 2,
    `skipped=${initial.skipped.length}`,
  );
  check(
    'normalizer：alias/attribute/timeline/relation 可基于视图解析目标实体',
    normalized.facts.some((fact) => fact.kind === 'alias' && fact.alias === '姑爷') &&
      normalized.facts.some((fact) => fact.kind === 'attribute' && fact.attribute.key === 'skill') &&
      normalized.facts.some((fact) => fact.kind === 'timeline-event') &&
      normalized.facts.some((fact) => fact.kind === 'relation') &&
      normalized.facts.some((fact) => fact.kind === 'plot-hook'),
    `facts=${normalized.facts.length}`,
  );
}

class FakeFactExtractorResolver implements FactExtractorModelResolver {
  createAdapter(agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'> {
    check('extractor：使用 fact-extractor agent + cheap-fast 档位', agentId === 'fact-extractor' && tier === 'cheap-fast');
    return {
      complete: async () => ({
        text: `{
          "candidates": [
            {
              "kind": "entity",
              "suggestedAnchor": {"id": "chapter-4", "kind": "chapter"},
              "confidence": 0.91,
              "payload": {"entityType": "person", "canonicalName": "顾长风", "quote": "顾长风把真东西藏进八音盒"}
            }
          ]
        }`,
        finishReason: 'stop',
      }),
    };
  }
}

async function smokeFactExtractor(): Promise<void> {
  const prompt = renderFactExtractionPrompt({
    location: { id: asNodeId('chapter-4'), kind: 'chapter' },
    text: '顾长风把真东西藏进八音盒。',
  });
  check(
    'extractor：prompt 约束 JSON schema、quote 与锚点',
    prompt.includes('{"candidates":[...]}') &&
      prompt.includes('payload 必须含 quote') &&
      prompt.includes('{"id":"chapter-4","kind":"chapter"}') &&
      prompt.includes('plot-hook'),
  );

  const extractor = new FactExtractor(new FakeFactExtractorResolver());
  const logs: string[] = [];
  const result = await extractor.extract(
    {
      location: { id: asNodeId('chapter-4'), kind: 'chapter' },
      text: '顾长风把真东西藏进八音盒。',
    },
    { logger: (message) => logs.push(message) },
  );
  check(
    'extractor：模型输出经 parser 校验并返回诊断日志',
    result.output.candidates.length === 1 &&
      result.diagnostics.source === 'json-object' &&
      logs.some((line) => line.includes('chapterId=chapter-4') && line.includes('rawChars=')),
    `candidates=${result.output.candidates.length} logs=${logs.length}`,
  );
}

function smokeIngestPlan(): void {
  const { normalized, view } = normalizedSmokeFacts();
  const plan = buildIngestPlan(normalized.facts, emptyView(), normalized.skipped);
  check(
    'ingest：低风险新增候选进入 autoIngest',
    plan.diagnostics.autoIngest >= 3 && plan.diagnostics.conflicts === 0,
    `auto=${plan.diagnostics.autoIngest} conflicts=${plan.diagnostics.conflicts}`,
  );

  const duplicatePlan = buildIngestPlan(normalized.facts, {
    ...view,
    timeline: {
      events: normalized.facts.flatMap((fact) => (fact.kind === 'timeline-event' ? [fact.event] : [])),
    },
    relations: normalized.facts.flatMap((fact) => (fact.kind === 'relation' ? [fact.relation] : [])),
    plotHooks: normalized.facts.flatMap((fact) => (fact.kind === 'plot-hook' ? [fact.hook] : [])),
  });
  check(
    'ingest：时间线/关系/伏笔重复抽取幂等跳过',
    duplicatePlan.skipped.some((item) => item.reason.includes('时间线事件已存在')) &&
      duplicatePlan.skipped.some((item) => item.reason.includes('关系已存在')) &&
      duplicatePlan.skipped.some((item) => item.reason.includes('伏笔已存在')),
    `skipped=${duplicatePlan.diagnostics.skipped}`,
  );

  const gu = view.entities.find((entity) => entity.canonicalName === '顾长风');
  if (gu === undefined) {
    check('ingest：构造 confirmed 属性冲突 fixture', false, '缺顾长风实体');
    return;
  }
  const conflictView: FactView = {
    ...view,
    entities: [
      ...view.entities.filter((entity) => entity.id !== gu.id),
      {
        ...gu,
        attributes: [
          {
            key: 'skill',
            value: '不会听劲',
            status: 'confirmed',
            provenance: gu.provenance,
          },
        ],
      },
    ],
  };
  const conflictPlan = buildIngestPlan(normalized.facts, conflictView);
  check(
    'ingest：confirmed 属性冲突转人工裁决 issue',
    conflictPlan.conflicts.some(
      (item) =>
        item.issue.type === 'state-contradiction' &&
        item.issue.requiresHumanDecision &&
        item.issue.options?.some((option) => option.id === 'accept-new'),
    ),
    `conflicts=${conflictPlan.diagnostics.conflicts}`,
  );
}

async function smokeIngestWriter(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-extraction-'));
  const dbPath = join(dir, 'facts.db');
  try {
    const opened = await openDatabase(dbPath);
    if (!opened.ok) {
      check('writer：SQLite 可用 + migration 应用', false, `${opened.reason}: ${opened.message}`);
      return;
    }

    const store = new SqliteFactStore(opened.db);
    const { normalized } = normalizedSmokeFacts();
    const firstPlan = buildIngestPlan(normalized.facts, emptyView(), normalized.skipped);
    const firstApply = await applyIngestPlan(store, firstPlan, emptyView());
    const firstView = await store.getView(firstApply.version);
    const guHits = retrieveFacts(firstView, { entityName: '顾长风' });
    const hookHits = retrieveFacts(firstView, { plotHookKeyword: '八音盒' });
    const timelineHits = retrieveFacts(firstView, { timelineKeyword: '当铺' });

    check(
      'writer：ingest plan 入库后实体可召回',
      guHits.entities.some(
        (entity) => entity.canonicalName === '顾长风' && entity.aliases.includes('姑爷'),
      ),
      `entities=${guHits.entities.length}`,
    );
    check(
      'writer：plotHook 入库后可按关键词召回',
      hookHits.plotHooks.some((hook) => hook.description.includes('八音盒')),
      `hooks=${hookHits.plotHooks.length}`,
    );
    check(
      'writer：timeline 入库后可按关键词召回',
      timelineHits.timelineEvents.some((event) => event.description.includes('当铺')),
      `events=${timelineHits.timelineEvents.length}`,
    );
    const normalizedRelation = normalized.facts.find((fact) => fact.kind === 'relation');
    check(
      'writer：同批新增实体的 relation 可安全入库',
      normalizedRelation !== undefined &&
        firstPlan.autoIngest.some((item) => item.fact === normalizedRelation) &&
        firstView.relations.some((relation) => relation.id === normalizedRelation.relation.id),
      `relations=${firstView.relations.length}`,
    );

    if (normalizedRelation !== undefined) {
      const danglingRelation = {
        ...normalizedRelation,
        relation: {
          ...normalizedRelation.relation,
          id: `${normalizedRelation.relation.id}-dangling` as typeof normalizedRelation.relation.id,
          to: asEntityId('missing-entity'),
        },
      };
      const danglingPlan = buildIngestPlan([danglingRelation], firstView);
      const danglingApply = await applyIngestPlan(store, danglingPlan, firstView);
      const danglingView = await store.getView(danglingApply.version);
      check(
        'writer：悬空 relation 被诊断性跳过且不触发外键失败',
        danglingPlan.autoIngest.length === 0 &&
          danglingPlan.skipped.some((item) =>
            item.reason.includes('关系端点实体不存在'),
          ) &&
          danglingView.relations.length === firstView.relations.length,
        `auto=${danglingPlan.autoIngest.length} skipped=${danglingPlan.skipped.length}`,
      );
    } else {
      check('writer：构造悬空 relation fixture', false, '缺 relation 候选');
    }

    const secondPlan = buildIngestPlan(normalized.facts, firstView, normalized.skipped);
    const secondApply = await applyIngestPlan(store, secondPlan, firstView);
    const secondView = await store.getView(secondApply.version);
    check(
      'writer：同章同输出重复入库不重复堆积',
      secondPlan.autoIngest.length === 0 &&
        secondView.entities.length === firstView.entities.length &&
        secondView.timeline.events.length === firstView.timeline.events.length &&
        secondView.plotHooks.length === firstView.plotHooks.length,
      `secondAuto=${secondPlan.autoIngest.length} entities=${secondView.entities.length} events=${secondView.timeline.events.length} hooks=${secondView.plotHooks.length}`,
    );

    await opened.db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log('=== fact-extraction 冒烟 ===');
  smokeCompleteJson();
  smokeFencedJson();
  smokeNormalizer();
  await smokeFactExtractor();
  smokeIngestPlan();
  await smokeIngestWriter();
  console.log(`=== 完成：${failures === 0 ? '全部通过' : `${failures} 项失败`} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
