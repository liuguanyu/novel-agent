/**
 * 召唤执行语义 (on-demand-summon tasks 3.1–3.3)
 *
 * spec: summon-modes——召唤=向 agent-orchestration 持久化有状态图注入命令改路由，复用共享状态与
 * checkpointer，MUST NOT 新建一次性图；干完交还控制权（diagnose→END 返回诊断 / mutate→按
 * human-in-the-loop 挂起待逐 hunk 裁决）；diagnose 只读、mutate 走局部 diff、mode 严格分流
 *（见 design D3、D5）。
 *
 * 本文件为类型契约（无 I/O）。诊断复用 story-bible 一致性问题模型；mutate 的 diff 计算属
 * surgical-refactor，此处仅声明「走局部 diff 通道」的契约边界。
 */

import type { SummonCommand } from './summon-command.js';
import type { OrchestrationAction } from '../orchestration/action.js';
import type { NodeName } from '../orchestration/graph-topology.js';
import type { ConsistencyIssue } from '../story-bible/consistency-issue.js';

/**
 * 召唤注入 (task 3.1 / spec「召唤即向持久图注入命令」)。
 * 描述一次召唤如何改变持久化图的下一跳：设置 currentAction 并路由到目标 agent 节点，
 * 复用共享状态与 checkpointer，MUST NOT 新建脱离状态的一次性图。
 */
export interface SummonInjection {
  /** 注入后设置的 currentAction（供 supervisor 路由） */
  action: OrchestrationAction;
  /** 目标专家节点（由 command.agent 解析，对应 graph-topology NodeName） */
  targetNode: NodeName;
}

/**
 * 由召唤命令构造注入 (task 3.1)。纯函数。
 * agent 标识即目标节点名；action 采用「summon:<agent>」约定，使 supervisor 可识别为召唤路由。
 * 不新建图——返回值仅描述对同一持久图的 currentAction/路由改动。
 */
export function toSummonInjection(command: SummonCommand): SummonInjection {
  return {
    action: `summon:${command.agent}`,
    targetNode: command.agent,
  };
}

/**
 * 干完后的控制权交还方式 (task 3.2 / spec「干完交还控制权」)。
 * - `end`：只读诊断完成，走到 END 返回诊断，MUST NOT 自动续跑流水线。
 * - `suspend`：有写入，按 human-in-the-loop 挂起待作者逐 hunk 裁决。
 */
export type HandBackKind = 'end' | 'suspend';

/**
 * 依 mode 决定交还方式 (tasks 3.2, 3.3)。纯函数。
 * diagnose → end（只读、返回诊断）；mutate → suspend（挂起待裁决）。mode 严格分流。
 */
export function handBackFor(command: SummonCommand): HandBackKind {
  return command.mode === 'diagnose' ? 'end' : 'suspend';
}

/**
 * diagnose 执行结果 (task 3.3 / spec「diagnose 只读语义」)。
 * 只读产出结构化诊断（复用 story-bible 一致性问题模型），MUST NOT 修改正文。
 */
export interface DiagnoseResult {
  runId: SummonCommand['runId'];
  /** 结构化诊断（一致性问题列表） */
  issues: ReadonlyArray<ConsistencyIssue>;
}

/**
 * mutate 执行的写入边界 (task 3.3 / spec「mutate 走局部 diff 语义」)。
 * mutate MUST 经 surgical-refactor 的局部 diff 提案通道，逐 hunk 由作者接受/拒绝，
 * MUST NOT 整章覆盖。此处仅声明边界契约；diff 计算与 hunk 结构由 surgical-refactor 定义。
 */
export interface MutateProposalRef {
  runId: SummonCommand['runId'];
  /** 指向 surgical-refactor 产出的局部 diff 提案（其结构由该 change 定义） */
  proposalRef: string;
}

/**
 * mode 严格分流原则 (task 3.3 / spec「mode 严格分流」)。
 * 后端 MUST 据显式 mode 分流至只读或写入路径，diagnose 路径 MUST NOT 具备正文写入能力。
 * 此常量为该不变量的显式契约标记。
 */
export const DIAGNOSE_HAS_NO_WRITE_ACCESS = true as const;
