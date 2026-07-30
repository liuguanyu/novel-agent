/**
 * 候选事实入库计划 (story-bible-extraction I4 tasks 4.1–4.5)
 *
 * 输入 normalizer 产出的强类型事实 + 当前 FactView，输出确定性的入库计划：
 * - autoIngest：低风险新增/更新，可后续写入 SqliteFactStore
 * - conflicts：会覆盖 confirmed 或造成实体/别名歧义，必须走手刹裁决
 * - skipped：重复或无法处理项，幂等跳过
 *
 * 本文件不写 DB、不调用模型，便于 smoke 与后续 worker 复用。
 */

import type {
  ConsistencyIssue,
  Entity,
  EntityAttribute,
  FactStatus,
  FactView,
  PlotHook,
  Provenance,
  Relation,
  TimelineEvent,
} from '../../core/story-bible/index.js';
import type { NodeRef } from '../../core/manuscript/node-id.js';
import type { NormalizedFact, SkippedCandidate } from './candidate-normalizer.js';

export type IngestOperation = 'add' | 'update';

export interface AutoIngestItem {
  readonly operation: IngestOperation;
  readonly fact: NormalizedFact;
  readonly reason: string;
}

export interface IngestConflict {
  readonly fact: NormalizedFact;
  readonly issue: ConsistencyIssue;
  readonly existingLabel: string;
}

export interface IngestSkippedItem {
  readonly fact: NormalizedFact;
  readonly reason: string;
}

export interface IngestPlanDiagnostics {
  readonly autoIngest: number;
  readonly conflicts: number;
  readonly skipped: number;
}

export interface IngestPlan {
  readonly autoIngest: ReadonlyArray<AutoIngestItem>;
  readonly conflicts: ReadonlyArray<IngestConflict>;
  readonly skipped: ReadonlyArray<IngestSkippedItem>;
  readonly diagnostics: IngestPlanDiagnostics;
}

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function sameText(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

function provenanceOf(fact: NormalizedFact): Provenance {
  switch (fact.kind) {
    case 'entity':
      return fact.entity.provenance;
    case 'alias':
      return fact.provenance;
    case 'attribute':
      return fact.attribute.provenance;
    case 'timeline-event':
      return fact.event.provenance;
    case 'relation':
      return fact.relation.phases[0]?.provenance ?? { sources: [] };
    case 'plot-hook':
      return fact.hook.provenance;
  }
}

function firstAnchor(provenance: Provenance): NodeRef {
  return provenance.sources[0]?.location ?? { id: '' as NodeRef['id'], kind: 'chapter' };
}

function firstQuote(provenance: Provenance): string | undefined {
  return provenance.sources[0]?.quote;
}

function anchorsFor(newFact: NormalizedFact, existing?: Provenance): ReadonlyArray<NodeRef> {
  const anchors: NodeRef[] = [firstAnchor(provenanceOf(newFact))];
  const existingAnchor = existing !== undefined ? firstAnchor(existing) : undefined;
  if (existingAnchor !== undefined && existingAnchor.id !== anchors[0]?.id) anchors.push(existingAnchor);
  return anchors;
}

function conflictIssue(
  fact: NormalizedFact,
  description: string,
  suggestedFix: string,
  type: string,
  existing?: Provenance,
): ConsistencyIssue {
  const quote = firstQuote(provenanceOf(fact));
  return {
    type,
    severity: 'critical',
    anchors: anchorsFor(fact, existing),
    description,
    suggestedFix,
    ...(quote !== undefined ? { evidence: { quote } } : {}),
    requiresHumanDecision: true,
    options: [
      { id: 'accept-new', label: '接受新事实，更新事实库' },
      { id: 'keep-existing', label: '保留既有事实，忽略新候选' },
      { id: 'manual-edit', label: '手工修改事实后再入库' },
      { id: 'ignore-candidate', label: '忽略本候选' },
    ],
  };
}

function findEntityByNameOrAlias(view: FactView, entity: Entity): Entity | null {
  const names = [entity.canonicalName, ...entity.aliasSet.aliases];
  return (
    view.entities.find(
      (existing) =>
        names.some((name) => sameText(existing.canonicalName, name)) ||
        names.some((name) => existing.aliasSet.aliases.some((alias) => sameText(alias, name))),
    ) ?? null
  );
}

function findEntityByAlias(view: FactView, alias: string): Entity | null {
  return view.entities.find((entity) => entity.aliasSet.aliases.some((a) => sameText(a, alias))) ?? null;
}

function findEntity(view: FactView, fact: NormalizedFact): Entity | null {
  if (fact.kind !== 'alias' && fact.kind !== 'attribute') return null;
  return view.entities.find((entity) => entity.id === fact.entityId) ?? null;
}

function findAttribute(entity: Entity, attribute: EntityAttribute): EntityAttribute | null {
  return entity.attributes.find((existing) => sameText(existing.key, attribute.key)) ?? null;
}

function isConfirmed(status: FactStatus): boolean {
  return status === 'confirmed';
}

function timelineHas(view: FactView, event: TimelineEvent): boolean {
  return view.timeline.events.some(
    (existing) => existing.id === event.id || sameText(existing.description, event.description),
  );
}

function relationHas(view: FactView, relation: Relation): boolean {
  return view.relations.some(
    (existing) =>
      existing.id === relation.id ||
      (existing.from === relation.from &&
        existing.to === relation.to &&
        existing.phases.some((phase) =>
          relation.phases.some((candidatePhase) => sameText(phase.kind, candidatePhase.kind)),
        )),
  );
}

function plotHookHas(view: FactView, hook: PlotHook): boolean {
  return view.plotHooks.some(
    (existing) => existing.id === hook.id || sameText(existing.description, hook.description),
  );
}

function planOne(
  fact: NormalizedFact,
  view: FactView,
  targetView: FactView = view,
): AutoIngestItem | IngestConflict | IngestSkippedItem {
  switch (fact.kind) {
    case 'entity': {
      const existing = findEntityByNameOrAlias(view, fact.entity);
      if (existing === null) {
        return { operation: 'add', fact, reason: '新增实体' };
      }
      return { fact, reason: `实体已存在：${existing.canonicalName}` };
    }
    case 'alias': {
      const target = findEntity(targetView, fact);
      if (target === null) return { fact, reason: '目标实体不存在，跳过 alias' };
      if (target.aliasSet.aliases.some((alias) => sameText(alias, fact.alias))) {
        return { fact, reason: 'alias 已存在，幂等跳过' };
      }
      const owner = findEntityByAlias(view, fact.alias);
      if (owner !== null && owner.id !== target.id && isConfirmed(owner.aliasSet.status)) {
        return {
          fact,
          existingLabel: owner.canonicalName,
          issue: conflictIssue(
            fact,
            `别名“${fact.alias}”已属于 confirmed 实体“${owner.canonicalName}”，不能自动分配给“${target.canonicalName}”。`,
            '请确认该称呼应归属哪个人物，或手工拆分/合并实体。',
            'naming-conflict',
            owner.aliasSet.provenance,
          ),
        };
      }
      return { operation: 'update', fact, reason: '新增实体别名' };
    }
    case 'attribute': {
      const target = findEntity(targetView, fact);
      if (target === null) return { fact, reason: '目标实体不存在，跳过 attribute' };
      const existing = findAttribute(target, fact.attribute);
      if (existing === null) return { operation: 'update', fact, reason: '新增实体属性' };
      if (sameText(existing.value, fact.attribute.value)) {
        return { fact, reason: '属性 key/value 已存在，幂等跳过' };
      }
      if (isConfirmed(existing.status)) {
        return {
          fact,
          existingLabel: `${target.canonicalName}.${existing.key}=${existing.value}`,
          issue: conflictIssue(
            fact,
            `候选属性“${target.canonicalName}.${fact.attribute.key}=${fact.attribute.value}”与 confirmed 事实“${existing.value}”冲突。`,
            '请决定更新人物设定、保留旧设定，或手工改写候选事实。',
            'state-contradiction',
            existing.provenance,
          ),
        };
      }
      return { operation: 'update', fact, reason: '更新 inferred 属性' };
    }
    case 'timeline-event':
      return timelineHas(view, fact.event)
        ? { fact, reason: '时间线事件已存在，幂等跳过' }
        : { operation: 'add', fact, reason: '新增时间线事件' };
    case 'relation': {
      if (relationHas(view, fact.relation)) return { fact, reason: '关系已存在，幂等跳过' };
      const fromExists = targetView.entities.some((entity) => entity.id === fact.relation.from);
      const toExists = targetView.entities.some((entity) => entity.id === fact.relation.to);
      if (!fromExists || !toExists) {
        const missing = [!fromExists ? fact.relation.from : undefined, !toExists ? fact.relation.to : undefined].filter((id): id is NonNullable<typeof id> => id !== undefined);
        return { fact, reason: `关系端点实体不存在，跳过 relation：${missing.join('、')}` };
      }
      return { operation: 'add', fact, reason: '新增实体关系' };
    }
    case 'plot-hook':
      return plotHookHas(view, fact.hook)
        ? { fact, reason: '伏笔已存在，幂等跳过' }
        : { operation: 'add', fact, reason: '新增伏笔' };
  }
}

function isConflict(item: AutoIngestItem | IngestConflict | IngestSkippedItem): item is IngestConflict {
  return 'issue' in item;
}

function isAuto(item: AutoIngestItem | IngestConflict | IngestSkippedItem): item is AutoIngestItem {
  return 'operation' in item;
}

/** 对强类型候选事实构建确定性入库计划。 */
export function buildIngestPlan(
  facts: ReadonlyArray<NormalizedFact>,
  view: FactView,
  preSkipped: ReadonlyArray<SkippedCandidate> = [],
): IngestPlan {
  const batchEntities = facts.flatMap((fact) => {
    if (fact.kind !== 'entity') return [];
    return findEntityByNameOrAlias(view, fact.entity) === null ? [fact.entity] : [];
  });
  const targetView: FactView =
    batchEntities.length === 0
      ? view
      : { ...view, entities: [...view.entities, ...batchEntities] };
  const planned = facts.map((fact) => planOne(fact, view, targetView));
  const autoIngest = planned.filter(isAuto);
  const conflicts = planned.filter(isConflict);
  const plannedSkipped = planned.filter(
    (item): item is IngestSkippedItem => !isAuto(item) && !isConflict(item),
  );
  const skipped: IngestSkippedItem[] = [...plannedSkipped];
  void preSkipped;
  return {
    autoIngest,
    conflicts,
    skipped,
    diagnostics: {
      autoIngest: autoIngest.length,
      conflicts: conflicts.length,
      skipped: skipped.length,
    },
  };
}
