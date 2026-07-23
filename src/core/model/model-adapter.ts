/**
 * 统一模型调用接口 ModelAdapter (Task 3.1) 与 provider 适配契约 (Task 3.4)
 *
 * 封装不同 provider 的鉴权、请求格式与流式协议差异，对上层 agent 透明
 * （见 spec: model-adapter「统一模型调用接口」「流式输出与可中断」）。
 * 本文件仅为接口/类型定义，无实现逻辑。
 */

import type { CapabilityTier } from './capability-tier.js';

/** 对话角色 */
export type ChatRole = 'system' | 'user' | 'assistant';

/** 单条消息 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** 调用选项 */
export interface ModelCallOptions {
  temperature?: number;
  maxTokens?: number;
  /** 可中断：触发后 MUST 中止请求，SHOULD 尽快断连省 token（Task 3.1 / spec 流式可中断） */
  signal?: AbortSignal;
}

/** 一次调用的输入 */
export interface ModelCallInput {
  messages: readonly ChatMessage[];
  options?: ModelCallOptions;
}

/** 最终结果（非流式消费方式） */
export interface ModelResult {
  /** 完整文本 */
  text: string;
  /** 结束原因 */
  finishReason: 'stop' | 'length' | 'aborted';
  /** 可选用量统计（已收窄，非 any） */
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * 统一模型调用接口。
 *
 * - 输出同时支持「流式 token」与「最终结果」两种消费方式（spec: 输入输出契约稳定）。
 * - 上层 agent MUST NOT 依赖任何特定 provider 的请求/响应细节。
 */
export interface ModelAdapter {
  /** 流式消费：逐 token 产出 */
  stream(input: ModelCallInput): AsyncIterable<string>;
  /** 一次性消费：返回最终结果 */
  complete(input: ModelCallInput): Promise<ModelResult>;
}

/**
 * provider 适配契约 (Task 3.4)
 *
 * 每个 provider 实现此工厂，鉴权/请求/流式协议封装在内部，对上层透明。
 * `create` 依据解析出的具体模型名产出一个 ModelAdapter 实例。
 */
export interface ModelProviderAdapter {
  /** provider 标识（如 'openai' | 'anthropic' | 'ollama'），具体值由实现声明 */
  readonly providerId: string;
  /** 依据模型名与鉴权配置创建适配器实例 */
  create(model: string, auth: ProviderAuth): ModelAdapter;
}

/** 鉴权配置（密钥来源由实现层从安全存储注入，不硬编码） */
export interface ProviderAuth {
  apiKey?: string;
  /** 自建/代理端点（如 Ollama 本地地址） */
  baseUrl?: string;
}

/** 供 agent 声明其模型需求：只给档位，不给具体模型 */
export interface ModelRequirement {
  tier: CapabilityTier;
}
