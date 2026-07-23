/**
 * 时间线模型 (story-bible task 1.3)
 *
 * spec: fact-model「时间线」——单向自增的故事内时序；事件可挂接到时序点；
 * 提供足以判定先后与间隔的信息，用于时序矛盾检查（如「7 天断流」「枪伤后立即健步如飞」，见 design D1）。
 *
 * 本文件为类型契约 + 纯序判定 helper（无 I/O）。
 */

import type { FactStatus } from './fact-status.js';
import type { Provenance } from './provenance.js';
import type { EntityId } from './entity.js';

/**
 * 故事内时序点：单向自增的逻辑刻度（非现实日期，而是叙事时间轴上的位置）。
 * `tick` 单向自增，越大越晚；`label` 为可读描述（如「枪伤当日」）。
 */
export interface TimePoint {
  /** 单向自增时序刻度（用于先后判定） */
  tick: number;
  /** 可读时序标签 */
  label: string;
}

/**
 * 挂接到时间线的事件。
 * `durationTicks` 可选，表示事件跨度，用于「间隔」判定（如「过去七天」）。
 */
export interface TimelineEvent {
  /** 事件稳定 id */
  id: string;
  /** 事件描述（如「受枪伤」「码头交易」） */
  description: string;
  /** 挂接的时序点 */
  at: TimePoint;
  /** 事件跨度（时序刻度数）；瞬时事件可省略 */
  durationTicks?: number;
  /** 相关实体（如受伤者），供检查关联 */
  relatedEntities: ReadonlyArray<EntityId>;
  /** 状态 */
  status: FactStatus;
  /** 出处锚点 */
  provenance: Provenance;
}

/** 一本书的时间线：按 tick 有序的事件序列。 */
export interface Timeline {
  events: ReadonlyArray<TimelineEvent>;
}

/**
 * 判定两个时序点的先后：负数 a 早于 b，正数 a 晚于 b，0 同刻。纯函数。
 * 供时间线断层检查判定先后。
 */
export function compareTimePoints(a: TimePoint, b: TimePoint): number {
  return a.tick - b.tick;
}

/** 计算两个时序点的间隔刻度（绝对值）。供「间隔」矛盾判定。纯函数。 */
export function intervalTicks(a: TimePoint, b: TimePoint): number {
  return Math.abs(a.tick - b.tick);
}
