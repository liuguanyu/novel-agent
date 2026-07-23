/**
 * 关系模型 (story-bible task 1.4)
 *
 * spec: fact-model「关系网」——记录实体间有向/无向关系，且关系可随剧情演变（带时序，见 design D1）。
 *
 * 本文件为类型契约（无 I/O）。
 */

import type { FactStatus } from './fact-status.js';
import type { Provenance } from './provenance.js';
import type { EntityId } from './entity.js';
import type { TimePoint } from './timeline.js';

/** 关系方向性。 */
export type RelationDirectionality = 'directed' | 'undirected';

/**
 * 关系随时序的一个状态切片：某时序点起，关系呈现某种类型。
 * 关系演变以「切片序列」表达（如先「敌对」后「结盟」）。
 */
export interface RelationPhase {
  /** 关系类型（如 'kin'、'hostile'、'superior' 等，自由文本可扩展） */
  kind: string;
  /** 该关系相位生效的起始时序点 */
  since: TimePoint;
  /** 状态 */
  status: FactStatus;
  /** 出处锚点 */
  provenance: Provenance;
}

/** 实体间关系（含随时序演变的相位序列）。 */
export interface Relation {
  /** 关系稳定 id */
  id: string;
  /** 关系源实体 */
  from: EntityId;
  /** 关系目标实体 */
  to: EntityId;
  /** 有向/无向 */
  directionality: RelationDirectionality;
  /**
   * 随时序演变的关系相位（按 since 升序）。
   * 单一恒定关系即长度为 1 的序列。
   */
  phases: ReadonlyArray<RelationPhase>;
}
