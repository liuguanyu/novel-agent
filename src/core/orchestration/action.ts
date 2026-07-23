/**
 * 编排动作与 agent 运行状态 (agent-orchestration task 1.2 支撑)
 *
 * currentAction 供 supervisor 路由（见 orchestration-graph）；agentStatus 表达运行态。
 * 本文件为类型契约（无 I/O）。动作类型可扩展（为 on-demand-summon 的召唤命令预留）。
 */

/**
 * 当前动作/意图：supervisor 依此路由到专家节点。
 * 预置常见动作，`(string & {})` 允许扩展（召唤命令由 on-demand-summon 注入更多动作）。
 */
export type OrchestrationAction =
  | 'write' // 写章/续写 → writer
  | 'generate-scene' // 生成分场景正文 → scene-generator
  | 'review' // 审稿 → reviewer
  | 'fact-check' // 事实/一致性核查 → fact-checker
  | 'plagiarism-check' // 原创性/雷同风险核查 → plagiarism-checker
  | 'edit' // 编辑 → editor
  | 'restyle' // 文风 → style-editor
  | 'outline' // 大纲/复盘 → architect
  | 'generate-characters' // 人物档案 → character-generator
  | 'build-world' // 世界设定 → worldbuilding
  | 'generate-concept' // 书籍立意（标题/内核/主题/受众/卖点）→ concept-generator
  | 'outline-scenes' // 章内分场大纲 → scene-outliner
  | 'research' // 背景资料研究 → researcher
  | 'idle' // 无动作（等待路由）
  | (string & Record<never, never>);

/**
 * agent 运行状态：供上层（human-in-the-loop）与 UI 呈现。
 * `paused_by_user` 为 human-in-the-loop 中断语义预留。
 */
export type AgentStatus =
  | 'idle'
  | 'writing'
  | 'reviewing'
  | 'fact_checking'
  | 'editing'
  | 'paused_by_user'
  | 'error';
