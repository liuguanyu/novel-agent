/**
 * 正向 / 反向 / 悬空伏笔一致性检查契约 (story-bible tasks 4.2, 4.3, 4.5)
 *
 * spec: consistency-check——
 * 正向检查：新文 × 库视图 → 问题列表（称呼/时间线/OOC/状态等，task 4.2）。
 * 反向检查：事实变更 → 候选章节检索 → 比对 → 双锚点问题（含 requiresHumanDecision，task 4.3）。
 * 悬空伏笔：基于状态机检出长期 pending 未回收（task 4.5）。
 * 大规模比对归 utilityProcess（见 consistency-worker-task.ts，task 4.4）。
 *
 * 本文件为类型契约（无 I/O；执行检查的 agent 由 agent-orchestration 装配）。
 */

import type { NodeRef } from '../manuscript/node-id.js';
import type { FactView } from './fact-store.js';
import type { ConsistencyIssue } from './consistency-issue.js';
import type { FactKind } from './versioning.js';

/**
 * 正向检查输入 (task 4.2)：一段（新）正文 + 其锚点 + 事实库当前视图。
 */
export interface ForwardCheckInput {
  /** 待检正文锚点 */
  location: NodeRef;
  /** 待检正文文本 */
  text: string;
  /** 对撞用的事实库视图（某版本下的一致快照） */
  view: FactView;
}

/** 正向检查输出：结构化问题列表。 */
export interface ForwardCheckOutput {
  issues: ReadonlyArray<ConsistencyIssue>;
}

/**
 * 反向检查触发 (task 4.3)：描述一次事实变更。
 * 变更后需检索所有引用相关实体/属性的已有章节并逐一比对。
 */
export interface FactChangeTrigger {
  /** 变更的事实种类 */
  kind: FactKind;
  /** 变更的事实 id（如被改属性所属实体 id） */
  targetId: string;
  /** 新事实来源锚点（反向冲突问题的「新事实」侧锚点） */
  newFactAnchor: NodeRef;
}

/**
 * 反向检查输入：变更触发 + 候选已有章节锚点集合（由锚点/语义检索缩小的候选集）。
 * 候选集缩小策略在实现层完成；本契约接收候选并对撞。
 */
export interface ReverseCheckInput {
  trigger: FactChangeTrigger;
  /** 待比对的候选章节锚点 */
  candidateLocations: ReadonlyArray<NodeRef>;
  /** 变更后的事实库视图 */
  view: FactView;
}

/**
 * 反向检查输出：每个问题含「新事实」与「冲突旧文」双锚点，且 requiresHumanDecision=true
 *（附「改设定 / 改旧文」选项，见 spec「冲突报告含双锚点」）。
 */
export interface ReverseCheckOutput {
  issues: ReadonlyArray<ConsistencyIssue>;
}

/**
 * 悬空伏笔检查输入 (task 4.5)：事实库视图 + 当前进度锚点（用于判定「相当篇幅内未回收」）。
 */
export interface DanglingHookCheckInput {
  view: FactView;
  /** 当前叙事进度锚点（据此判断 pending 是否已悬空过久） */
  currentLocation: NodeRef;
}

/** 悬空伏笔检查输出：伏笔悬空问题（锚定埋设位置）。 */
export interface DanglingHookCheckOutput {
  issues: ReadonlyArray<ConsistencyIssue>;
}
