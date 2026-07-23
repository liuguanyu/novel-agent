/**
 * Map-Reduce 总检:Reduce 对撞 + 运行/进程/中断语义 (global-audit tasks 1.2, 1.4)
 *
 * spec: map-reduce-audit——Reduce 阶段跨片对撞检出全局矛盾（时空死锁/伏笔悬空/人设崩塌·弧光断裂/
 * 状态矛盾）;计算在 utilityProcess;总检为离线批处理，可手动触发、可中断，已完成分片结果 SHOULD 可保留
 *（见 design D1、D2、D6）。
 *
 * 本文件为类型契约（无 I/O；Reduce 对撞算法在 utilityProcess 实现层）。
 * 产出问题复用 story-bible 统一一致性问题模型（见 dashboard.ts），此处只定义总检运行编排契约。
 */

import type { SkeletonShard } from './skeleton.js';
import type { ConsistencyIssue } from '../story-bible/consistency-issue.js';
import type { RunId } from '../../shared/ipc/stream-messages.js';

/**
 * 全局矛盾类别 (task 1.2)。语义与 story-bible ConsistencyIssueType 对齐（同构，见 D3），
 * 这里列出总检 Reduce 重点对撞的宏观类别，实际问题仍以 ConsistencyIssue 承载。
 */
export type GlobalConflictKind =
  | 'timeline-deadlock' // 时空死锁（跨章时序不可满足）
  | 'plot-hook-dangling' // 伏笔长期悬空（planted/pending 迟迟未 paid_off）
  | 'character-collapse' // 人设崩塌 / 弧光断裂
  | 'state-contradiction' // 跨章状态矛盾
  | (string & Record<never, never>);

/**
 * 一次总检运行 (task 1.4)。离线批处理，关联 runId（供中断/进度回传）。
 */
export interface AuditRun {
  runId: RunId;
  /** 触发时刻（epoch ms） */
  startedAt: number;
  /** 总检覆盖范围:全书或指定卷/章子集（锚点数组为空表示全书） */
  scopeHint: 'whole-book' | 'partial';
}

/**
 * Reduce 对撞的输入:所有 Map 分片骨架 (task 1.2)。
 * Reduce MUST 跨片对撞，检出的每个矛盾以 ConsistencyIssue 产出（同构，见 dashboard.ts）。
 */
export interface ReduceInput {
  run: AuditRun;
  shards: ReadonlyArray<SkeletonShard>;
}

/**
 * Reduce 对撞结果:检出的全局问题（统一模型）。
 * 空数组表示未检出全局矛盾（骨架自洽）。
 */
export interface ReduceOutput {
  runId: RunId;
  issues: ReadonlyArray<ConsistencyIssue>;
}

/**
 * 总检进程归属声明 (task 1.4 / spec「总检在 utilityProcess」)。
 * Map-Reduce 属 CPU 密集且量大，MUST 在 utilityProcess/worker;结果聚合/评分/跳章编排在 Main。
 */
export const AUDIT_PLACEMENT = {
  /** Map 分片抽取 + Reduce 对撞:CPU 密集、量大 → utilityProcess/worker。 */
  mapReduce: 'utility-process',
  /** 结果聚合、健康度计算、跳章编排:Main。 */
  aggregation: 'main',
} as const;

/**
 * 可中断的离线批处理 (task 1.4 / spec「离线可中断」)。
 * 总检 MUST 可手动触发（不强制嵌入写作流）且可中断（遵循 human-in-the-loop abort 语义）;
 * 中断后已完成分片结果 SHOULD 可保留供查看。此常量为该性质的显式契约标记。
 */
export const AUDIT_IS_INTERRUPTIBLE_OFFLINE = true as const;
