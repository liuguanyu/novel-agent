/**
 * 实体模型、属性与称呼别名 (story-bible tasks 1.1, 1.2)
 *
 * spec: fact-model「实体模型」「属性与称呼别名」——
 * 类型化实体（人物/地点/物品/组织，可扩展）+ 稳定 id + 规范名；
 * 隶属实体的键值属性；称呼别名以「合法称呼集合」维护，供检查判定集合外称呼（见 design D1）。
 *
 * 本文件为类型契约 + Zod schema（无 I/O）。
 */

import { z } from 'zod';
import type { FactStatus } from './fact-status.js';
import type { Provenance } from './provenance.js';

/** 实体稳定唯一 id（品牌类型，避免与普通 string 混用）。 */
export type EntityId = string & { readonly __brand: 'EntityId' };

/** 标注已知合法 id（纯类型收窄）。 */
export function asEntityId(raw: string): EntityId {
  return raw as EntityId;
}

/**
 * 实体类型：预置常见类别，`(string & {})` 允许扩展而不破坏既有数据（spec「类型可扩展」）。
 */
export type EntityType =
  | 'person'
  | 'place'
  | 'item'
  | 'organization'
  | 'other'
  | (string & Record<never, never>);

/**
 * 一条隶属实体的键值属性事实（性格/能力/习惯/外貌等）。
 * 每条属性独立携带状态与出处，可被单独裁决/溯源。
 */
export interface EntityAttribute {
  /** 属性键（如 'handedness'、'personality'） */
  key: string;
  /** 属性值（如 'left'、'沉默寡言'） */
  value: string;
  /** 该属性事实的状态 */
  status: FactStatus;
  /** 出处锚点 */
  provenance: Provenance;
}

/**
 * 称呼别名集合：某实体的合法称呼全集（如「顾长风/顾兄弟/姑爷」）。
 * 一致性检查据此判定「集合外称呼」（如「九爷」）是否为疑似未声明符号（spec「称呼别名集合」）。
 */
export interface AliasSet {
  /** 合法称呼集合（含规范名与别名） */
  aliases: ReadonlyArray<string>;
  /** 该别名集合的状态 */
  status: FactStatus;
  /** 出处锚点 */
  provenance: Provenance;
}

/** 类型化实体。 */
export interface Entity {
  /** 稳定唯一 id（与规范名/别名解耦，重命名不改 id） */
  id: EntityId;
  /** 实体类型（可扩展） */
  type: EntityType;
  /** 规范名（首选显示名） */
  canonicalName: string;
  /** 合法称呼集合 */
  aliasSet: AliasSet;
  /** 属性事实列表 */
  attributes: ReadonlyArray<EntityAttribute>;
  /** 实体自身的状态（如首次出现自动入库为 inferred） */
  status: FactStatus;
  /** 实体首次登记的出处 */
  provenance: Provenance;
}

/** 判断某称呼是否落在实体合法称呼集合内（纯函数，供正向检查复用）。 */
export function isKnownAlias(aliasSet: AliasSet, appellation: string): boolean {
  return aliasSet.aliases.includes(appellation);
}

/** 实体类型 Zod schema（校验抽取产物；不白名单，允许扩展类型）。 */
export const entityTypeSchema = z.string().min(1);
