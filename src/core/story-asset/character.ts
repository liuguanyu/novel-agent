/**
 * 故事资产 — 人物模型 (Roadmap §3.2)
 *
 * 人物资产从旧稿正文中提炼，包含身份、性格、动机、关系和成长弧。
 * 每条结论都带可信度和证据，未采纳的推断不能升级为既定事实。
 */

import type { AssetStatus, CredibleClaim } from './credibility.js';

/** 人物档案 */
export interface CharacterProfile {
  /** 稳定标识符 */
  readonly id: string;
  /** 主要名称 */
  readonly name: string;
  /** 别名/绰号 */
  readonly aliases: ReadonlyArray<string>;
  /** 身份、经历 */
  readonly identity: CredibleClaim<string>;
  /** 外貌 */
  readonly appearance: CredibleClaim<string>;
  /** 能力和知识边界 */
  readonly abilities: CredibleClaim<string>;
  /** 核心性格、外在特点 */
  readonly personality: CredibleClaim<string>;
  /** 语言与行为习惯 */
  readonly languageStyle: CredibleClaim<string>;
  /** 欲望 */
  readonly desire: CredibleClaim<string>;
  /** 目标 */
  readonly goal: CredibleClaim<string>;
  /** 恐惧 */
  readonly fear: CredibleClaim<string>;
  /** 弱点和底线 */
  readonly weakness: CredibleClaim<string>;
  /** 已发生的重要事件及当前状态 */
  readonly currentStatus: CredibleClaim<string>;
  /** 所属情节线 ID 列表 */
  readonly plotThreadIds: ReadonlyArray<string>;
  /** 承担的叙事功能 */
  readonly narrativeFunction?: CredibleClaim<string>;
  /** 资产状态 */
  readonly status: AssetStatus;
}

/** 人物关系类型 */
export type CharacterRelationKind =
  | 'ally'        // 盟友
  | 'enemy'       // 敌对
  | 'mentor'      // 师徒
  | 'lover'       // 恋人
  | 'family'      // 家人
  | 'colleague'   // 同事
  | 'rival'       // 竞争
  | 'other';

/** 人物关系 */
export interface CharacterRelation {
  readonly id: string;
  /** 关系的一方 */
  readonly fromCharacterId: string;
  /** 关系的另一方 */
  readonly toCharacterId: string;
  /** 关系类型 */
  readonly kind: CharacterRelationKind;
  /** 关系描述 */
  readonly description: CredibleClaim<string>;
  /** 关系变化记录（在哪些情节节点发生了变化） */
  readonly changes: ReadonlyArray<{
    readonly plotNodeId: string;
    readonly description: string;
  }>;
  /** 资产状态 */
  readonly status: AssetStatus;
}

/** 人物成长弧 */
export interface CharacterArc {
  readonly id: string;
  /** 关联人物 */
  readonly characterId: string;
  /** 成长弧描述 */
  readonly description: string;
  /** 关键转折点 */
  readonly turningPoints: ReadonlyArray<{
    readonly plotNodeId: string;
    readonly description: string;
  }>;
  /** 起点状态描述 */
  readonly startState?: string;
  /** 终点状态描述 */
  readonly endState?: string;
  /** 资产状态 */
  readonly status: AssetStatus;
}
