/**
 * 个人本地参考用途的合规边界 (corpus-library task 1.5)
 *
 * spec/proposal: 素材可能含非原创参考内容，定位为**个人本地参考用途**——
 * 不外发、不用于训练。本文件将该合规边界固化为一等契约常量与断言辅助，
 * 供上层（导出/同步/训练相关流程）在编译期/运行期显式引用与校验。
 *
 * 本文件为类型契约 + 纯常量/纯函数（无 I/O）。
 */

/**
 * 素材库合规边界（个人本地参考用途）。
 * 这些标志为**不可放宽**的定位约束，任何流程 MUST NOT 违反。
 */
export const CORPUS_COMPLIANCE_BOUNDARY = {
  /** 用途定位：个人本地参考。 */
  usage: 'personal-local-reference',
  /** 是否允许对外分发/外发：否。 */
  allowsRedistribution: false,
  /** 是否允许用于模型训练：否。 */
  allowsTraining: false,
} as const;

/** 合规边界的类型（由常量推导，供签名标注）。 */
export type CorpusComplianceBoundary = typeof CORPUS_COMPLIANCE_BOUNDARY;

/**
 * 断言某项拟议用途是否落在合规边界内（纯函数，无副作用）。
 * 供导出/同步/训练相关流程在放行前显式检查。
 */
export function isCompliantUsage(usage: 'redistribution' | 'training' | 'local-reference'): boolean {
  switch (usage) {
    case 'local-reference':
      return true;
    case 'redistribution':
      return CORPUS_COMPLIANCE_BOUNDARY.allowsRedistribution;
    case 'training':
      return CORPUS_COMPLIANCE_BOUNDARY.allowsTraining;
    default:
      return false;
  }
}
