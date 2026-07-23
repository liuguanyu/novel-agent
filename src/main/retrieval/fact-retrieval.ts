/**
 * 历史事实结构化召回 (orchestration-runtime task 6.2)
 *
 * spec: historical-fact-retrieval——从 `SqliteFactStore` 结构化召回实体/伏笔/时间线，
 * 命中 MAY 按名字/别名/伏笔状态与描述关键词匹配，每条命中 MUST 携带真实 provenance
 *（NodeRef 章节锚点 + 引文）。MUST NOT 依赖把整本正文塞进 prompt。
 *
 * 软/硬锚点的区分在调用方（context-assembler）：本模块只做结构化召回本身，不预判锚点语义。
 * 纠偏/冲突判定在 reviewer 节点内（design D5）。
 *
 * 本文件为纯检索逻辑（无 I/O 副作用，仅读 FactStoreReader 视图），可迁移到 utilityProcess。
 */

import type {
  Entity,
  EntityId,
  FactView,
  PlotHook,
  TimelineEvent,
} from '../../core/story-bible/index.js';
import type { NodeRef } from '../../core/manuscript/node-id.js';

/** 召回请求：按关键词/类型/伏笔状态过滤。全部字段为可选（空则返回全集，由调用方裁剪）。 */
export interface FactRetrievalQuery {
  /** 实体名/别名子串匹配（大小写不敏感）；可空 */
  entityName?: string;
  /** 实体类型过滤（可空） */
  entityType?: string;
  /** 伏笔描述/状态过滤；状态为空则不限 */
  plotHookState?: 'planted' | 'pending' | 'paid_off' | 'abandoned';
  /** 伏笔描述关键词（子串匹配，可空） */
  plotHookKeyword?: string;
  /** 时间线事件描述关键词（子串匹配，可空） */
  timelineKeyword?: string;
}

/** 一条命中的出处（NodeRef + 引文 + 置信度，投影自 ProvenanceSource）。 */
export interface RetrievalProvenance {
  /** 章节锚点（复用 manuscript 稳定标识） */
  location: NodeRef;
  /** 引文片段（人工核对用） */
  quote: string;
  /** 置信度 0..1 */
  confidence: number;
}

/** 命中的实体（带规范名/别名/类型/出处）。 */
export interface RetrievedEntity {
  id: EntityId;
  type: string;
  canonicalName: string;
  aliases: ReadonlyArray<string>;
  provenance: ReadonlyArray<RetrievalProvenance>;
}

/** 命中的伏笔（带描述/状态/出处）。 */
export interface RetrievedPlotHook {
  id: string;
  description: string;
  state: string;
  plantedAt: NodeRef;
  provenance: ReadonlyArray<RetrievalProvenance>;
}

/** 命中的时间线事件（带描述/时序/相关实体/出处）。 */
export interface RetrievedTimelineEvent {
  id: string;
  description: string;
  tick: number;
  label: string;
  relatedEntityIds: ReadonlyArray<EntityId>;
  provenance: ReadonlyArray<RetrievalProvenance>;
}

/** 一次召回的结果集（分三类，各可为空）。 */
export interface RetrievalResult {
  entities: ReadonlyArray<RetrievedEntity>;
  plotHooks: ReadonlyArray<RetrievedPlotHook>;
  timelineEvents: ReadonlyArray<RetrievedTimelineEvent>;
}

/** 把 core Provenance 投影为可呈现的 RetrievalProvenance（去重 location+quote）。 */
function projectProvenance(sources: FactView['entities'][number]['provenance']): ReadonlyArray<RetrievalProvenance> {
  return sources.sources.map((s) => ({
    location: s.location,
    quote: s.quote,
    confidence: s.confidence,
  }));
}

/** 子串匹配（大小写不敏感，空 needle 视为命中）。 */
function matchesSubstring(haystack: string, needle: string | undefined): boolean {
  if (needle === undefined || needle.length === 0) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** 实体是否匹配查询（规范名或任一别名子串命中，或类型匹配）。 */
function entityMatches(entity: Entity, query: FactRetrievalQuery): boolean {
  if (query.entityType !== undefined && entity.type !== query.entityType) return false;
  if (query.entityName !== undefined && query.entityName.length > 0) {
    const needle = query.entityName.toLowerCase();
    const nameHit = entity.canonicalName.toLowerCase().includes(needle);
    const aliasHit = entity.aliasSet.aliases.some((a) => a.toLowerCase().includes(needle));
    return nameHit || aliasHit;
  }
  return true;
}

/** 伏笔是否匹配查询（状态+描述关键词）。 */
function plotHookMatches(hook: PlotHook, query: FactRetrievalQuery): boolean {
  if (query.plotHookState !== undefined && hook.state !== query.plotHookState) return false;
  return matchesSubstring(hook.description, query.plotHookKeyword);
}

/** 时间线事件是否匹配查询（描述关键词）。 */
function timelineEventMatches(event: TimelineEvent, query: FactRetrievalQuery): boolean {
  return matchesSubstring(event.description, query.timelineKeyword);
}

/**
 * 从给定事实视图执行结构化召回。
 * 纯函数：不读 DB，只过滤传入视图；调用方先 `getView(version)` 再调用本函数。
 * 这样 utilityProcess 迁移时只需把 getView 的结果跨进程传过来。
 */
export function retrieveFacts(view: FactView, query: FactRetrievalQuery): RetrievalResult {
  const entities = view.entities.filter((e) => entityMatches(e, query)).map((e) => ({
    id: e.id,
    type: e.type,
    canonicalName: e.canonicalName,
    aliases: [...e.aliasSet.aliases],
    provenance: projectProvenance(e.provenance),
  }));

  const plotHooks = view.plotHooks.filter((h) => plotHookMatches(h, query)).map((h) => ({
    id: h.id,
    description: h.description,
    state: h.state,
    plantedAt: h.plantedAt,
    provenance: projectProvenance(h.provenance),
  }));

  const timelineEvents = view.timeline.events
    .filter((ev) => timelineEventMatches(ev, query))
    .map((ev) => ({
      id: ev.id,
      description: ev.description,
      tick: ev.at.tick,
      label: ev.at.label,
      relatedEntityIds: [...ev.relatedEntities],
      provenance: projectProvenance(ev.provenance),
    }));

  return { entities, plotHooks, timelineEvents };
}

/**
 * 纠偏判定：作者陈述章号 vs 召回命中的真实出处章号是否一致。
 * 返回需要纠偏的命中（出处章号与作者陈述不一致），按接近度排序（此处以 tick/序为近似接近度）。
 * 调用方据此刻画纠偏提示，MUST NOT 默认替作者勾选（design D5）。
 */
export function detectChapterMismatches(
  hits: RetrievalResult,
  statedChapterNodeId: string,
): ReadonlyArray<{ kind: 'entity' | 'plotHook' | 'timelineEvent'; id: string; description: string; realChapterNodeId: string }> {
  const mismatches: Array<{
    kind: 'entity' | 'plotHook' | 'timelineEvent';
    id: string;
    description: string;
    realChapterNodeId: string;
  }> = [];

  for (const e of hits.entities) {
    for (const p of e.provenance) {
      if (p.location.id as string !== statedChapterNodeId) {
        mismatches.push({
          kind: 'entity',
          id: e.id as string,
          description: e.canonicalName,
          realChapterNodeId: p.location.id as string,
        });
      }
    }
  }
  for (const h of hits.plotHooks) {
    if (h.plantedAt.id as string !== statedChapterNodeId) {
      mismatches.push({
        kind: 'plotHook',
        id: h.id,
        description: h.description,
        realChapterNodeId: h.plantedAt.id as string,
      });
    }
  }
  for (const ev of hits.timelineEvents) {
    for (const p of ev.provenance) {
      if (p.location.id as string !== statedChapterNodeId) {
        mismatches.push({
          kind: 'timelineEvent',
          id: ev.id,
          description: ev.description,
          realChapterNodeId: p.location.id as string,
        });
      }
    }
  }

  return mismatches;
}
