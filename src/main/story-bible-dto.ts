/**
 * Story Bible 只读 DTO 投影 (story-bible-panel)
 *
 * Main 侧把 core FactView 投影为 shared/ipc 的纯可序列化结构，Renderer 不直接
 * 依赖 core/db 类型，也不触碰 SQLite。
 */

import type { FactView, Provenance } from '../core/story-bible/index.js';
import type {
  ProvenanceSourceDto,
  StoryBibleDto,
  StoryBibleEntityDto,
  StoryBiblePlotHookDto,
  StoryBibleRelationDto,
  StoryBibleTimelineEventDto,
  ArchitectBoardDto,
} from '../shared/ipc/index.js';

function sources(provenance: Provenance): ReadonlyArray<ProvenanceSourceDto> {
  return provenance.sources.map((source) => ({
    location: { id: source.location.id as string, kind: source.location.kind },
    quote: source.quote,
    confidence: source.confidence,
  }));
}

export function emptyStoryBibleDto(): StoryBibleDto {
  return {
    latestVersion: null,
    entities: [],
    timelineEvents: [],
    relations: [],
    plotHooks: [],
  };
}

export function projectStoryBible(view: FactView): StoryBibleDto {
  const entityNameById = new Map(view.entities.map((entity) => [entity.id as string, entity.canonicalName]));

  const entities: StoryBibleEntityDto[] = view.entities.map((entity) => ({
    id: entity.id as string,
    type: entity.type,
    canonicalName: entity.canonicalName,
    aliases: entity.aliasSet.aliases,
    attributes: entity.attributes.map((attribute) => ({
      key: attribute.key,
      value: attribute.value,
      status: attribute.status,
      sources: sources(attribute.provenance),
    })),
    status: entity.status,
    sources: sources(entity.provenance),
  }));

  const timelineEvents: StoryBibleTimelineEventDto[] = view.timeline.events.map((event) => ({
    id: event.id,
    description: event.description,
    tick: event.at.tick,
    label: event.at.label,
    relatedEntityIds: event.relatedEntities.map((id) => id as string),
    status: event.status,
    sources: sources(event.provenance),
  }));

  const relations: StoryBibleRelationDto[] = view.relations.map((relation) => ({
    id: relation.id,
    fromEntityId: relation.from as string,
    fromName: entityNameById.get(relation.from as string) ?? relation.from,
    toEntityId: relation.to as string,
    toName: entityNameById.get(relation.to as string) ?? relation.to,
    directionality: relation.directionality,
    phases: relation.phases.map((phase) => ({
      kind: phase.kind,
      tick: phase.since.tick,
      label: phase.since.label,
      status: phase.status,
      sources: sources(phase.provenance),
    })),
  }));

  const plotHooks: StoryBiblePlotHookDto[] = view.plotHooks.map((hook) => ({
    id: hook.id,
    description: hook.description,
    state: hook.state,
    plantedAt: { id: hook.plantedAt.id as string, kind: hook.plantedAt.kind },
    ...(hook.paidOffAt !== undefined
      ? { paidOffAt: { id: hook.paidOffAt.id as string, kind: hook.paidOffAt.kind } }
      : {}),
    status: hook.status,
    sources: sources(hook.provenance),
  }));

  return {
    latestVersion: view.version as string,
    entities,
    timelineEvents,
    relations,
    plotHooks,
  };
}

/** 空架构看板（无最新版本时）。 */
export function emptyArchitectBoardDto(): ArchitectBoardDto {
  return { latestVersion: null, timeline: [], plotHooks: [], entities: [] };
}

/**
 * 把 FactView 投影为 architect 架构看板（后端排序/派生，Renderer 只呈现）。
 * 三轴复用 projectStoryBible 的子投影；时间线轴在后端按 tick 升序（见 architect-board spec）。
 */
export function projectArchitectBoard(view: FactView): ArchitectBoardDto {
  const bible = projectStoryBible(view);
  const timeline = [...bible.timelineEvents].sort((a, b) => a.tick - b.tick);
  return {
    latestVersion: bible.latestVersion,
    timeline,
    plotHooks: bible.plotHooks,
    entities: bible.entities,
  };
}
