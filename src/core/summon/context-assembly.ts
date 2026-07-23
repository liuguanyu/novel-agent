/**
 * 上下文自动组装 (on-demand-summon tasks 2.1–2.4)
 *
 * spec: context-assembly——按 agent + scope 自动装配四类来源（作用范围内正文、相关事实、相关素材、
 * 近期对话历史）；MUST 以引用/检索进入、MUST NOT 塞整库；组装策略按 agent 声明、统一组装器执行；
 * CPU 密集组装在 utilityProcess（见 design D4）。
 *
 * 本文件为类型契约（无 I/O）。复用 orchestration 的 ContextRefs/DialogueMessage、
 * corpus 的 CorpusQuery/CorpusRetrievalResult，事实以版本引用进入（不复制 FactView）。
 */

import type { SummonCommand, SummonScope } from './summon-command.js';
import type { FactContextRef, CorpusContextRef } from '../orchestration/context-refs.js';
import type { DialogueMessage } from '../orchestration/novel-state.js';
import type { CorpusQuery, CorpusRetrievalResult } from '../corpus/corpus-retrieval.js';

/**
 * 单个 agent 的上下文组装策略声明 (task 2.3 / spec「组装策略按 agent 声明」)。
 * 以数据/配置声明各来源是否纳入，统一组装器据此执行，MUST NOT 为每个 agent 硬编码分支。
 * 例：审稿官 needFacts=true 重事实对撞；写手 needCorpus=true 重素材与对话指令。
 */
export interface AssemblyStrategy {
  /** 目标 agent 标识（对应召唤命令 agent） */
  agent: string;
  /** 是否纳入作用范围内正文文本 */
  needBodyText: boolean;
  /** 是否纳入相关事实（按作用域/版本引用检索） */
  needFacts: boolean;
  /** 是否纳入相关素材（语义检索） */
  needCorpus: boolean;
  /** 纳入的近期对话历史条数（0 表示不纳入） */
  chatHistoryLimit: number;
}

/**
 * 组装完成的调用上下文 (task 2.1)：四类来源均以引用/检索结果进入（task 2.2）。
 * MUST NOT 含整库拷贝：事实为版本引用、素材为检索命中、正文为作用范围切片、对话为近期切片。
 */
export interface AssembledContext {
  /** 触发本次组装的命令 */
  command: SummonCommand;
  /** 作用范围内正文文本切片（无则 null） */
  bodyText: string | null;
  /** 相关事实的版本引用（不复制 FactView；无则 null） */
  facts: FactContextRef | null;
  /** 相关素材的语义检索结果（不复制整库；无则 null） */
  corpus: CorpusRetrievalResult | null;
  /** 近期对话历史切片（按策略上限截取） */
  chatHistory: ReadonlyArray<DialogueMessage>;
}

/**
 * 组装器需要的检索计划（供实现层据 scope 构造实际检索）。
 * 事实以引用（版本/作用域）进入、素材以 CorpusQuery 语义检索——均非整库（task 2.2）。
 */
export interface AssemblyPlan {
  /** 事实检索的作用域层级（映射自召唤 scope） */
  factScope: SummonScope;
  /** 事实版本引用（进入状态用，见 orchestration context-refs） */
  factRef: FactContextRef | null;
  /** 素材语义检索查询（无则不检索素材） */
  corpusQuery: CorpusQuery | null;
  /** 素材作用域引用 */
  corpusRef: CorpusContextRef | null;
}

/**
 * 组装的进程归属声明 (task 2.4 / spec「组装的进程归属」)。
 * 语义检索/大文本装配等 CPU 密集计算 MUST 在 utilityProcess，主进程事件循环 MUST NOT 阻塞。
 */
export const CONTEXT_ASSEMBLY_PLACEMENT = {
  /** 语义检索/大文本装配：CPU 密集 → utilityProcess/worker。 */
  heavyAssembly: 'utility-process',
  /** 事实/素材/对话的引用拼装（轻量）→ Main。 */
  lightAssembly: 'main',
} as const;

/**
 * 以引用进入原则 (task 2.2)：组装上下文 MUST 以引用/检索结果进入，MUST NOT 复制整库，
 * 对齐 orchestration-state「上下文以引用进入状态」。此常量为该原则的显式契约标记。
 */
export const ASSEMBLY_ENTERS_BY_REFERENCE = true as const;
