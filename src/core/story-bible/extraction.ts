/**
 * 事实增量抽取 (story-bible tasks 3.1–3.4)
 *
 * spec: fact-extraction——从带章/场景标识符的正文抽取候选事实（含建议锚点与置信度）；
 * 原始模型输出经 schema 校验转强类型后方可入库；低风险不冲突者自动入库标 inferred，
 * 与既有事实冲突者标 conflicting 挂起；按来源锚点去重/更新以保证幂等（见 design D5）。
 *
 * 本文件为类型契约 + Zod 候选 schema（无 I/O；抽取的 prompt/agent 由 agent-orchestration 装配）。
 */

import { z } from 'zod';
import type { NodeRef } from '../manuscript/node-id.js';
import type { Confidence } from './provenance.js';

/**
 * 抽取输入契约 (task 3.1)：一段正文 + 其章/场景稳定标识符。
 * 标识符使抽取产物可锚定来源，并支撑幂等去重（task 3.4）。
 */
export interface ExtractionInput {
  /** 正文所属章/场景稳定标识符（复用 manuscript NodeRef） */
  location: NodeRef;
  /** 正文文本 */
  text: string;
}

/** 候选事实的种类。 */
export type CandidateKind =
  | 'entity'
  | 'attribute'
  | 'alias'
  | 'timeline-event'
  | 'relation'
  | 'plot-hook';

/**
 * 一条候选事实（抽取产物，尚未入库）。
 * `payload` 为该候选的结构化负载（按 kind 不同而不同），先以 unknown 承接、经 schema 校验（task 3.2）。
 */
export interface CandidateFact {
  /** 候选种类 */
  kind: CandidateKind;
  /** 建议锚点（来源位置） */
  suggestedAnchor: NodeRef;
  /** 抽取置信度 */
  confidence: Confidence;
  /** 结构化负载（已校验后转强类型；此处以 unknown 声明校验边界） */
  payload: unknown;
}

/** 抽取输出契约 (task 3.1)：候选事实集合。 */
export interface ExtractionOutput {
  candidates: ReadonlyArray<CandidateFact>;
}

/**
 * 候选事实的 schema 校验点 (task 3.2)。
 * 原始模型输出（unknown）MUST 先经此 schema 校验，safeParse 通过后方可作为候选入库。
 * 注：不在 schema 上标注 z.ZodType<CandidateFact>，以兼容 exactOptionalPropertyTypes。
 */
export const candidateFactSchema = z
  .object({
    kind: z.enum(['entity', 'attribute', 'alias', 'timeline-event', 'relation', 'plot-hook']),
    suggestedAnchor: z.object({
      id: z.string().min(1),
      kind: z.enum(['volume', 'chapter', 'scene']),
    }),
    confidence: z.number().min(0).max(1),
    payload: z.unknown(),
  })
  .strict();

/** 抽取输出的 schema（候选数组）。 */
export const extractionOutputSchema = z
  .object({
    candidates: z.array(candidateFactSchema),
  })
  .strict();

/**
 * 入库决策 (task 3.3)：对单条候选事实的处置。
 * - `auto-ingest`：低风险且不冲突 → 自动入库标 inferred。
 * - `hold-conflict`：与既有事实（尤其 confirmed）冲突 → 标 conflicting 挂起，MUST NOT 静默覆盖。
 */
export type IngestDecision = 'auto-ingest' | 'hold-conflict';

/** 单条候选的入库裁决结果。 */
export interface CandidateDisposition {
  /** 对应候选（按其锚点+种类关联） */
  candidate: CandidateFact;
  /** 处置决策 */
  decision: IngestDecision;
  /** 冲突时：与之冲突的既有事实 id（供人工裁决时定位） */
  conflictsWith?: string;
}

/**
 * 幂等/去重键 (task 3.4)：以来源锚点 + 种类 + 关键标识构成。
 * 对同一来源重复抽取时据此去重/更新，避免重复堆积（见 spec「重复抽取不堆积」）。纯函数。
 */
export function candidateDedupKey(candidate: CandidateFact, identityKey: string): string {
  return `${candidate.suggestedAnchor.kind}:${candidate.suggestedAnchor.id}:${candidate.kind}:${identityKey}`;
}
