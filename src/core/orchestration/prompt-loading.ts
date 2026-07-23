/**
 * YAML 外置提示词加载 (agent-orchestration tasks 4.1–4.4)
 *
 * spec: prompt-loading——外置 YAML（name/description/template 含 slot/variables.required/
 * settings 含能力档位），与代码解耦；加载器运行时加载、校验必填变量、填充 slot，
 * 模板/变量缺失时明确回退或报错，不静默产出错误 prompt（见 design D4）。
 * 模板结构对齐 LibriScribe（references/libriscribe-prompts/）。
 *
 * 本文件为类型契约 + Zod schema + 纯填充/校验 helper（无文件 I/O；读盘由运行层完成后交此校验）。
 */

import { z } from 'zod';
import type { CapabilityTier } from '../model/capability-tier.js';

/** 提示词 settings（含能力档位声明，task 4.3）。 */
export interface PromptSettings {
  /** 能力档位（经 model-adapter 解析到具体模型） */
  tier: CapabilityTier;
  /** 采样温度（可选） */
  temperature?: number;
  /** 最大 token（可选） */
  maxTokens?: number;
}

/**
 * 提示词模板 (task 4.1)，结构对齐 LibriScribe：
 * name/description/template(含 `{变量}` slot)/variables.required/settings。
 */
export interface PromptTemplate {
  name: string;
  description: string;
  /** 含 `{slot}` 占位符的模板正文 */
  template: string;
  /** 必填变量清单 */
  requiredVariables: ReadonlyArray<string>;
  /** 设置（含档位） */
  settings: PromptSettings;
}

/** 档位枚举（与 capability-tier 对齐；用于 YAML 校验白名单）。 */
const tierEnum = z.enum(['prose', 'reasoning', 'cheap-fast']);

/**
 * 提示词模板 Zod schema：校验从 YAML 反序列化的 unknown（task 4.2）。
 * 兼容 exactOptionalPropertyTypes：不标注 z.ZodType<PromptTemplate>。
 */
export const promptTemplateSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    template: z.string().min(1),
    requiredVariables: z.array(z.string()),
    settings: z
      .object({
        tier: tierEnum,
        temperature: z.number().optional(),
        maxTokens: z.number().int().positive().optional(),
      })
      .strict(),
  })
  .strict();

/** slot 填充的变量表。 */
export type PromptVariables = Readonly<Record<string, string>>;

/** 填充成功。 */
export interface FillOk {
  ok: true;
  /** 填充后的最终 prompt 文本 */
  prompt: string;
}

/**
 * 填充失败：缺少必填变量（task 4.2 / spec「必填变量校验」）。
 * MUST NOT 用空值静默填充产出错误 prompt。
 */
export interface FillErr {
  ok: false;
  /** 缺失的必填变量名 */
  missing: ReadonlyArray<string>;
}

export type FillResult = FillOk | FillErr;

/**
 * 填充模板 slot (task 4.2)。纯函数。
 * 先校验 requiredVariables 齐备；缺失则返回 FillErr（不静默）。
 * 齐备则替换所有 `{name}` slot。
 */
export function fillTemplate(template: PromptTemplate, variables: PromptVariables): FillResult {
  const missing = template.requiredVariables.filter((name) => variables[name] === undefined);
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  const prompt = template.template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = variables[name];
    return value ?? match;
  });
  return { ok: true, prompt };
}

/**
 * 模板缺失回退策略 (task 4.4 / spec「模板缺失回退」)。
 * - `builtin-default`：回退到内置默认模板。
 * - `error`：明确报错。
 * MUST NOT 静默失败。具体默认模板与选择由运行层决定；此处定义策略枚举契约。
 */
export type MissingTemplatePolicy = 'builtin-default' | 'error';

/**
 * 解析结果：从外置 YAML 反序列化的 unknown → 结构化 PromptTemplate（运行层读盘后调用）。
 */
export interface ParseOk {
  ok: true;
  template: PromptTemplate;
}

/** 解析失败：YAML 结构不符 schema（task 3.1 / spec「解析或校验失败不静默」）。 */
export interface ParseErr {
  ok: false;
  /** 人类可读的失败原因（用于诊断日志，不静默） */
  reason: string;
}

export type ParseResult = ParseOk | ParseErr;

/**
 * 校验并规整一个从 YAML 反序列化得到的 unknown 为 PromptTemplate（纯函数，无 fs I/O）。
 * schema 不符时返回 ParseErr（附原因），MUST NOT 抛出——由运行层决定回退或报错。
 */
export function parsePromptTemplate(raw: unknown): ParseResult {
  const parsed = promptTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const data = parsed.data;
  const template: PromptTemplate = {
    name: data.name,
    description: data.description,
    template: data.template,
    requiredVariables: data.requiredVariables,
    settings: {
      tier: data.settings.tier,
      ...(data.settings.temperature !== undefined ? { temperature: data.settings.temperature } : {}),
      ...(data.settings.maxTokens !== undefined ? { maxTokens: data.settings.maxTokens } : {}),
    },
  };
  return { ok: true, template };
}
