/**
 * corpus-library 统一出口 (corpus-library)
 *
 * 素材库（Corpus）：弱参考性原材料的数据模型、作用域挂载、导入意图分流、
 * 自动提炼、语义检索与 embedding 任务契约。与 story-bible 事实库正交
 * （弱参考、语义检索、可跨项目复用 vs 强约束、结构化、本作事实）。
 */

export * from './corpus-item.js';
export * from './corpus-scope.js';
export * from './corpus-intent.js';
export * from './corpus-compliance.js';
export * from './corpus-extraction.js';
export * from './corpus-retrieval.js';
export * from './corpus-task.js';
export * from './corpus-embedding.js';
