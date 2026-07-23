/**
 * 事实库 SQLite 存储契约 (story-bible task 1.8)
 *
 * spec: fact-model「…」承载 + design：SQLite 承载实体/属性/时间线/关系/伏笔；
 * 读写为异步 I/O，归 Main（见 docs/conventions.md §3 工作负载归属）。
 *
 * 本文件仅定义存储层「对上层暴露的异步契约接口」（无实现、无 sqlite import）。
 * 具体驱动与 SQL 由 main 侧实现层完成；core 只声明契约，保持进程无关。
 */

import type { Entity, EntityId } from './entity.js';
import type { Timeline } from './timeline.js';
import type { Relation } from './relation.js';
import type { PlotHook } from './plot-hook.js';
import type { FactVersionId } from './versioning.js';

/**
 * 某版本/checkpoint 下的一致事实视图（只读快照）。
 * 供正向/反向检查读取，不掺入其他版本中间状态（见 fact-versioning「一致性视图查询」）。
 */
export interface FactView {
  /** 该视图对应的事实库版本 */
  version: FactVersionId;
  /** 实体全集 */
  entities: ReadonlyArray<Entity>;
  /** 时间线 */
  timeline: Timeline;
  /** 关系全集 */
  relations: ReadonlyArray<Relation>;
  /** 伏笔全集 */
  plotHooks: ReadonlyArray<PlotHook>;
}

/**
 * 事实库存储的异步读契约（Main 侧实现，异步 I/O）。
 * 仅声明签名类型——core 层不含实现。
 */
export interface FactStoreReader {
  /** 读取给定版本的一致事实视图 */
  readonly getView: (version: FactVersionId) => Promise<FactView>;
  /** 按 id 读取单个实体（不存在则 null） */
  readonly getEntity: (version: FactVersionId, id: EntityId) => Promise<Entity | null>;
}
