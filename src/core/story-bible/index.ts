/**
 * story-bible 统一出口 (事实库)
 *
 * 事实库数据模型（实体/属性/别名/时间线/关系/伏笔）+ 出处锚点 + 状态 + 版本化 +
 * 增量抽取 + 正向/反向/悬空伏笔一致性检查。
 *
 * 出处锚点复用 story-workspace 的稳定标识符（manuscript NodeRef），见 provenance.ts。
 */

export * from './provenance.js';
export * from './fact-status.js';
export * from './entity.js';
export * from './timeline.js';
export * from './relation.js';
export * from './plot-hook.js';
export * from './versioning.js';
export * from './fact-store.js';
export * from './extraction.js';
export * from './consistency-issue.js';
export * from './consistency-check.js';
export * from './consistency-worker-task.js';
