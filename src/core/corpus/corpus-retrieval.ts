/**
 * 语义检索契约 (corpus-library tasks 3.1, 3.2, 3.3, 3.4)
 *
 * spec: corpus-retrieval——
 * - 按语义相似度检索素材条目，返回按相关度排序的结果（写作时找类似氛围/桥段/写法）；
 * - 支持按标签/来源/类型过滤，并可与语义检索组合（同时满足语义相关与过滤条件）；
 * - 进程归属：embedding 计算 MUST 在 utilityProcess；向量库读写 I/O 归 Main（非阻塞）；
 * - 向量库选型（Chroma/LanceDB 等）本 change 不锁定（见 task 3.4）。
 *
 * 本文件为类型契约 + Zod 校验 schema（core 层允许纯 schema，无 I/O）。
 */

import { z } from 'zod';
import { corpusScopeSchema } from './corpus-scope.js';
import type { CorpusScope } from './corpus-scope.js';
import type { CorpusItem, CorpusItemType } from './corpus-item.js';

/**
 * 过滤条件：与语义检索组合。系统 MUST 仅返回**同时**满足语义相关与过滤条件的条目。
 * 各字段缺省表示不在该维度过滤；数组内为「任一匹配」（OR），跨字段为「同时满足」（AND）。
 */
export interface CorpusFilter {
  /** 按类型过滤（任一匹配） */
  types?: ReadonlyArray<CorpusItemType>;
  /** 按标签过滤（任一匹配） */
  tags?: ReadonlyArray<string>;
  /** 按来源种类过滤（任一匹配，对应 CorpusSource.kind） */
  sourceKinds?: ReadonlyArray<string>;
}

/**
 * 一次语义检索查询。
 * `query` 为自然语言（如当前场景描述或关键词）；检索侧据此计算查询 embedding
 *（该计算归 utilityProcess，见 corpus-task.ts）。
 */
export interface CorpusQuery {
  /** 查询文本（语义检索的输入） */
  query: string;
  /** 检索作用域限定（单篇/项目/全局） */
  scope: CorpusScope;
  /** 可选过滤条件（与语义检索组合） */
  filter?: CorpusFilter;
  /** 返回条数上限（缺省由实现层定默认值） */
  topK?: number;
  /** 可选：相关度下限（低于此分的结果不返回） */
  minScore?: number;
}

/**
 * 一条检索命中：素材条目 + 相关度分数。
 * `score` 为相关度（越大越相关；具体度量随向量库/距离实现而定，本 change 不锁定量纲）。
 */
export interface CorpusHit {
  item: CorpusItem;
  score: number;
}

/**
 * 检索结果：命中列表，MUST 按相关度降序排列（见 spec「按相关度排序」）。
 */
export interface CorpusRetrievalResult {
  hits: ReadonlyArray<CorpusHit>;
}

/**
 * 检索计算的进程归属声明（对应 task 3.3/3.4，供实现层遵循的一等常量）。
 * 非运行时逻辑，仅固化归属约定与「选型未定」事实。
 */
export const CORPUS_RETRIEVAL_PLACEMENT = {
  /** 查询/条目 embedding 计算归属：CPU 密集 → utilityProcess/worker。 */
  embedding: 'utility-process',
  /** 向量库读写归属：I/O → Main（非阻塞）。 */
  vectorStoreIo: 'main',
  /** 向量库选型：本 change 未锁定（Chroma/LanceDB 等，实现阶段定）。 */
  vectorStore: 'undecided',
} as const;

/** 过滤条件 Zod schema。 */
export const corpusFilterSchema = z
  .object({
    types: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string()).optional(),
    sourceKinds: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** 检索查询 Zod schema（校验来自 UI/IPC 的检索请求）。 */
export const corpusQuerySchema = z
  .object({
    query: z.string().min(1),
    scope: corpusScopeSchema,
    filter: corpusFilterSchema.optional(),
    topK: z.number().int().positive().optional(),
    minScore: z.number().optional(),
  })
  .strict();
