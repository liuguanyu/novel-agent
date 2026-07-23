/**
 * Map 阶段骨架抽取 (global-audit task 1.1)
 *
 * spec: map-reduce-audit「Map 抽取骨架」——Map 阶段 MUST 从事实库按章/实体分片抽取骨架:
 * 实体状态时间线、伏笔状态机、人设特征弧光;总检 MUST 只对撞结构化骨架，MUST NOT 逐字重读正文水字
 *（见 design D1）。
 *
 * 本文件为类型契约（无 I/O）。骨架**复用 story-bible 既有结构**（TimelineEvent/PlotHook/Entity），
 * 不另立模型——总检只是批量重放对撞，与增量落盘同源（见 design Risks「骨架抽取不全」）。
 */

import type { NodeRef } from '../manuscript/node-id.js';
import type { EntityId } from '../story-bible/entity.js';
import type { TimelineEvent } from '../story-bible/timeline.js';
import type { PlotHook } from '../story-bible/plot-hook.js';

/** 分片键:按章或按实体切分 Map 单元（见 design D1「按章/实体分片」）。 */
export type ShardKey =
  | { by: 'chapter'; node: NodeRef }
  | { by: 'entity'; entity: EntityId };

/**
 * 人设特征弧光的一个采样点:某实体在某章呈现的关键特征快照。
 * 用于 Reduce 检出「人设崩塌/弧光断裂」（中段人设悄悄崩了）。
 */
export interface CharacterArcPoint {
  /** 实体 */
  entity: EntityId;
  /** 采样所在章节锚点 */
  at: NodeRef;
  /** 该处呈现的关键人设特征（如「重信义」「怕水」），键值对 */
  traits: Readonly<Record<string, string>>;
}

/**
 * 一个 Map 分片的骨架产出 (task 1.1)。
 * 只含结构化骨架（时间线事件 / 伏笔状态 / 人设采样），不含正文水字（spec「只对撞骨架不读水字」）。
 */
export interface SkeletonShard {
  /** 分片键 */
  key: ShardKey;
  /** 该片内的实体状态时间线事件 */
  timelineEvents: ReadonlyArray<TimelineEvent>;
  /** 该片内的伏笔状态 */
  plotHooks: ReadonlyArray<PlotHook>;
  /** 该片内的人设特征弧光采样 */
  arcPoints: ReadonlyArray<CharacterArcPoint>;
}

/**
 * 只对撞骨架原则 (task 1.3 / spec「只对撞骨架不读水字」)。
 * 总检对撞对象 MUST 是事实库结构化骨架，MUST NOT 逐字重读全部正文;
 * 宏观语义检查 MAY 检索向量库辅助，但仍以骨架为主。此常量为该不变量的显式契约标记。
 */
export const AUDIT_COLLIDES_SKELETON_NOT_PROSE = true as const;
