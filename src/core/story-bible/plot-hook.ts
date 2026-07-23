/**
 * 伏笔状态机 (story-bible task 1.5)
 *
 * spec: fact-model「伏笔状态机」——显式状态机跟踪伏笔：
 * planted（埋设）→ pending（待回收）→ paid_off（已回收），并支持 abandoned（作废）；
 * 状态供「悬空伏笔」检查（长期 pending 未回收，见 design D1、consistency-check）。
 *
 * 本文件为类型契约 + 纯状态流转合法性 helper（无 I/O）。
 */

import type { FactStatus } from './fact-status.js';
import type { Provenance } from './provenance.js';
import type { NodeRef } from '../manuscript/node-id.js';

/** 伏笔状态。 */
export type PlotHookState = 'planted' | 'pending' | 'paid_off' | 'abandoned';

/** 合法状态流转表（纯数据）：从某状态可流转到的目标状态集合。 */
export const PLOT_HOOK_TRANSITIONS: Readonly<Record<PlotHookState, ReadonlyArray<PlotHookState>>> = {
  planted: ['pending', 'paid_off', 'abandoned'],
  pending: ['paid_off', 'abandoned'],
  paid_off: [],
  abandoned: [],
};

/** 判断一次状态流转是否合法（纯函数）。 */
export function canTransition(from: PlotHookState, to: PlotHookState): boolean {
  return PLOT_HOOK_TRANSITIONS[from].includes(to);
}

/** 是否为「悬而未决」状态（planted/pending）——悬空伏笔检查的候选集。 */
export function isOutstanding(state: PlotHookState): boolean {
  return state === 'planted' || state === 'pending';
}

/** 伏笔事实。 */
export interface PlotHook {
  /** 伏笔稳定 id */
  id: string;
  /** 伏笔描述（如「接头暗号」） */
  description: string;
  /** 当前状态 */
  state: PlotHookState;
  /** 埋设位置锚点（悬空伏笔问题锚定于此） */
  plantedAt: NodeRef;
  /** 回收位置锚点（paid_off 时存在） */
  paidOffAt?: NodeRef;
  /** 事实状态 */
  status: FactStatus;
  /** 出处锚点 */
  provenance: Provenance;
}
