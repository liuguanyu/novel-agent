/**
 * 档位 → provider+model 配置结构 (Task 3.3)
 *
 * 运行时由用户配置将能力档位映射到具体 provider+model；支持全局默认与 per-agent 覆盖。
 * 更换模型 MUST 仅通过配置完成，不需修改源码（见 spec: model-adapter「运行时按配置解析模型」）。
 * 本文件仅为类型定义，无实现逻辑。
 */

import type { CapabilityTier } from './capability-tier.js';

/** 指向某个具体模型的绑定 */
export interface ModelBinding {
  /** provider 标识，对应 ModelProviderAdapter.providerId */
  providerId: string;
  /** 具体模型名（如 'gpt-4o'、'claude-3-5-sonnet'、'llama3'） */
  model: string;
}

/** 全局：每个档位默认绑定到哪个 provider+model */
export type TierDefaults = Readonly<Record<CapabilityTier, ModelBinding>>;

/**
 * per-agent 覆盖：某 agent 可覆盖其某些档位的绑定。
 * 未覆盖的档位回退到 TierDefaults。
 */
export type AgentTierOverrides = Readonly<Partial<Record<CapabilityTier, ModelBinding>>>;

/** 模型解析配置的完整形态 */
export interface ModelResolutionConfig {
  /** 全局档位默认 */
  defaults: TierDefaults;
  /** 按 agentId 的档位覆盖表 */
  perAgent?: Readonly<Record<string, AgentTierOverrides>>;
}

/**
 * 解析入参：给定 agent 与其声明的档位，解析出具体绑定。
 * 解析优先级：perAgent[agentId][tier] > defaults[tier]。
 * （此处仅定义解析所需的输入/输出类型；解析函数实现属后续 agent-orchestration/运行时。）
 */
export interface ModelResolutionRequest {
  agentId: string;
  tier: CapabilityTier;
}
