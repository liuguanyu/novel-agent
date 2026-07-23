/**
 * 专家工作台活图：静态图数据 + 染色数据模型 (expert-workbench-graph)
 *
 * spec: expert-workbench-graph「编排活图据静态图数据同源渲染」——活图节点/边 MUST 源自与
 * graph-topology（EXPERT_NODES / ACTION_ROUTING）同源派生的数据，MUST NOT 在渲染层另写一份会漂移的清单。
 *
 * 单一事实源守卫：节点集以 EXPERT_NODES 为准派生，专家的 label/category/icon 复用 AGENT_CATALOG——
 * 新增/删除专家而漏登记即经 AGENT_CATALOG 的 Record 穷尽在编译期报错，不与图拓扑漂移。
 *
 * 染色数据模型（WorkbenchNodePhase / WorkbenchActivity / activities 映射）为最终形态：
 * 以「节点 id → 活动态」的 Map 承载，结构上容纳多节点/多跳/循环。本 change 用对话 turns 投影出单跳，
 * 后续 change（graph-stream-tracing）改由逐节点事件灌入同一模型，本文件与画布均无需改动。
 *
 * 本文件为类型契约 + 纯数据 + 纯 helper（无 React、无 lucide、无 I/O、无视觉）。
 */

import { EXPERT_NODES, ACTION_ROUTING, type NodeName } from '../orchestration/graph-topology.js';
import { AGENT_CATALOG, type AgentCategory, type ExpertAgentId } from './agent-catalog.js';

/** supervisor 中心节点标识（与图拓扑入口节点同名）。 */
export const SUPERVISOR_NODE = 'supervisor' as const;

/** 活图节点的类别归属：专家沿用 agent 类别；supervisor 自成一类（中心路由）。 */
export type WorkbenchNodeCategory = AgentCategory | 'supervisor';

/** 活图节点：一个可染色的图元（supervisor 或某专家）。 */
export interface WorkbenchNode {
  /** 节点 id（= graph-topology NodeName；supervisor 为中心节点）。 */
  readonly id: NodeName;
  /** 中文名（画布呈现）。 */
  readonly label: string;
  /** 类别（决定环绕分区；supervisor 居中）。 */
  readonly category: WorkbenchNodeCategory;
  /** lucide 图标名字符串（renderer 经 resolveIcon 映射；core 不依赖组件库）。 */
  readonly icon: string;
}

/** 活图边：supervisor→专家（带触发动作）或专家→supervisor 回边。 */
export interface WorkbenchEdge {
  readonly from: NodeName;
  readonly to: NodeName;
  /** supervisor→专家时的路由动作（回边无）。 */
  readonly action?: string;
}

/** 活图静态拓扑：节点集 + 边集。 */
export interface WorkbenchGraph {
  readonly nodes: ReadonlyArray<WorkbenchNode>;
  readonly edges: ReadonlyArray<WorkbenchEdge>;
}

/** supervisor 中心节点（自定图标；不在 agent 目录中）。 */
const SUPERVISOR_GRAPH_NODE: WorkbenchNode = {
  id: SUPERVISOR_NODE,
  label: '调度中枢',
  category: 'supervisor',
  icon: 'Workflow',
};

/** 专家节点：复用 agent 目录的 label/category/icon（单一事实源，漏登记即编译期报错）。 */
const EXPERT_GRAPH_NODES: ReadonlyArray<WorkbenchNode> = EXPERT_NODES.map((id: ExpertAgentId) => {
  const entry = AGENT_CATALOG[id];
  return { id, label: entry.label, category: entry.category, icon: entry.icon };
});

/** 反向：动作路由表给出 supervisor→专家 的边（带 action）；每个专家再给一条 →supervisor 回边。 */
const ROUTING_EDGES: ReadonlyArray<WorkbenchEdge> = Object.entries(ACTION_ROUTING).flatMap(
  ([action, node]) => [
    { from: SUPERVISOR_NODE, to: node, action },
    { from: node, to: SUPERVISOR_NODE },
  ],
);

/**
 * 专家工作台活图（唯一图数据源）：supervisor 居中 + 全部专家节点 + 路由边/回边。
 * 与 graph-topology 同源派生，供画布布局与染色；后续 change 复用不变。
 */
export const WORKBENCH_GRAPH: WorkbenchGraph = {
  nodes: [SUPERVISOR_GRAPH_NODE, ...EXPERT_GRAPH_NODES],
  edges: ROUTING_EDGES,
};

/** 节点活动态：空闲 / 运行中 / 完成 / 出错 / 待裁决。 */
export type WorkbenchNodePhase = 'idle' | 'running' | 'done' | 'error' | 'awaiting';

/** 单个节点的活动态（含所属运行）。 */
export interface WorkbenchActivity {
  readonly phase: WorkbenchNodePhase;
  readonly runId: string;
}

/**
 * 活动态映射：节点 id → 活动态。最终形态数据模型。
 * 结构上容纳多个节点同时具态（多跳/循环），MUST NOT 退化为「当前唯一节点」单值。
 */
export type WorkbenchActivities = ReadonlyMap<NodeName, WorkbenchActivity>;
