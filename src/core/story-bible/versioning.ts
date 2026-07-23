/**
 * 事实库版本化与 checkpoint 对齐 (story-bible tasks 2.1–2.4)
 *
 * spec: fact-versioning——增量非覆盖写入 + 版本标记；版本可关联编排 checkpoint 标识
 * 并按其还原一致视图；引入时点可追溯（见 design D4）。
 *
 * 本文件为类型契约（无 I/O）。与 checkpoint 的具体绑定由 agent-orchestration 提供标识对接；
 * 本层仅定义「可关联 checkpoint 标识并按其还原」的松契约。
 */

/** 事实库版本标识（品牌类型）。单向推进，每次增量写入产生新版本。 */
export type FactVersionId = string & { readonly __brand: 'FactVersionId' };

/** 标注已知合法版本 id（纯类型收窄）。 */
export function asFactVersionId(raw: string): FactVersionId {
  return raw as FactVersionId;
}

/**
 * 编排 checkpoint 标识（由 agent-orchestration/human-in-the-loop 提供）。
 * 此处以 opaque string 承载，避免两个子系统硬绑定（见 design D4）。
 */
export type CheckpointId = string & { readonly __brand: 'CheckpointId' };

/** 标注已知合法 checkpoint id（纯类型收窄）。 */
export function asCheckpointId(raw: string): CheckpointId {
  return raw as CheckpointId;
}

/** 一次增量写入涉及的事实种类（用于变更记录归类）。 */
export type FactKind = 'entity' | 'attribute' | 'alias' | 'timeline-event' | 'relation' | 'plot-hook';

/** 增量变更类型：新增或修改（不覆盖历史，MUST NOT 删除既有版本记录）。 */
export type FactChangeOp = 'add' | 'update';

/**
 * 一条增量变更记录（版本历史的最小单元）。
 * 记录「何时（version）、由何来源、对何事实做了何变更」，支持引入时点追溯（task 2.4）。
 */
export interface FactChange {
  /** 本次变更所属版本 */
  version: FactVersionId;
  /** 变更操作 */
  op: FactChangeOp;
  /** 变更的事实种类 */
  kind: FactKind;
  /** 目标事实的 id（实体/关系/伏笔/事件等的稳定 id） */
  targetId: string;
  /** 可选关联的 checkpoint 标识（在某 checkpoint 上下文写入时） */
  checkpoint?: CheckpointId;
}

/**
 * 版本历史条目：把版本按单向推进串起，并携带其变更与 checkpoint 关联。
 */
export interface FactVersionEntry {
  /** 版本标识 */
  id: FactVersionId;
  /** 前驱版本（初始版本为 null） */
  parent: FactVersionId | null;
  /** 关联的 checkpoint（若该版本在某 checkpoint 上下文产生） */
  checkpoint?: CheckpointId;
  /** 本版本包含的增量变更 */
  changes: ReadonlyArray<FactChange>;
}

/**
 * 按 checkpoint 还原视图的查询请求（task 2.3）。
 * 还原结果 MUST NOT 含回滚点之后才引入的事实（见 spec「随回滚还原视图」）。
 */
export interface RestoreViewRequest {
  /** 目标 checkpoint */
  checkpoint: CheckpointId;
}

/** 引入时点查询：某事实由哪个版本/来源首次引入（task 2.4）。 */
export interface IntroductionQuery {
  /** 事实种类 */
  kind: FactKind;
  /** 事实 id */
  targetId: string;
}

/** 引入时点查询结果。 */
export interface IntroductionResult {
  /** 首次引入该事实的版本（不存在则 null） */
  introducedIn: FactVersionId | null;
}
