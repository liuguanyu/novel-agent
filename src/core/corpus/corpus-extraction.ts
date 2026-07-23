/**
 * 自动提炼契约 (corpus-library tasks 2.1, 2.2, 2.3)
 *
 * spec: corpus-extraction——
 * - 从导入素材自动提炼候选条目（每项含类型、内容、建议标签）；
 * - 原始模型输出 MUST 经 schema 校验转强类型后方可作为候选（校验点在此）；
 * - 候选条目人工可改：修改内容/增删标签/确认收录/删除；未确认候选不影响已确认条目；
 * - embedding 等 CPU 密集计算 MUST 在 utilityProcess 执行（见 corpus-task.ts 任务契约）。
 *
 * 本文件为类型契约 + Zod 校验 schema（core 层允许纯 schema，无 I/O）。
 */

import { z } from 'zod';
import { corpusSourceSchema } from './corpus-item.js';
import type { CorpusItemType, CorpusSource } from './corpus-item.js';
import { corpusResidenceSchema } from './corpus-scope.js';
import type { CorpusResidence } from './corpus-scope.js';

/**
 * 提炼输入：一份被指定进入素材库的外部素材。
 * 归属（residence）随导入意图一并给出（见 corpus-intent.ts）；提炼产出的条目沿用之。
 */
export interface ExtractionInput {
  /** 待提炼的素材正文（逐字，保真交由导入侧保证） */
  content: string;
  /** 素材来源（可空，透传到候选与最终条目供回溯） */
  source?: CorpusSource;
  /** 提炼产物的归属（全局库/项目私有） */
  residence: CorpusResidence;
  /** 可选：提示优先提炼的类型（不构成白名单，仅引导；类型仍可扩展） */
  preferTypes?: ReadonlyArray<CorpusItemType>;
}

/**
 * 一条提炼出的候选条目（尚未落为正式 CorpusItem——确认后由存储层分配稳定 id）。
 * 含类型、内容与**建议**标签（见 spec「每项含类型、内容与建议标签」）。
 */
export interface CorpusCandidate {
  /** 候选类型（可扩展） */
  type: CorpusItemType;
  /** 候选内容 */
  content: string;
  /** 模型建议的标签（人工可增删） */
  suggestedTags: ReadonlyArray<string>;
  /** 可选：模型给出的提炼理由/摘要，辅助人工判断是否收录 */
  rationale?: string;
}

/**
 * 提炼结果：候选条目集合。
 * 这是**模型输出经 schema 校验后**的强类型形态——原始模型文本先以 unknown 承接，
 * 再由 `corpusExtractionResultSchema.safeParse` 校验（校验点，见 spec）。
 */
export interface ExtractionResult {
  candidates: ReadonlyArray<CorpusCandidate>;
}

/**
 * 候选的人工裁决种类（见 spec「提炼结果人工可改」）。
 * - `confirm`：确认收录（可带 overrides 修改内容/标签/类型）
 * - `delete`：删除该候选（不收录）
 * 未裁决（既非 confirm 亦非 delete）的候选处于待定态，MUST NOT 影响已确认条目。
 */
export type CandidateDecisionKind = 'confirm' | 'delete';

/** 人工对候选内容的覆盖（部分字段；未给出的沿用候选原值）。 */
export interface CandidateOverrides {
  type?: CorpusItemType;
  content?: string;
  tags?: ReadonlyArray<string>;
}

/**
 * 一条人工裁决：定位到某候选（按其在候选数组中的下标）并给出处置。
 * `overrides` 仅在 `kind='confirm'` 时有意义。
 */
export interface CandidateDecision {
  /** 对应候选在 candidates 数组中的下标 */
  candidateIndex: number;
  kind: CandidateDecisionKind;
  overrides?: CandidateOverrides;
}

/**
 * 一次提炼的人工裁决包：对候选集合逐条处置后，方将 confirm 项落为 CorpusItem。
 * 未包含在 decisions 中的候选视为待定，不落库（不影响已确认条目）。
 */
export interface ExtractionReview {
  decisions: ReadonlyArray<CandidateDecision>;
}

/** 单条候选 Zod schema（校验模型输出的每一项）。 */
export const corpusCandidateSchema = z
  .object({
    type: z.string().min(1),
    content: z.string().min(1),
    suggestedTags: z.array(z.string()),
    rationale: z.string().optional(),
  })
  .strict();

/**
 * 提炼结果 Zod schema —— **模型输出的校验点**。
 * 原始模型输出先以 unknown 承接，经此 `.safeParse()` 通过后方可作为候选进入后续人工环节
 *（见 spec「原始模型输出 MUST 经 schema 校验转强类型后方可作为候选条目」）。
 */
export const corpusExtractionResultSchema = z
  .object({
    candidates: z.array(corpusCandidateSchema),
  })
  .strict();

/** 提炼输入 Zod schema（校验来自 IPC/编排层的提炼请求）。 */
export const extractionInputSchema = z
  .object({
    content: z.string().min(1),
    source: corpusSourceSchema.optional(),
    residence: corpusResidenceSchema,
    preferTypes: z.array(z.string().min(1)).optional(),
  })
  .strict();
