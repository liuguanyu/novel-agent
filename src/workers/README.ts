/**
 * workers/ 占位（最小骨架）。
 *
 * 职责边界（见 docs/conventions.md §3–§4）：CPU 密集任务（embedding、大文本 diff、
 * Map-Reduce 总检、大文档解析）在此以 utilityProcess/worker 落地，经 MessagePort 与 Main
 * 交换强类型任务消息（含 taskId + type，错误即消息）。
 *
 * 具体 worker 入口由对应 change 落地：
 * - surgical-refactor → diff worker
 * - global-audit → map-reduce worker
 * - corpus-library → embedding/检索 worker
 * 本文件不含实现，仅标注边界。
 */

export {};
