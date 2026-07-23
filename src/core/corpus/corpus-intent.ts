/**
 * 导入意图分流 (corpus-library task 1.3)
 *
 * spec: corpus-model「导入意图分流」——
 * 导入外部素材时，系统 MUST 允许用户选择其归宿：本作正文、参考素材、或两者兼有。
 * 归宿选择 MUST 决定该素材进入哪个子系统。
 *
 * 与 story-workspace/story-bible 的正交关系：本文件只定义**分流意图**这一契约，
 * 「本作正文」侧的正文/事实落库由 story-workspace（导入入口）与 story-bible 负责；
 * 「参考素材」侧进本素材库。corpus 不实现正文/事实侧逻辑，仅承接分流结果。
 *
 * 本文件为类型契约 + Zod 校验 schema（core 层允许纯 schema，无 I/O）。
 */

import { z } from 'zod';
import { corpusResidenceSchema } from './corpus-scope.js';
import type { CorpusResidence } from './corpus-scope.js';

/**
 * 导入归宿（可多选，「两者兼有」= 同时含两者）。
 * - `canonical`：作为本作正文——进 story-workspace（正文）/story-bible（事实）。
 *   正文与事实的进一步细分由那两个子系统负责，corpus 不感知。
 * - `corpus`：作为参考素材——进本素材库。
 */
export type ImportDestination = 'canonical' | 'corpus';

/**
 * 一次导入的意图分流。
 * `destinations` MUST 非空；含 `canonical` 表示走正文/事实侧，含 `corpus` 表示走素材库侧，
 * 两者皆含即「两者兼有」。当含 `corpus` 时，`corpusResidence` 决定素材进全局库还是项目私有。
 */
export interface ImportIntent {
  /** 归宿集合（非空；去重） */
  destinations: ReadonlyArray<ImportDestination>;
  /** 仅当 destinations 含 'corpus' 时有意义：素材归属（全局/项目私有） */
  corpusResidence?: CorpusResidence;
}

/** 导入意图 Zod schema（校验来自 UI/IPC 的分流选择）。 */
export const importIntentSchema = z
  .object({
    destinations: z.array(z.enum(['canonical', 'corpus'])).min(1),
    corpusResidence: corpusResidenceSchema.optional(),
  })
  .strict();

/** 判断某导入意图是否会流入素材库（纯谓词，无副作用）。 */
export function routesToCorpus(intent: ImportIntent): boolean {
  return intent.destinations.includes('corpus');
}

/** 判断某导入意图是否会流入本作正文/事实侧（纯谓词，无副作用）。 */
export function routesToCanonical(intent: ImportIntent): boolean {
  return intent.destinations.includes('canonical');
}
