/**
 * 候选事实规范化 (story-bible-extraction I4 tasks 3.1–3.5)
 *
 * 将已通过边界校验的 CandidateFact.payload 进一步收窄为可入库计划消费的
 * 强类型中间结构。此处仍不写 DB、不做最终冲突裁决；只负责：payload schema、
 * provenance 补齐、稳定 identityKey、目标实体解析与 skipped 诊断。
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  asEntityId,
  type CandidateFact,
  type Entity,
  type EntityAttribute,
  type EntityId,
  type FactStatus,
  type FactView,
  type PlotHook,
  type PlotHookState,
  type Provenance,
  type Relation,
  type TimelineEvent,
} from '../../core/story-bible/index.js';

const DEFAULT_STATUS: FactStatus = 'inferred';

const quotePayloadSchema = z.object({
  quote: z.string().min(1),
});

const entityAttributePayloadSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  quote: z.string().min(1).optional(),
});

const entityPayloadSchema = quotePayloadSchema.extend({
  entityType: z.string().min(1).default('other'),
  canonicalName: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  attributes: z.array(entityAttributePayloadSchema).optional(),
});

const aliasPayloadSchema = quotePayloadSchema.extend({
  entityId: z.string().min(1).optional(),
  entityName: z.string().min(1).optional(),
  alias: z.string().min(1),
});

const attributePayloadSchema = quotePayloadSchema.extend({
  entityId: z.string().min(1).optional(),
  entityName: z.string().min(1).optional(),
  key: z.string().min(1),
  value: z.string().min(1),
});

const timelineEventPayloadSchema = quotePayloadSchema.extend({
  description: z.string().min(1),
  tick: z.number().int().optional(),
  label: z.string().min(1).optional(),
  durationTicks: z.number().int().positive().optional(),
  relatedEntityIds: z.array(z.string().min(1)).optional(),
  relatedNames: z.array(z.string().min(1)).optional(),
});

const relationPayloadSchema = quotePayloadSchema.extend({
  fromEntityId: z.string().min(1).optional(),
  fromName: z.string().min(1).optional(),
  toEntityId: z.string().min(1).optional(),
  toName: z.string().min(1).optional(),
  kind: z.string().min(1),
  directionality: z.enum(['directed', 'undirected']).default('directed'),
  tick: z.number().int().optional(),
  label: z.string().min(1).optional(),
});

const plotHookPayloadSchema = quotePayloadSchema.extend({
  description: z.string().min(1),
  state: z.enum(['planted', 'pending', 'paid_off', 'abandoned']).default('planted'),
});

export type NormalizedFact =
  | { readonly kind: 'entity'; readonly identityKey: string; readonly entity: Entity }
  | {
      readonly kind: 'alias';
      readonly identityKey: string;
      readonly entityId: EntityId;
      readonly alias: string;
      readonly provenance: Provenance;
    }
  | {
      readonly kind: 'attribute';
      readonly identityKey: string;
      readonly entityId: EntityId;
      readonly attribute: EntityAttribute;
    }
  | {
      readonly kind: 'timeline-event';
      readonly identityKey: string;
      readonly event: TimelineEvent;
    }
  | { readonly kind: 'relation'; readonly identityKey: string; readonly relation: Relation }
  | { readonly kind: 'plot-hook'; readonly identityKey: string; readonly hook: PlotHook };

export interface SkippedCandidate {
  readonly candidate: CandidateFact;
  readonly reason: string;
}

export interface NormalizationResult {
  readonly facts: ReadonlyArray<NormalizedFact>;
  readonly skipped: ReadonlyArray<SkippedCandidate>;
}

function stableHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function identityKey(candidate: CandidateFact, identity: string): string {
  return `${candidate.suggestedAnchor.kind}:${candidate.suggestedAnchor.id}:${candidate.kind}:${normalizeText(identity)}`;
}

function provenance(candidate: CandidateFact, quote: string): Provenance {
  return {
    sources: [
      {
        location: candidate.suggestedAnchor,
        quote,
        confidence: candidate.confidence,
      },
    ],
  };
}

function entityIdFromName(canonicalName: string): EntityId {
  return asEntityId(`ent-${stableHash(normalizeText(canonicalName))}`);
}

function generatedId(prefix: string, key: string): string {
  return `${prefix}-${stableHash(key)}`;
}

function findEntity(view: FactView, idOrName: { entityId?: string; entityName?: string }): Entity | null {
  if (idOrName.entityId !== undefined) {
    return view.entities.find((entity) => entity.id === idOrName.entityId) ?? null;
  }
  if (idOrName.entityName === undefined) return null;
  const name = normalizeText(idOrName.entityName);
  return (
    view.entities.find(
      (entity) =>
        normalizeText(entity.canonicalName) === name ||
        entity.aliasSet.aliases.some((alias) => normalizeText(alias) === name),
    ) ?? null
  );
}

function entityLookup(input: { entityId?: string | undefined; entityName?: string | undefined }): { entityId?: string; entityName?: string } {
  return {
    ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
    ...(input.entityName !== undefined ? { entityName: input.entityName } : {}),
  };
}

function parsePayload<T>(schema: z.ZodType<T>, candidate: CandidateFact): T | null {
  const parsed = schema.safeParse(candidate.payload);
  return parsed.success ? parsed.data : null;
}

function normalizeEntity(candidate: CandidateFact): NormalizedFact | SkippedCandidate {
  const payload = parsePayload(entityPayloadSchema, candidate);
  if (payload === null) return { candidate, reason: 'entity payload 缺少 canonicalName/quote' };

  const names = new Set<string>([payload.canonicalName, ...(payload.aliases ?? [])]);
  const baseProvenance = provenance(candidate, payload.quote);
  const attributes: EntityAttribute[] = (payload.attributes ?? []).map((attr) => ({
    key: attr.key,
    value: attr.value,
    status: DEFAULT_STATUS,
    provenance: provenance(candidate, attr.quote ?? payload.quote),
  }));
  const entity: Entity = {
    id: entityIdFromName(payload.canonicalName),
    type: payload.entityType ?? 'other',
    canonicalName: payload.canonicalName,
    aliasSet: {
      aliases: [...names],
      status: DEFAULT_STATUS,
      provenance: baseProvenance,
    },
    attributes,
    status: DEFAULT_STATUS,
    provenance: baseProvenance,
  };
  return { kind: 'entity', identityKey: identityKey(candidate, payload.canonicalName), entity };
}

function normalizeAlias(candidate: CandidateFact, view: FactView): NormalizedFact | SkippedCandidate {
  const payload = parsePayload(aliasPayloadSchema, candidate);
  if (payload === null) return { candidate, reason: 'alias payload 缺少 alias/quote' };
  const entity = findEntity(view, entityLookup(payload));
  if (entity === null) return { candidate, reason: 'alias 候选无法解析目标实体' };
  return {
    kind: 'alias',
    identityKey: identityKey(candidate, `${entity.id}:${payload.alias}`),
    entityId: entity.id,
    alias: payload.alias,
    provenance: provenance(candidate, payload.quote),
  };
}

function normalizeAttribute(candidate: CandidateFact, view: FactView): NormalizedFact | SkippedCandidate {
  const payload = parsePayload(attributePayloadSchema, candidate);
  if (payload === null) return { candidate, reason: 'attribute payload 缺少 key/value/quote' };
  const entity = findEntity(view, entityLookup(payload));
  if (entity === null) return { candidate, reason: 'attribute 候选无法解析目标实体' };
  const attribute: EntityAttribute = {
    key: payload.key,
    value: payload.value,
    status: DEFAULT_STATUS,
    provenance: provenance(candidate, payload.quote),
  };
  return {
    kind: 'attribute',
    identityKey: identityKey(candidate, `${entity.id}:${payload.key}:${payload.value}`),
    entityId: entity.id,
    attribute,
  };
}

function resolveEntityIds(view: FactView, ids: ReadonlyArray<string> | undefined, names: ReadonlyArray<string> | undefined): ReadonlyArray<EntityId> {
  const resolved = new Set<EntityId>();
  for (const id of ids ?? []) {
    const entity = findEntity(view, { entityId: id });
    if (entity !== null) resolved.add(entity.id);
  }
  for (const name of names ?? []) {
    const entity = findEntity(view, { entityName: name });
    if (entity !== null) resolved.add(entity.id);
  }
  return [...resolved];
}

function normalizeTimelineEvent(candidate: CandidateFact, view: FactView): NormalizedFact | SkippedCandidate {
  const payload = parsePayload(timelineEventPayloadSchema, candidate);
  if (payload === null) return { candidate, reason: 'timeline-event payload 缺少 description/quote' };
  const key = identityKey(candidate, payload.description);
  const event: TimelineEvent = {
    id: generatedId('evt', key),
    description: payload.description,
    at: {
      tick: payload.tick ?? view.timeline.events.length + 1,
      label: payload.label ?? payload.description,
    },
    ...(payload.durationTicks !== undefined ? { durationTicks: payload.durationTicks } : {}),
    relatedEntities: resolveEntityIds(view, payload.relatedEntityIds, payload.relatedNames),
    status: DEFAULT_STATUS,
    provenance: provenance(candidate, payload.quote),
  };
  return { kind: 'timeline-event', identityKey: key, event };
}

function normalizeRelation(candidate: CandidateFact, view: FactView): NormalizedFact | SkippedCandidate {
  const payload = parsePayload(relationPayloadSchema, candidate);
  if (payload === null) return { candidate, reason: 'relation payload 缺少 kind/quote' };
  const from = findEntity(
    view,
    entityLookup({ entityId: payload.fromEntityId, entityName: payload.fromName }),
  );
  const to = findEntity(
    view,
    entityLookup({ entityId: payload.toEntityId, entityName: payload.toName }),
  );
  if (from === null || to === null) return { candidate, reason: 'relation 候选无法解析关系两端实体' };
  const key = identityKey(candidate, `${from.id}:${payload.kind}:${to.id}`);
  const relation: Relation = {
    id: generatedId('rel', key),
    from: from.id,
    to: to.id,
    directionality: payload.directionality ?? 'directed',
    phases: [
      {
        kind: payload.kind,
        since: {
          tick: payload.tick ?? view.timeline.events.length + 1,
          label: payload.label ?? payload.kind,
        },
        status: DEFAULT_STATUS,
        provenance: provenance(candidate, payload.quote),
      },
    ],
  };
  return { kind: 'relation', identityKey: key, relation };
}

function normalizePlotHook(candidate: CandidateFact): NormalizedFact | SkippedCandidate {
  const payload = parsePayload(plotHookPayloadSchema, candidate);
  if (payload === null) return { candidate, reason: 'plot-hook payload 缺少 description/quote' };
  const key = identityKey(candidate, payload.description);
  const hook: PlotHook = {
    id: generatedId('hook', key),
    description: payload.description,
    state: payload.state as PlotHookState,
    plantedAt: candidate.suggestedAnchor,
    ...(payload.state === 'paid_off' ? { paidOffAt: candidate.suggestedAnchor } : {}),
    status: DEFAULT_STATUS,
    provenance: provenance(candidate, payload.quote),
  };
  return { kind: 'plot-hook', identityKey: key, hook };
}

function normalizeOne(candidate: CandidateFact, view: FactView): NormalizedFact | SkippedCandidate {
  switch (candidate.kind) {
    case 'entity':
      return normalizeEntity(candidate);
    case 'alias':
      return normalizeAlias(candidate, view);
    case 'attribute':
      return normalizeAttribute(candidate, view);
    case 'timeline-event':
      return normalizeTimelineEvent(candidate, view);
    case 'relation':
      return normalizeRelation(candidate, view);
    case 'plot-hook':
      return normalizePlotHook(candidate);
  }
}

/** 将候选事实规范化为入库计划可消费的中间结构。 */
export function normalizeCandidateFacts(
  candidates: ReadonlyArray<CandidateFact>,
  view: FactView,
): NormalizationResult {
  const facts: NormalizedFact[] = [];
  const skipped: SkippedCandidate[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeOne(candidate, view);
    if ('reason' in normalized) {
      skipped.push(normalized);
    } else {
      facts.push(normalized);
    }
  }
  return { facts, skipped };
}
