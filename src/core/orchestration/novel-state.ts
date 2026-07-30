/**
 * 共享状态 NovelState 与 reducer 语义 (agent-orchestration tasks 1.1, 1.2, 1.3)
 *
 * spec: orchestration-state「精确类型的共享状态」「reducer 语义」——
 * 精确类型（禁 any）承载正文上下文/章节标识/对话历史/活跃问题/当前动作/agent 状态；
 * 章节引用复用 story-workspace 稳定标识符；对话历史累加、活跃问题可覆写（见 design D1）。
 *
 * 本文件为类型契约 + 纯 reducer 函数（无 I/O）。以 Annotation.Root 风格的字段+reducer 表达，
 * 但不耦合 LangGraph.js 具体 API（见 design Risks「框架演进」），便于实现层桥接。
 */

import type { NodeRef } from '../manuscript/node-id.js';
import type { ConsistencyIssue } from '../story-bible/consistency-issue.js';
import type { OrchestrationAction, AgentStatus } from './action.js';
import type { WorkflowRef } from '../workflow/types.js';
import type { ContextRefs } from './context-refs.js';

/** 对话历史中的一条消息（messages 风格）。 */
export interface DialogueMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 产生该消息的节点/agent 标识（供追溯，可空） */
  author?: string;
}

/**
 * 共享状态 NovelState：编排图在节点间传递的强类型状态。
 * 事实/素材以引用进入（contextRefs），不塞整库（task 1.4）。
 */
export interface NovelState {
  /** 当前章节/正文位置（复用 story-workspace 稳定标识符） */
  currentChapterId: NodeRef | null;
  /** 当前正文草稿片段 */
  currentDraft: string;
  /** 对话历史（累加 reducer，见 appendDialogue） */
  chatHistory: ReadonlyArray<DialogueMessage>;
  /** 活跃一致性问题（可覆写 reducer，见 overwriteActiveBugs）；复用 story-bible 模型 */
  activeBugs: ReadonlyArray<ConsistencyIssue>;
  /** 当前动作（供 supervisor 路由） */
  currentAction: OrchestrationAction;
  /** agent 运行状态 */
  agentStatus: AgentStatus;
  /** Optional lightweight ownership for a long-running workflow stage. */
  workflowRef?: WorkflowRef;
  /** 事实/素材上下文引用 */
  contextRefs: ContextRefs;
}

/**
 * 对话历史 reducer：累加（task 1.3 / spec「对话历史累加」）。
 * 新消息追加到既有历史尾部，MUST NOT 覆盖既有历史。纯函数。
 */
export function appendDialogue(
  existing: ReadonlyArray<DialogueMessage>,
  incoming: ReadonlyArray<DialogueMessage>,
): ReadonlyArray<DialogueMessage> {
  return [...existing, ...incoming];
}

/**
 * 活跃问题 reducer：可覆写（task 1.3 / spec「活跃问题可覆写」）。
 * 作者对 activeBugs 增删改后，以新列表整体替换，作为后续节点输入。纯函数。
 */
export function overwriteActiveBugs(
  _existing: ReadonlyArray<ConsistencyIssue>,
  incoming: ReadonlyArray<ConsistencyIssue>,
): ReadonlyArray<ConsistencyIssue> {
  return incoming;
}

/**
 * 字段 reducer 声明表：把每个「合并型」字段映射到其 reducer 语义标签。
 * 实现层据此桥接到 LangGraph.js Annotation（append vs overwrite），无需在此耦合框架类型。
 */
export const NOVEL_STATE_REDUCERS = {
  chatHistory: 'append',
  activeBugs: 'overwrite',
} as const;

/** reducer 语义标签。 */
export type ReducerSemantics = (typeof NOVEL_STATE_REDUCERS)[keyof typeof NOVEL_STATE_REDUCERS];
