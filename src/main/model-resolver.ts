/**
 * 模型配置加载 (walking-skeleton tasks 2.1–2.3)
 *
 * Main 侧读取项目根 config/models.json，Zod 校验为强类型；apiKey 支持 env:VAR_NAME；
 * 按档位解析 provider+model 并创建可用的 ModelAdapter。缺失/无效结构化报错，不硬编码密钥。
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  modelsFileSchema,
  createOpenAiCompatProvider,
  type ModelsFileConfig,
  type CapabilityTier,
  type ModelAdapter,
  type ProviderAuth,
  type ModelResolutionConfig,
  type ModelBinding,
} from '../core/model/index.js';
import type { OpenAiCompatOptions } from '../core/model/openai-compat-adapter.js';

/** 加载结果：成功或结构化失败（不抛裸异常给上层路由）。 */
export type ConfigLoadResult =
  | { ok: true; config: ModelsFileConfig }
  | { ok: false; message: string };

/** 解析 apiKey：`env:VAR` → 环境变量；否则字面量。缺失返回 undefined。 */
function resolveApiKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.startsWith('env:')) {
    const varName = raw.slice('env:'.length);
    return process.env[varName];
  }
  return raw;
}

/** 读取并校验 config/models.json（项目根相对 cwd）。 */
export async function loadModelsConfig(
  configPath = resolve(process.cwd(), 'config/models.json'),
): Promise<ConfigLoadResult> {
  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch {
    return { ok: false, message: `未找到模型配置文件：${configPath}（请复制模板并填写 baseUrl/apiKey）` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: `模型配置不是合法 JSON：${String(err)}` };
  }
  const parsed = modelsFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: `模型配置校验失败：${parsed.error.message}` };
  }
  return { ok: true, config: parsed.data };
}

/** 从配置投影出 ModelResolutionConfig（复用 model-config 契约语义）。 */
function toResolutionConfig(config: ModelsFileConfig): ModelResolutionConfig {
  return {
    defaults: config.defaults,
    ...(config.perAgent !== undefined ? { perAgent: config.perAgent } : {}),
  };
}

/** 按 perAgent[agentId][tier] > defaults[tier] 解析绑定。 */
function resolveBinding(
  resolution: ModelResolutionConfig,
  agentId: string,
  tier: CapabilityTier,
): ModelBinding {
  const override = resolution.perAgent?.[agentId]?.[tier];
  if (override !== undefined) return override;
  return resolution.defaults[tier];
}

/**
 * 模型解析器：持有校验后的配置，按 (agentId, tier) 产出 ModelAdapter。
 * reasoning 旁路经 options.onReasoning 注入（每次调用可不同，故在 create 时传）。
 */
export class ModelResolver {
  private readonly resolution: ModelResolutionConfig;

  constructor(private readonly config: ModelsFileConfig) {
    this.resolution = toResolutionConfig(config);
  }

  /** 解析并创建一个 adapter；provider 未配置或缺 baseUrl 时抛出（上层捕获转结构化错误）。 */
  createAdapter(agentId: string, tier: CapabilityTier, options: OpenAiCompatOptions = {}): ModelAdapter {
    const binding = resolveBinding(this.resolution, agentId, tier);
    const provider = this.config.providers[binding.providerId];
    if (provider === undefined) {
      throw new Error(`档位 ${tier} 绑定的 provider '${binding.providerId}' 未在 providers 中配置`);
    }
    const apiKey = resolveApiKey(provider.apiKey);
    const auth: ProviderAuth = {
      baseUrl: provider.baseUrl,
      ...(apiKey !== undefined ? { apiKey } : {}),
    };
    const providerAdapter = createOpenAiCompatProvider(binding.providerId, options);
    return providerAdapter.create(binding.model, auth);
  }
}
