/**
 * 出处锚点与置信度 (story-bible task 1.6)
 *
 * spec: fact-model「出处锚点与置信度」——每条事实 MUST 记录一个或多个来源，
 * 每个来源含 story-workspace 的稳定标识符 + 引文片段 + 置信度；正文编辑后章级锚点保持有效。
 *
 * 关键：锚点直接复用 story-workspace 的 NodeRef（章/场景稳定 id），确保正文编辑不使锚点漂移
 *（见 design D2、task 5.2）。本文件为类型契约（无 I/O）。
 */

import type { NodeRef } from '../manuscript/node-id.js';

/** 置信度：0..1 的推断可信度（1 = 作者确认级）。 */
export type Confidence = number;

/**
 * 单个出处来源。
 * - `location` 复用 story-workspace 稳定标识符（章/场景），章级恒定、编辑正文不失效。
 * - `quote` 为引文片段，仅供人工核对/定位（正文变动后可能需重新定位，但锚点本身不失效）。
 */
export interface ProvenanceSource {
  /** 稳定标识符锚点（复用 manuscript 的 NodeRef） */
  location: NodeRef;
  /** 引文片段（人工核对用；非唯一定位依据） */
  quote: string;
  /** 该来源支撑此事实的置信度 */
  confidence: Confidence;
}

/** 出处锚点：一条事实的一个或多个来源（至少一个）。 */
export interface Provenance {
  /** 非空来源列表 */
  sources: ReadonlyArray<ProvenanceSource>;
}
