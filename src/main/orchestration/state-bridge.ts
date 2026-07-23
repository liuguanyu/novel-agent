/**
 * NovelState ↔ LangGraph 状态桥接 (orchestration-runtime tasks 1.2, 1.3)
 *
 * spec: orchestration-state「共享状态驱动运行时图」——core 的 NovelState / reducer 语义
 * MUST 桥接到 LangGraph Annotation，且 core 契约 MUST NOT 耦合框架类型（见 design D1）。
 *
 * 本文件是唯一允许同时 import core NovelState 与 @langchain/langgraph 的桥；
 * 图的其余部分只经此处的 NovelStateAnnotation / NovelStateType 消费状态，不再直接碰框架 reducer。
 *
 * reducer 语义单一事实来源是 core 的 NOVEL_STATE_REDUCERS（append / overwrite）：
 *  - append   → 累加合并（chatHistory）
 *  - overwrite→ 整体替换（activeBugs）
 *  - 其余标量字段 → LastValue（最近值覆盖，Annotation 默认）
 * 若 core 新增 reducer 标签而此处未覆盖，assertExhaustive 在编译期报错，防止语义漂移。
 */

import { Annotation } from '@langchain/langgraph';
import type { NodeRef } from '../../core/manuscript/node-id.js';
import type { ConsistencyIssue } from '../../core/story-bible/index.js';
import {
  appendDialogue,
  overwriteActiveBugs,
  NOVEL_STATE_REDUCERS,
  type DialogueMessage,
  type NovelState,
} from '../../core/orchestration/index.js';
import type { OrchestrationAction, AgentStatus } from '../../core/orchestration/index.js';
import type { ContextRefs } from '../../core/orchestration/index.js';

/** 编译期穷尽性守卫：确保每个 reducer 语义标签都被桥接覆盖。 */
function assertExhaustive(value: never): never {
  throw new Error(`未覆盖的 reducer 语义标签: ${String(value)}`);
}

// 触发穷尽性检查：NOVEL_STATE_REDUCERS 的每个值都必须在下方 Annotation 中有对应实现。
// 新增标签时此处会因缺分支而编译失败，提醒同步桥接。
for (const semantics of Object.values(NOVEL_STATE_REDUCERS)) {
  switch (semantics) {
    case 'append':
    case 'overwrite':
      break;
    default:
      assertExhaustive(semantics);
  }
}

/**
 * LangGraph 状态定义：逐字段映射 NovelState。
 * 合并型字段（chatHistory/activeBugs）复用 core 纯函数 reducer，保证与 core 语义一字不差；
 * 标量字段用带 default 的 Annotation（LastValue 覆盖语义）。
 */
export const NovelStateAnnotation = Annotation.Root({
  currentChapterId: Annotation<NodeRef | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  currentDraft: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  chatHistory: Annotation<ReadonlyArray<DialogueMessage>, ReadonlyArray<DialogueMessage>>({
    reducer: (prev, next) => appendDialogue(prev, next),
    default: () => [],
  }),
  activeBugs: Annotation<ReadonlyArray<ConsistencyIssue>, ReadonlyArray<ConsistencyIssue>>({
    reducer: (prev, next) => overwriteActiveBugs(prev, next),
    default: () => [],
  }),
  currentAction: Annotation<OrchestrationAction>({
    reducer: (_prev, next) => next,
    default: () => 'idle',
  }),
  agentStatus: Annotation<AgentStatus>({
    reducer: (_prev, next) => next,
    default: () => 'idle',
  }),
  contextRefs: Annotation<ContextRefs>({
    reducer: (_prev, next) => next,
    default: () => ({ facts: null, corpus: null }),
  }),
});

/** LangGraph 视角的状态类型（结构与 core NovelState 对齐）。 */
export type NovelStateType = typeof NovelStateAnnotation.State;

/**
 * 把 LangGraph 运行态收敛回 core NovelState（供 checkpointer 序列化 / 上层消费）。
 * 结构本已对齐，此函数在类型层锁定二者一致，任一侧漂移即编译失败。
 */
export function toNovelState(state: NovelStateType): NovelState {
  return {
    currentChapterId: state.currentChapterId,
    currentDraft: state.currentDraft,
    chatHistory: state.chatHistory,
    activeBugs: state.activeBugs,
    currentAction: state.currentAction,
    agentStatus: state.agentStatus,
    contextRefs: state.contextRefs,
  };
}
