/**
 * 事实状态与优先级 (story-bible task 1.7)
 *
 * spec: fact-model「事实状态」——每条事实具状态 confirmed/inferred/conflicting，
 * confirmed 优先级高于 inferred；冲突项被标记以供裁决（见 design D3）。
 *
 * 本文件为类型契约 + 纯优先级 helper（无 I/O）。
 */

/**
 * 事实状态：
 * - `confirmed`：作者确认，最高权威。
 * - `inferred`：AI 抽取推断（自动入库的默认状态）。
 * - `conflicting`：与既有事实冲突，已挂起待作者裁决。
 */
export type FactStatus = 'confirmed' | 'inferred' | 'conflicting';

/** 状态权威优先级（数值越大越权威）。confirmed > inferred；conflicting 表示待裁决。 */
export const FACT_STATUS_PRIORITY: Readonly<Record<FactStatus, number>> = {
  conflicting: 0,
  inferred: 1,
  confirmed: 2,
};

/**
 * 比较两条事实的状态权威：返回 true 表示 a 至少与 b 同等权威。
 * 用于冲突裁决时以 confirmed 事实为更高权威（spec「状态优先级」）。纯函数。
 */
export function isAtLeastAsAuthoritative(a: FactStatus, b: FactStatus): boolean {
  return FACT_STATUS_PRIORITY[a] >= FACT_STATUS_PRIORITY[b];
}

/** 所有事实共有的状态与出处承载基（供实体/属性/关系/伏笔/时间线事件复用）。 */
export interface FactStateBearer {
  /** 当前事实状态 */
  status: FactStatus;
}
