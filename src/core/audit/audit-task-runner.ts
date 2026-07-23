/**
 * 全书总检的纯对撞计算 (I5 audit-worker-runtime task 2.2)
 *
 * spec: audit-worker-runtime「对撞计算为纯函数可独立校验」——把总检 Map-Reduce 骨架对撞与健康度评分
 * 收敛为**无 I/O、无 Electron 依赖的纯函数**，既可在 utilityProcess worker 内执行，也可在 Main 内联
 * 回退、并可在不启动 utilityProcess 的情况下被独立调用校验（如 Node 冒烟）。
 *
 * 只读事实库快照（FactView），只对撞结构化骨架、不重读正文水字（见 map-reduce-audit spec）。
 * 产出问题复用 story-bible 统一一致性问题模型（ConsistencyIssue），与局部检查同构。
 * 本文件为纯函数（无 I/O）。此前位于 main/audit/global-audit.ts，本波抽至 core 供 worker/内联共用。
 */

import type { NodeRef } from '../manuscript/index.js';
import type { ConsistencyIssue, FactView, Provenance } from '../story-bible/index.js';

export interface AuditScoreExplanation {
  readonly criticalWeight: number;
  readonly warningWeight: number;
  readonly infoWeight: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly penalty: number;
  readonly formula: string;
}

/** 一次总检的对撞产出（= 旧 GlobalAuditResult，纯计算结果，无 I/O）。 */
export interface AuditTaskResult {
  readonly factVersion: string;
  readonly generatedAt: number;
  readonly healthScore: number;
  readonly scoreExplanation: AuditScoreExplanation;
  readonly totalItems: number;
  readonly issues: ReadonlyArray<ConsistencyIssue>;
}

/** 兼容别名：旧调用点以 GlobalAuditResult 指代同一结构。 */
export type GlobalAuditResult = AuditTaskResult;

const CRITICAL_WEIGHT = 25;
const WARNING_WEIGHT = 8;
const INFO_WEIGHT = 2;

function firstSourceAnchor(provenance: Provenance): NodeRef | undefined {
  return provenance.sources[0]?.location;
}

function anchorsFromProvenance(provenance: Provenance): ReadonlyArray<NodeRef> {
  const anchors = provenance.sources.map((source) => source.location);
  return anchors.length > 0 ? anchors : [];
}

function uniqueAnchors(anchors: ReadonlyArray<NodeRef>): ReadonlyArray<NodeRef> {
  const seen = new Set<string>();
  const result: NodeRef[] = [];
  for (const anchor of anchors) {
    const key = `${anchor.kind}:${anchor.id as string}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(anchor);
  }
  return result;
}

function scoreIssues(issues: ReadonlyArray<ConsistencyIssue>): Pick<AuditTaskResult, 'healthScore' | 'scoreExplanation'> {
  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;
  const penalty = criticalCount * CRITICAL_WEIGHT + warningCount * WARNING_WEIGHT + infoCount * INFO_WEIGHT;
  return {
    healthScore: Math.max(0, 100 - penalty),
    scoreExplanation: {
      criticalWeight: CRITICAL_WEIGHT,
      warningWeight: WARNING_WEIGHT,
      infoWeight: INFO_WEIGHT,
      criticalCount,
      warningCount,
      infoCount,
      penalty,
      formula: `100 - critical*${CRITICAL_WEIGHT} - warning*${WARNING_WEIGHT} - info*${INFO_WEIGHT}`,
    },
  };
}

export function countAuditableItems(view: FactView): number {
  const attributes = view.entities.reduce((sum, entity) => sum + entity.attributes.length, 0);
  const relationPhases = view.relations.reduce((sum, relation) => sum + relation.phases.length, 0);
  return view.entities.length + attributes + view.timeline.events.length + view.relations.length + relationPhases + view.plotHooks.length;
}

function detectConflictingStatuses(view: FactView): ReadonlyArray<ConsistencyIssue> {
  const issues: ConsistencyIssue[] = [];

  for (const entity of view.entities) {
    const entityAnchors = anchorsFromProvenance(entity.provenance);
    if (entity.status === 'conflicting' && entityAnchors.length > 0) {
      issues.push({
        type: 'state-contradiction',
        severity: 'critical',
        anchors: entityAnchors,
        description: `实体「${entity.canonicalName}」当前处于 conflicting 状态，需要人工确认 Story Bible 中哪一版设定为准。`,
        suggestedFix: '打开 Story Bible 查看该实体出处，确认保留/修订哪一版事实后再继续写作。',
        requiresHumanDecision: true,
        options: [
          { id: `resolve-entity:${entity.id as string}:keep-existing`, label: '保留既有设定' },
          { id: `resolve-entity:${entity.id as string}:revise`, label: '修订设定或旧文' },
        ],
      });
    }

    const valuesByKey = new Map<string, Array<{ value: string; anchors: ReadonlyArray<NodeRef> }>>();
    for (const attribute of entity.attributes) {
      const anchors = anchorsFromProvenance(attribute.provenance);
      if (attribute.status === 'conflicting' && anchors.length > 0) {
        issues.push({
          type: 'state-contradiction',
          severity: 'critical',
          anchors,
          description: `实体「${entity.canonicalName}」的属性「${attribute.key}=${attribute.value}」处于 conflicting 状态。`,
          suggestedFix: '核对该属性的来源章节，确认人物/物品状态是否需要改设定或改旧文。',
          requiresHumanDecision: true,
          options: [
            { id: `resolve-attribute:${entity.id as string}:${attribute.key}:keep-existing`, label: '保留既有属性' },
            { id: `resolve-attribute:${entity.id as string}:${attribute.key}:revise`, label: '修订属性或旧文' },
          ],
        });
      }
      const current = valuesByKey.get(attribute.key) ?? [];
      current.push({ value: attribute.value, anchors });
      valuesByKey.set(attribute.key, current);
    }

    for (const [key, values] of valuesByKey) {
      const distinctValues = [...new Set(values.map((item) => item.value))];
      if (distinctValues.length < 2) continue;
      const anchors = uniqueAnchors(values.flatMap((item) => item.anchors));
      if (anchors.length === 0) continue;
      issues.push({
        type: 'state-contradiction',
        severity: 'warning',
        anchors,
        description: `实体「${entity.canonicalName}」的属性「${key}」存在多个取值：${distinctValues.join(' / ')}。这可能是状态演变，也可能是未标明时间点的矛盾。`,
        suggestedFix: '如果是状态演变，请补充时间线或阶段；如果不是，请统一属性取值。',
        requiresHumanDecision: true,
        options: [
          { id: `attribute-evolution:${entity.id as string}:${key}`, label: '这是随剧情变化的状态演变' },
          { id: `attribute-conflict:${entity.id as string}:${key}`, label: '这是需要修正的矛盾' },
        ],
      });
    }
  }

  for (const event of view.timeline.events) {
    const anchors = anchorsFromProvenance(event.provenance);
    if (event.status !== 'conflicting' || anchors.length === 0) continue;
    issues.push({
      type: 'timeline-break',
      severity: 'critical',
      anchors,
      description: `时间线事件「${event.description}」处于 conflicting 状态。`,
      suggestedFix: '核对该事件的先后顺序、发生时间与相关人物状态。',
      requiresHumanDecision: true,
      options: [
        { id: `resolve-event:${event.id}:keep-existing`, label: '保留既有时间线' },
        { id: `resolve-event:${event.id}:revise`, label: '修订时间线或旧文' },
      ],
    });
  }

  for (const hook of view.plotHooks) {
    const anchors = anchorsFromProvenance(hook.provenance);
    if (hook.status !== 'conflicting' || anchors.length === 0) continue;
    issues.push({
      type: 'plot-hook-dangling',
      severity: 'critical',
      anchors,
      description: `伏笔「${hook.description}」处于 conflicting 状态。`,
      suggestedFix: '确认该伏笔当前应为埋设、待回收、已回收还是作废。',
      requiresHumanDecision: true,
      options: [
        { id: `resolve-hook:${hook.id}:pending`, label: '保留为待回收' },
        { id: `resolve-hook:${hook.id}:paid-off`, label: '标记/补写回收' },
        { id: `resolve-hook:${hook.id}:abandoned`, label: '标记为作废' },
      ],
    });
  }

  return issues;
}

function detectDanglingPlotHooks(view: FactView): ReadonlyArray<ConsistencyIssue> {
  return view.plotHooks.flatMap((hook) => {
    if (hook.state !== 'planted' && hook.state !== 'pending') return [];
    const anchor = hook.plantedAt;
    return [{
      type: 'plot-hook-dangling',
      severity: 'warning',
      anchors: [anchor],
      description: `伏笔「${hook.description}」仍处于 ${hook.state} 状态，尚未在 Story Bible 中记录回收。`,
      suggestedFix: '确认后续是否需要回收；若已经在正文中回收，请补抽/确认对应事实；若不再使用，请标记作废。',
      requiresHumanDecision: true,
      options: [
        { id: `hook:${hook.id}:keep-pending`, label: '继续保留待回收' },
        { id: `hook:${hook.id}:needs-payoff`, label: '需要安排回收' },
        { id: `hook:${hook.id}:abandon`, label: '作废该伏笔' },
      ],
    } satisfies ConsistencyIssue];
  });
}

function detectRelationOrdering(view: FactView): ReadonlyArray<ConsistencyIssue> {
  const issues: ConsistencyIssue[] = [];
  const nameById = new Map(view.entities.map((entity) => [entity.id as string, entity.canonicalName]));

  for (const relation of view.relations) {
    for (let index = 1; index < relation.phases.length; index += 1) {
      const previous = relation.phases[index - 1];
      const current = relation.phases[index];
      if (previous === undefined || current === undefined) continue;
      if (previous.since.tick <= current.since.tick) continue;
      const anchors = uniqueAnchors([
        ...anchorsFromProvenance(previous.provenance),
        ...anchorsFromProvenance(current.provenance),
      ]);
      if (anchors.length === 0) continue;
      issues.push({
        type: 'timeline-break',
        severity: 'warning',
        anchors,
        description: `关系「${nameById.get(relation.from as string) ?? relation.from} → ${nameById.get(relation.to as string) ?? relation.to}」的相位顺序与 tick 不一致。`,
        suggestedFix: '检查关系相位的起始时序点，按故事内时间重新排序或修正 tick。',
        requiresHumanDecision: false,
      });
    }
  }

  return issues;
}

function detectLowConfidenceFacts(view: FactView): ReadonlyArray<ConsistencyIssue> {
  const issues: ConsistencyIssue[] = [];
  for (const entity of view.entities) {
    const source = entity.provenance.sources.find((item) => item.confidence < 0.45);
    const anchor = source?.location ?? firstSourceAnchor(entity.provenance);
    if (source === undefined || anchor === undefined) continue;
    issues.push({
      type: 'other',
      severity: 'info',
      anchors: [anchor],
      description: `实体「${entity.canonicalName}」的来源置信度较低（${source.confidence.toFixed(2)}），建议人工核对。`,
      suggestedFix: '打开 Story Bible 查看 provenance quote；必要时重新抽取或人工确认该事实。',
      evidence: { quote: source.quote },
      requiresHumanDecision: false,
    });
  }
  return issues;
}

/**
 * 跑一次全书总检对撞（纯函数，Map-Reduce 骨架对撞 + 评分）。
 * worker 与 Main 内联回退共用同一入口，保证两条路径语义/输出一致。
 */
export function runAuditTask(view: FactView): AuditTaskResult {
  const totalItems = countAuditableItems(view);
  const issues = [
    ...detectConflictingStatuses(view),
    ...detectDanglingPlotHooks(view),
    ...detectRelationOrdering(view),
    ...detectLowConfidenceFacts(view),
  ];
  const scored = scoreIssues(issues);
  return {
    factVersion: view.version as string,
    generatedAt: Date.now(),
    totalItems,
    issues,
    ...scored,
  };
}

/** 兼容别名：旧调用点以 runGlobalAuditOnView 指代同一纯计算。 */
export const runGlobalAuditOnView = runAuditTask;
