/**
 * 模型配置文件 (config/models.json) 的 Zod 校验 schema (walking-skeleton tasks 2.1, 2.2)
 *
 * 设计借鉴 Zed settings 的 openai_compatible：每个 provider 声明 baseUrl/apiKey 与 availableModels[]，
 * 档位绑定 defaults/perAgent 从中引用（复用 model-config.ts 的 ModelResolutionConfig 语义）。
 *
 * 本文件为纯 Zod schema + 类型（无 I/O）。文件读取与 env 解析在 Main 侧（见 src/main）。
 * apiKey 支持字面量或 `env:VAR_NAME`（Main 侧解析）；$comment 等未知字段被容忍（非 .strict()）。
 */

import { z } from 'zod';

/** 单个可用模型条目（对应 Zed available_models 项）。 */
export const availableModelSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

/** 单个 provider：端点 + 鉴权 + 可用模型列表。 */
export const providerConfigSchema = z.object({
  baseUrl: z.string().url(),
  /** 字面量密钥或 `env:VAR_NAME` 引用；本地端点（如 Ollama）可省略 */
  apiKey: z.string().min(1).optional(),
  availableModels: z.array(availableModelSchema).default([]),
});

/** 档位 → provider+model 绑定。 */
export const modelBindingSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
});

/** 三能力档位默认绑定。 */
export const tierDefaultsSchema = z.object({
  prose: modelBindingSchema,
  reasoning: modelBindingSchema,
  'cheap-fast': modelBindingSchema,
});

/**
 * 完整配置文件形态。
 * 允许 $comment / 其它注释字段（不 .strict()，容忍未知键）。
 * providers 为 Record<providerId, providerConfig>。
 */
export const modelsFileSchema = z.object({
  providers: z.record(z.string().min(1), providerConfigSchema),
  defaults: tierDefaultsSchema,
  /** perAgent 可选覆盖；容忍 `$comment` 等未知非对象键。 */
  perAgent: z
    .record(z.string(), z.unknown())
    .optional()
    .transform((raw) => {
      if (raw === undefined) return undefined;
      const out: Record<string, Record<string, z.infer<typeof modelBindingSchema>>> = {};
      for (const [agentId, val] of Object.entries(raw)) {
        if (agentId.startsWith('$')) continue;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          const record = val as Record<string, unknown>;
          const tiers: Record<string, z.infer<typeof modelBindingSchema>> = {};
          for (const [tier, binding] of Object.entries(record)) {
            if (tier.startsWith('$')) continue;
            const parsed = modelBindingSchema.safeParse(binding);
            if (parsed.success) tiers[tier] = parsed.data;
          }
          if (Object.keys(tiers).length > 0) out[agentId] = tiers;
        }
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }),
});

/** 校验后的强类型配置。 */
export type ModelsFileConfig = z.infer<typeof modelsFileSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type AvailableModel = z.infer<typeof availableModelSchema>;
