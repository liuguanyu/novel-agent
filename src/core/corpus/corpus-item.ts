/**
 * 素材条目模型与弱参考语义 (corpus-library tasks 1.1, 1.2, 1.5)
 *
 * spec: corpus-model「素材条目模型」「弱参考语义」——
 * 素材以类型化条目存储（type/content/tags/可空 source，type 可扩展）；
 * 素材条目 MUST NOT 构成约束、MUST NOT 进入一致性检查、MUST NOT 产生 bug，
 * 仅作为可取可不取的灵感输入（与事实库正交：事实库强约束，素材库弱参考）。
 *
 * 本文件为类型契约 + Zod 校验 schema（core 层允许纯 schema，无 I/O）。
 */

import { z } from 'zod';

/**
 * 可扩展字面量联合：在保留已知字面量自动补全的同时，允许承载未预置的新值。
 * 用 `Record<never, never>`（等价 `{}`）而非空对象字面量，避免触发 lint 空对象规则，
 * 同时阻止 TypeScript 把交叉塌缩回 `string`（从而保留已知值补全）。
 */
export type ExtensibleLiteral<TKnown extends string> = TKnown | (string & Record<never, never>);

/**
 * 素材条目类型（可扩展，见 spec「类型可扩展」）。
 * - `highlight`：高光片段（极有味道的对白/描写）
 * - `style-sample`：风格样本（可借鉴的文风/语感）
 * - `plot-device`：情节桥段（可复用的桥段/结构）
 * - `narrative-logic`：叙事逻辑（某种叙事推进方式）
 * - `spark`：灵感碎片（意象/点子）
 * 新增类型 MUST NOT 破坏既有条目——故以可扩展联合承载。
 */
export type CorpusItemType = ExtensibleLiteral<
  'highlight' | 'style-sample' | 'plot-device' | 'narrative-logic' | 'spark'
>;

/** 内置已知素材类型清单（供 UI 枚举/建议；不构成校验白名单，类型仍可扩展）。 */
export const KNOWN_CORPUS_ITEM_TYPES = [
  'highlight',
  'style-sample',
  'plot-device',
  'narrative-logic',
  'spark',
] as const;

/**
 * 素材条目稳定标识符（长期引用锚点）。
 * 以 opaque string 承载；生成策略由存储层实现，一经分配即不可变。
 * 使用品牌类型避免与普通 string 混用。
 */
export type CorpusItemId = string & { readonly __brand: 'CorpusItemId' };

/** 将已知为合法 id 的字符串标记为 CorpusItemId（纯类型收窄，无副作用）。 */
export function asCorpusItemId(raw: string): CorpusItemId {
  return raw as CorpusItemId;
}

/**
 * 素材来源信息（可空）。记录素材出处，供回溯与合规边界判断（见 tasks 1.5）。
 * 素材可能含非原创参考内容，来源信息帮助界定「个人本地参考用途」。
 */
export interface CorpusSource {
  /** 来源种类（如 'discarded-draft'/'other-work'/'external'/'manual'，可扩展） */
  kind: ExtensibleLiteral<'discarded-draft' | 'other-work' | 'external' | 'manual'>;
  /** 人类可读的来源标签（作品名/文件名/URL 说明等） */
  label: string;
  /** 可选的来源定位（相对/绝对路径或引用；用于回溯，非必需） */
  locator?: string;
}

/**
 * 一条素材条目。
 * 弱参考语义（见 spec「弱参考语义」）：本条目仅在被**显式检索/引用**时作为参考，
 * MUST NOT 参与一致性检查、MUST NOT 产出 bug；与正文/事实库的不一致不构成问题。
 */
export interface CorpusItem {
  /** 稳定 id */
  id: CorpusItemId;
  /** 条目类型（可扩展） */
  type: CorpusItemType;
  /** 素材正文内容 */
  content: string;
  /** 标签（用于过滤与人工组织） */
  tags: ReadonlyArray<string>;
  /** 来源信息（可空） */
  source?: CorpusSource;
}

/**
 * 弱参考语义的一等标记（供上层/审计模块显式断言素材不进入一致性检查）。
 * 这是与 story-bible 事实库的关键对比点：事实库强约束、触发 bug；素材库弱参考、不触发。
 */
export const CORPUS_WEAK_REFERENCE = {
  /** 素材是否参与一致性检查：永远为 false。 */
  entersConsistencyChecks: false,
  /** 素材是否可产生 bug：永远为 false。 */
  producesBugs: false,
} as const;

/** 素材来源 Zod schema（导入/持久化的 unknown → 强类型）。 */
export const corpusSourceSchema = z
  .object({
    kind: z.string().min(1),
    label: z.string().min(1),
    locator: z.string().optional(),
  })
  .strict();

/**
 * 素材条目 Zod schema：校验持久化/导入的条目内容（unknown → 强类型）。
 * 注：`type` 用 `z.string().min(1)` 而非 enum——类型可扩展，不设校验白名单。
 * id 校验为非空字符串，品牌化由 `asCorpusItemId` 在收窄后完成。
 */
export const corpusItemSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    content: z.string().min(1),
    tags: z.array(z.string()),
    source: corpusSourceSchema.optional(),
  })
  .strict();
