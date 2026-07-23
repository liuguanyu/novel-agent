/**
 * surgical-refactor 统一出口 (外科手术式重构:保护作者原创)
 *
 * 核心交互不变量:写入必走局部 Diff、逐 hunk 接受、绝不整章覆盖;重构 agent 只见待修片段。
 * - fragment:从选区/节点裁出待修片段（只喂坏片段，隔离好文笔）+ 锚点记录。
 * - diff-engine:原片段 vs 改写的最小差异 + hunk 拆分（携锚点/原文/改写，utilityProcess）。
 * - hunk-review:逐 hunk accept/reject + 纯函数精确拼回 + 偏移失效处理 + 变更可回滚。
 * - diff-worker-task:diff 计算的 Main↔utilityProcess 任务契约。
 *
 * 本模块为类型契约 + 纯函数 helper（无 I/O）;diff 计算归 utilityProcess，拼回/写入编排归 Main。
 */

export * from './fragment.js';
export * from './diff-engine.js';
export * from './diff-compute.js';
export * from './hunk-review.js';
export * from './diff-worker-task.js';
