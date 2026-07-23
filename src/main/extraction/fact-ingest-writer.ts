/**
 * 事实入库计划写入器 (story-bible-extraction I4 tasks 5.1–5.4)
 *
 * 将 buildIngestPlan 产出的 autoIngest 项批量应用到 SqliteFactStore：
 * - 每批创建一个 fact version
 * - entity/timeline/relation/plotHook 调用既有 put* API
 * - alias/attribute 通过更新目标 Entity 后 putEntity
 *
 * 本文件是 Main-only 写 DB 边界；normalizer/ingest plan 仍保持纯函数。
 */

import type { CheckpointId, Entity, EntityId, FactVersionId, FactView } from '../../core/story-bible/index.js';
import type { SqliteFactStore } from '../db/index.js';
import type { AutoIngestItem, IngestPlan } from './candidate-ingest.js';

export interface ApplyIngestPlanOptions {
  readonly checkpoint?: CheckpointId | null;
}

export interface ApplyIngestPlanResult {
  readonly version: FactVersionId;
  readonly written: number;
}

function cloneEntity(entity: Entity): Entity {
  return {
    ...entity,
    aliasSet: {
      ...entity.aliasSet,
      aliases: [...entity.aliasSet.aliases],
    },
    attributes: [...entity.attributes],
  };
}

function sameText(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ');
}

function getMutableEntity(
  entityUpdates: Map<EntityId, Entity>,
  view: FactView,
  id: EntityId,
): Entity | null {
  const cached = entityUpdates.get(id);
  if (cached !== undefined) return cached;
  const existing = view.entities.find((entity) => entity.id === id);
  if (existing === undefined) return null;
  const cloned = cloneEntity(existing);
  entityUpdates.set(id, cloned);
  return cloned;
}

function applyEntityUpdate(item: AutoIngestItem, view: FactView, entityUpdates: Map<EntityId, Entity>): boolean {
  const fact = item.fact;
  switch (fact.kind) {
    case 'entity':
      entityUpdates.set(fact.entity.id, cloneEntity(fact.entity));
      return true;
    case 'alias': {
      const entity = getMutableEntity(entityUpdates, view, fact.entityId);
      if (entity === null) return false;
      if (!entity.aliasSet.aliases.some((alias) => sameText(alias, fact.alias))) {
        entity.aliasSet = {
          ...entity.aliasSet,
          aliases: [...entity.aliasSet.aliases, fact.alias],
          provenance: fact.provenance,
        };
      }
      return true;
    }
    case 'attribute': {
      const entity = getMutableEntity(entityUpdates, view, fact.entityId);
      if (entity === null) return false;
      const withoutSameKey = entity.attributes.filter(
        (attr) => !sameText(attr.key, fact.attribute.key),
      );
      entity.attributes = [...withoutSameKey, fact.attribute];
      return true;
    }
    case 'timeline-event':
    case 'relation':
    case 'plot-hook':
      return false;
  }
}

/** 将入库计划中的 autoIngest 项写入 SqliteFactStore。冲突/跳过项不会被写入。 */
export async function applyIngestPlan(
  store: SqliteFactStore,
  plan: IngestPlan,
  view: FactView,
  options: ApplyIngestPlanOptions = {},
): Promise<ApplyIngestPlanResult> {
  const parent = await store.getLatestVersion();
  const version = await store.appendVersion({
    ...(parent !== null ? { parent } : {}),
    ...(options.checkpoint !== undefined ? { checkpoint: options.checkpoint } : {}),
  });
  const checkpoint = options.checkpoint ?? null;
  const entityUpdates = new Map<EntityId, Entity>();
  let written = 0;

  const deferredWrites: AutoIngestItem[] = [];
  for (const item of plan.autoIngest) {
    if (applyEntityUpdate(item, view, entityUpdates)) continue;
    deferredWrites.push(item);
  }

  for (const entity of entityUpdates.values()) {
    await store.putEntity(version, entity, checkpoint);
    written += 1;
  }

  for (const item of deferredWrites) {
    const fact = item.fact;
    switch (fact.kind) {
      case 'timeline-event':
        await store.putTimelineEvent(version, fact.event, checkpoint);
        written += 1;
        break;
      case 'relation':
        await store.putRelation(version, fact.relation, checkpoint);
        written += 1;
        break;
      case 'plot-hook':
        await store.putPlotHook(version, fact.hook, checkpoint);
        written += 1;
        break;
      case 'entity':
      case 'alias':
      case 'attribute':
        break;
    }
  }

  return { version, written };
}
