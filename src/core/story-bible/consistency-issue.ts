/**
 * 统一一致性问题模型 (story-bible task 4.1, 4.6)
 *
 * spec: consistency-check「统一一致性问题模型」——每个问题含
 * type / severity / anchors(1+) / description / suggestedFix(可空) / requiresHumanDecision；
 * requiresHumanDecision=true 时 MUST 附选项，系统 MUST NOT 代作者选择（见 design D8）。
 *
 * 该模型是 agent-orchestration / on-demand-summon / global-audit 共用的输出契约。
 * 本文件为类型契约（无 I/O）。
 */

import type { NodeRef } from '../manuscript/node-id.js';

/**
 * 一致性问题类型。预置常见类别，`(string & {})` 允许扩展（「其他」亦可细化）。
 */
export type ConsistencyIssueType =
  | 'naming-conflict' // 命名/称呼冲突（集合外称呼）
  | 'timeline-break' // 时间线断层
  | 'behavior-ooc' // 行为 OOC
  | 'plot-hook-dangling' // 伏笔悬空
  | 'state-contradiction' // 状态矛盾（物品/信息持有者错误）
  | 'spatial-inconsistency' // 空间走位矛盾
  | 'other'
  | (string & Record<never, never>);

/** 严重度。 */
export type IssueSeverity = 'critical' | 'warning' | 'info';

/**
 * 需人工决策时附带的选项（如反向冲突的「改设定 / 改旧文」）。
 * 系统仅呈现选项，由作者裁决（spec「需人工决策附选项」）。
 */
export interface DecisionOption {
  /** 选项标识 */
  id: string;
  /** 选项文案（如「修改设定以匹配旧文」） */
  label: string;
}

/**
 * 问题证据片段：在 chapter/scene 锚点之内进一步帮助定位原文。
 *
 * 第一阶段不强求 offset（Markdown 编辑、章节重排会让 offset 脆弱），先以短 quote 做 quote-based 定位；
 * 后续可叠加 startOffset/endOffset 或 paragraph id。
 */
export interface IssueEvidence {
  /** 原文短引文（用于 UI 展示、editor agent 定位修改点） */
  quote: string;
  /** 可选上下文前缀 */
  before?: string;
  /** 可选上下文后缀 */
  after?: string;
}

/**
 * 统一一致性问题。所有检查（正向/反向/伏笔）产出此结构。
 */
export interface ConsistencyIssue {
  /** 问题类型 */
  type: ConsistencyIssueType;
  /** 严重度 */
  severity: IssueSeverity;
  /** 一个或多个稳定标识符锚点（反向冲突含新事实与旧文双锚点） */
  anchors: ReadonlyArray<NodeRef>;
  /** 问题描述 */
  description: string;
  /** 建议修复（可空） */
  suggestedFix?: string;
  /** 原文证据片段（可空；比章节锚点更细，但不替代 NodeRef） */
  evidence?: IssueEvidence;
  /** 是否需人工决策 */
  requiresHumanDecision: boolean;
  /** 需人工决策时的可选项（requiresHumanDecision=true 时 MUST 非空） */
  options?: ReadonlyArray<DecisionOption>;
}
