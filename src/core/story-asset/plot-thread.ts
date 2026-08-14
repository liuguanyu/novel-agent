/**
 * 故事资产 — 情节线模型 (Roadmap §3.1)
 *
 * 情节线是从旧稿情节候选中聚合而来的高层故事结构。
 * 一条情节线贯穿多个情节节点，有自己的目标、阶段和涉及人物。
 */

import type { AssetStatus, CredibleClaim, Evidence } from './credibility.js';

/** 情节线类型 */
export type PlotThreadKind = 'main' | 'sub';

/** 情节线阶段（叙事结构位置） */
export type PlotThreadStageKind =
  | 'setup'      // 起点/铺垫
  | 'rising'     // 发展/推进
  | 'turn'       // 转折
  | 'climax'     // 高潮
  | 'resolution'; // 收束

/** 伏笔状态 */
export type ForeshadowingState = 'planted' | 'advanced' | 'paid-off' | 'abandoned';

/** 情节线的一个阶段 */
export interface PlotThreadStage {
  /** 阶段类型 */
  readonly kind: PlotThreadStageKind;
  /** 关联的情节节点 ID（来自旧稿大纲） */
  readonly plotNodeIds: ReadonlyArray<string>;
  /** 阶段描述 */
  readonly description: string;
}

/** 伏笔 */
export interface Foreshadowing {
  readonly id: string;
  /** 伏笔描述 */
  readonly description: string;
  /** 当前状态 */
  readonly state: ForeshadowingState;
  /** 埋设位置的情节节点 ID */
  readonly plantedPlotNodeId: string;
  /** 回收位置的情节节点 ID（已回收时存在） */
  readonly paidOffPlotNodeId?: string;
  /** 推进位置的情节节点 ID 列表 */
  readonly advancedPlotNodeIds: ReadonlyArray<string>;
  /** 可信度 */
  readonly credibility: CredibleClaim<string>['credibility'];
  /** 证据 */
  readonly evidence: ReadonlyArray<Evidence>;
  /** 资产状态；与其他故事资产统一经过草案、确认、正式三态。 */
  readonly status: AssetStatus;
}

/** 情节线 */
export interface PlotThread {
  /** 稳定标识符 */
  readonly id: string;
  /** 情节线名称（如"真假印章线"、"顾长风成长线"） */
  readonly name: string;
  /** 主线或支线 */
  readonly kind: PlotThreadKind;
  /** 情节线目标 */
  readonly goal: CredibleClaim<string>;
  /** 关联的情节节点 ID（来自旧稿大纲） */
  readonly plotNodeIds: ReadonlyArray<string>;
  /** 涉及的人物 ID */
  readonly characterIds: ReadonlyArray<string>;
  /** 情节线各阶段 */
  readonly stages: ReadonlyArray<PlotThreadStage>;
  /** 关键事件及前因后果 */
  readonly keyEvents: ReadonlyArray<{
    readonly plotNodeId: string;
    readonly description: string;
    readonly cause?: string;
    readonly effect?: string;
  }>;
  /** 时间锚点（事件发生的时间描述） */
  readonly timeAnchor?: CredibleClaim<string>;
  /** 资产状态 */
  readonly status: AssetStatus;
}
