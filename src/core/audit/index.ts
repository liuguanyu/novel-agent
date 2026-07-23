/**
 * global-audit 统一出口 (全书总检:SonarQube 式小说质量仪表盘)
 *
 * 只对撞事实库高维骨架、不读正文水字，用 Map-Reduce 跑完全书检出宏观逻辑塌方（伏笔悬空/人设崩塌/时空死锁）:
 * - skeleton:Map 阶段按章/实体分片抽取骨架（复用 story-bible 时间线/伏笔/人设，不另立模型）。
 * - map-reduce:Reduce 跨片对撞 + 总检运行/进程/中断语义（utilityProcess，可手动触发可中断）。
 * - dashboard:健康度评分（可解释权重）+ 红黄牌列表 + 一键跳章 + 一键修复走局部 diff。
 * - audit-worker-task:总检的 Main↔utilityProcess 任务契约。
 * - audit-task-runner:纯对撞计算（worker/内联共用，可独立校验；无 I/O、无 Electron）。
 *
 * 本模块为类型契约 + 纯函数 helper（无 I/O）;Map-Reduce 归 utilityProcess，聚合/评分/跳章编排归 Main。
 */

export * from './skeleton.js';
export * from './map-reduce.js';
export * from './dashboard.js';
export * from './audit-worker-task.js';
export * from './audit-task-runner.js';
