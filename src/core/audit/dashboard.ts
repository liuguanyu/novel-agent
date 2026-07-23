/**
 * 质量仪表盘 (global-audit tasks 2.1–2.4)
 *
 * spec: quality-dashboard——复用 story-bible 统一一致性问题模型（局部与全局同构）;产出健康度评分与
 * 按 severity 分级的红黄牌列表，每条含定位锚点;点击一键跳章（稳定标识符防漂移）;一键修复走
 * surgical-refactor 局部 diff、逐 hunk 接受、MUST NOT 整章覆盖（见 design D3–D5）。
 *
 * 本文件为类型契约 + 纯评分/定位 helper（无 I/O）。问题复用 ConsistencyIssue（不另立模型）;
 * 跳章复用 NodeRef;一键修复复用 surgical-refactor 的 RefactorInput 通道（走局部 diff）。
 */

import type { NodeRef } from '../manuscript/node-id.js';
import type { ConsistencyIssue, IssueSeverity } from '../story-bible/consistency-issue.js';
import type { RefactorInput } from '../refactor/fragment.js';

/**
 * 健康度评分权重 (task 2.2 / spec「评分可解释」)。
 * 评分由问题数量与严重度加权得出，MUST NOT 黑盒魔数;权重 MAY 可配置。
 */
export interface HealthScoreWeights {
  /** 每个 critical 问题的扣分 */
  critical: number;
  /** 每个 warning 问题的扣分 */
  warning: number;
  /** 每个 info 问题的扣分 */
  info: number;
}

/** 默认权重（可解释、可被配置覆盖）。 */
export const DEFAULT_HEALTH_WEIGHTS: HealthScoreWeights = {
  critical: 15,
  warning: 5,
  info: 1,
};

/**
 * 健康度评分明细 (task 2.2)。可解释:附各级问题计数与扣分构成，非单一魔数。
 */
export interface HealthScore {
  /** 0–100 的健康度分（100 为满分自洽） */
  score: number;
  /** 各严重度问题计数 */
  counts: Readonly<Record<IssueSeverity, number>>;
  /** 采用的权重（供解释） */
  weights: HealthScoreWeights;
}

/**
 * 计算健康度评分 (task 2.2)。纯函数、可解释。
 * score = clamp(100 - Σ(count[severity] * weight[severity]), 0, 100)。
 */
export function computeHealthScore(
  issues: ReadonlyArray<ConsistencyIssue>,
  weights: HealthScoreWeights = DEFAULT_HEALTH_WEIGHTS,
): HealthScore {
  const counts: Record<IssueSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    counts[issue.severity] += 1;
  }
  const penalty =
    counts.critical * weights.critical +
    counts.warning * weights.warning +
    counts.info * weights.info;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  return { score, counts, weights };
}

/** 红黄牌等级（呈现分级，映射自 severity）。 */
export type CardLevel = 'red' | 'yellow' | 'grey';

/** severity → 红黄牌等级映射。纯函数。 */
export function toCardLevel(severity: IssueSeverity): CardLevel {
  if (severity === 'critical') return 'red';
  if (severity === 'warning') return 'yellow';
  return 'grey';
}

/**
 * 仪表盘一条问题项 (task 2.2)：统一问题 + 呈现等级 + 定位锚点。
 * 定位锚点取问题首个 anchor（NodeRef，稳定标识符防漂移，task 2.3）。
 */
export interface DashboardIssue {
  issue: ConsistencyIssue;
  level: CardLevel;
  /** 一键跳章的定位锚点（问题首个锚点） */
  jumpTo: NodeRef | null;
}

/** 从统一问题构造仪表盘项（含红黄牌与跳转锚点）。纯函数。 */
export function toDashboardIssue(issue: ConsistencyIssue): DashboardIssue {
  return {
    issue,
    level: toCardLevel(issue.severity),
    jumpTo: issue.anchors[0] ?? null,
  };
}

/**
 * 质量仪表盘聚合 (tasks 2.1, 2.2)。
 * 复用 story-bible 统一一致性问题模型（spec「复用统一一致性问题模型」，不另立结构）。
 */
export interface QualityDashboard {
  /** 健康度评分（可解释） */
  health: HealthScore;
  /** 按 severity 分级的问题列表（红牌在前，供 UI 直接渲染） */
  issues: ReadonlyArray<DashboardIssue>;
}

/** severity 排序权重（critical 最前）。 */
const SEVERITY_ORDER: Readonly<Record<IssueSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** 聚合总检问题为仪表盘（评分 + 按严重度排序的红黄牌列表）。纯函数。 */
export function buildDashboard(
  issues: ReadonlyArray<ConsistencyIssue>,
  weights: HealthScoreWeights = DEFAULT_HEALTH_WEIGHTS,
): QualityDashboard {
  const sorted = [...issues].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return {
    health: computeHealthScore(issues, weights),
    issues: sorted.map(toDashboardIssue),
  };
}

/**
 * 一键修复请求 (task 2.4 / spec「一键修复走局部 diff」)。
 * 修复 MUST 走 surgical-refactor 局部 diff 通道（逐 hunk 接受，MUST NOT 整章覆盖）:
 * 由问题锚点裁出待修片段，连同建议修复构造 RefactorInput 交重构通道。
 * 此处仅声明「一键修复 → 局部 diff 通道」的对接契约，diff/hunk 由 surgical-refactor 负责。
 */
export interface OneClickFixRequest {
  /** 被修复的问题 */
  issue: ConsistencyIssue;
  /** 走 surgical-refactor 的重构输入（局部片段，非整章） */
  refactorInput: RefactorInput;
}

/**
 * 一键修复走局部 diff 原则 (task 2.4)。
 * 一键修复 MUST 经 surgical-refactor 局部 diff 通道，MUST NOT 整章覆盖。此常量为该不变量的显式契约标记。
 */
export const ONE_CLICK_FIX_VIA_LOCAL_DIFF = true as const;
