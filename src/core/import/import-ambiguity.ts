/**
 * 导入歧义与人工确认降级 (story-workspace task 3.3)
 *
 * spec: project-import「边界识别与歧义人工确认」——
 * 歧义或识别失败时 MUST 向用户呈现推断结果并请求确认/手工调整，MUST NOT 静默猜测。
 *
 * 本文件为类型契约（无 I/O）。歧义作为一等数据回传给上层（最终经 IPC 到 UI）。
 */

import type { SourceFileRef } from './import-contract.js';

/** 歧义种类。 */
export type ImportAmbiguityKind =
  | 'duplicate-ordinal' // 同级出现重复序号（如两个「第十六章」）
  | 'missing-ordinal' // 无法解析序号（保真优先，不猜测）
  | 'gap-in-sequence' // 序号不连续（缺章），提示用户核对
  | 'unrecognized-structure' // 标题/文件组织无法可靠识别
  | 'title-mismatch'; // 文件名标题与内部标题不一致

/**
 * 一条待确认的歧义。携带足够上下文让用户理解并抉择，
 * 但不含系统的“静默决定”——resolution 由用户回填。
 */
export interface ImportAmbiguity {
  kind: ImportAmbiguityKind;
  /** 人类可读的问题描述 */
  message: string;
  /** 涉及的源文件（供 UI 定位与预览） */
  involved: ReadonlyArray<SourceFileRef>;
  /**
   * 系统给出的候选处理方式（供用户选择，而非自动执行）。
   * 例如重复序号：['保留两者并重新编号', '选其一丢弃另一', '合并']。
   */
  suggestedOptions: ReadonlyArray<string>;
}

/** 用户对某条歧义的裁决（由 UI 回传，驱动最终落盘）。 */
export interface AmbiguityResolution {
  /** 对应 ambiguity 在结果数组中的下标 */
  ambiguityIndex: number;
  /** 用户选中的处理方式（取自 suggestedOptions，或自定义说明） */
  chosenOption: string;
  /** 可选的用户自由文本调整说明 */
  note?: string;
}

/**
 * 确认阶段的整体裁决包：全部歧义处理完毕后，方可将推断树落为正式工作区。
 * 未解决的歧义存在时，导入 MUST 阻塞在确认态，不得继续（保真 + 不静默猜测）。
 */
export interface ImportConfirmation {
  resolutions: ReadonlyArray<AmbiguityResolution>;
}
