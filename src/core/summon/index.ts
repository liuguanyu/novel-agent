/**
 * on-demand-summon 统一出口 (按需召唤：作者延伸的金手指)
 *
 * 把 agent-orchestration 的有状态图暴露为随叫随到的兵器谱：
 * - summon-command：三入口统一召唤命令协议（agent/scope/anchor/mode/instruction）+ scope 分级。
 * - context-assembly：按 agent+scope 自动组装上下文（引用/检索，非整库）+ 进程归属。
 * - summon-execution：召唤=向持久图注入命令改路由、复用状态与 checkpointer；
 *   diagnose 只读→END、mutate 走局部 diff→挂起；mode 严格分流。
 *
 * 本模块为类型契约 + Zod schema + 纯函数 helper（无 I/O）；召唤处理归 Main/utilityProcess，绝不在 Renderer。
 */

export * from './summon-command.js';
export * from './context-assembly.js';
export * from './summon-execution.js';
