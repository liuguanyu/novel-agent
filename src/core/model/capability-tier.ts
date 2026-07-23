/**
 * 能力档位 (Task 3.2)
 *
 * agent 按「能力档位」声明模型需求，而非直接引用具体模型名
 * （见 spec: model-adapter「能力档位声明与运行时映射」）。
 * 允许扩展：以 as const 常量对象承载，新增档位不破坏既有类型。
 * 本文件仅为类型/常量定义，无实现逻辑。
 */

export const CAPABILITY_TIERS = {
  /** 强文笔档：正文成文、方言/文风重塑等文学表现 */
  prose: 'prose',
  /** 强逻辑档：审计、结构化推理、JSON 结构化输出 */
  reasoning: 'reasoning',
  /** 廉价快速档：输入密度分析、基础信息提取等体力活 */
  cheapFast: 'cheap-fast',
} as const;

/** 能力档位联合类型 */
export type CapabilityTier = (typeof CAPABILITY_TIERS)[keyof typeof CAPABILITY_TIERS];
