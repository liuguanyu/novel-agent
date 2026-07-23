/**
 * 图拓扑：supervisor 路由 + 专家节点 + 循环 (agent-orchestration tasks 2.1–2.5)
 *
 * spec: orchestration-graph——supervisor 入口按 currentAction 路由到专家节点（可扩展）；
 * 支持条件路由与写-审-改循环及终止；单一有状态图（召唤只改下一跳，不新建单发图）；
 * 图与节点执行归 Main 或 utilityProcess，绝不在 Renderer（见 design D2）。
 *
 * 本文件为类型契约 + 纯路由/终止判定 helper（无 I/O；不耦合 LangGraph.js 具体 API）。
 */

import type { NovelState } from './novel-state.js';
import type { OrchestrationAction } from './action.js';

/**
 * 专家节点标识（借鉴 LibriScribe 分工，可扩展）。
 * `supervisor` 为入口路由节点（对应 LibriScribe 的 project_manager）。
 */
export type NodeName =
  | 'supervisor'
  | 'writer'
  | 'scene-generator'
  | 'reviewer'
  | 'fact-checker'
  | 'plagiarism-checker'
  | 'editor'
  | 'style-editor'
  | 'architect'
  | 'character-generator'
  | 'worldbuilding'
  | 'concept-generator'
  | 'scene-outliner'
  | 'researcher'
  | (string & Record<never, never>);

/** 专家节点清单（task 2.2；不含 supervisor 自身）。可在实现层扩展。 */
export const EXPERT_NODES = [
  'writer',
  'scene-generator',
  'reviewer',
  'fact-checker',
  'plagiarism-checker',
  'editor',
  'style-editor',
  'architect',
  'character-generator',
  'worldbuilding',
  'concept-generator',
  'scene-outliner',
  'researcher',
] as const;

/**
 * supervisor 路由表 (task 2.1)：currentAction → 目标专家节点。
 * 纯数据映射；实现层据此配置 addConditionalEdges。
 */
export const ACTION_ROUTING: Readonly<Record<string, NodeName>> = {
  write: 'writer',
  'generate-scene': 'scene-generator',
  review: 'reviewer',
  'fact-check': 'fact-checker',
  'plagiarism-check': 'plagiarism-checker',
  edit: 'editor',
  restyle: 'style-editor',
  outline: 'architect',
  'generate-characters': 'character-generator',
  'build-world': 'worldbuilding',
  'generate-concept': 'concept-generator',
  'outline-scenes': 'scene-outliner',
  research: 'researcher',
};

/** 图的终止哨兵：路由到此表示本次运行结束。 */
export const END_NODE = '__end__' as const;
export type EndNode = typeof END_NODE;

/**
 * supervisor 路由决策 (task 2.1)：依据 currentAction 选择下一跳。纯函数。
 * 未知/idle 动作路由到 END（无事可做），由上层注入命令改变 currentAction 再次进入。
 */
export function routeByAction(action: OrchestrationAction): NodeName | EndNode {
  const target = ACTION_ROUTING[action];
  return target ?? END_NODE;
}

/**
 * agent → 动作反向投影 (I9 阶段 A)：被召唤的专家 agent 对应的 currentAction。
 * 由 ACTION_ROUTING 反转得到——路由表是唯一事实源，二者 MUST NOT 各写一份而漂移。
 * 供运行层把 SummonCommand.agent 投影为 currentAction，使 supervisor 能路由到该专家节点。
 */
export const AGENT_TO_ACTION: Readonly<Record<string, OrchestrationAction>> = Object.freeze(
  Object.fromEntries(
    Object.entries(ACTION_ROUTING).map(([action, node]) => [node as string, action]),
  ),
);

/**
 * 把被召唤的 agent 投影为 currentAction (I9 阶段 A)。纯函数。
 * agent 有专属动作时返回该动作；否则返回 undefined，由调用方回退到按 mode 推导，
 * MUST NOT 静默丢弃 agent 意图。
 */
export function actionForAgent(agent: string): OrchestrationAction | undefined {
  return AGENT_TO_ACTION[agent];
}

/**
 * 写-审-改循环的终止判定 (task 2.3)。纯函数。
 * 终止条件：无活跃问题（审干净）或达到最大迭代轮次或被人工暂停。
 * MUST 可在满足条件或人工介入时终止（spec「循环可终止」）。
 */
export interface ReviewLoopControl {
  /** 已进行的写-审-改轮次 */
  iteration: number;
  /** 允许的最大轮次（防死循环） */
  maxIterations: number;
}

/** 判断写-审-改循环是否应终止。纯函数。 */
export function shouldStopReviewLoop(state: NovelState, control: ReviewLoopControl): boolean {
  if (state.agentStatus === 'paused_by_user') return true;
  if (control.iteration >= control.maxIterations) return true;
  return state.activeBugs.length === 0;
}

/**
 * 单一有状态图原则 (task 2.4)：
 * 召唤等操作通过向同一张持久化图注入命令（改变 currentAction 从而改变下一跳路由）实现，
 * MUST NOT 新建脱离共享状态与 checkpointer 的一次性图（见 spec「单一有状态图」）。
 * 此常量作为该原则的显式契约标记，供实现层与 on-demand-summon 引用。
 */
export const SINGLE_STATEFUL_GRAPH = true as const;
