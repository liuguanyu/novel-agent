/**
 * IPC 通道标识与用途 (Task 2.1)
 *
 * 各正交通道职责不重叠（见 spec: ipc-contract「IPC 通道正交」）：
 * - manuscript-stream：正文 token 流（Writer 等 → 编辑器）
 * - dialogue-stream：对话流（Supervisor/各 agent 思考与回复 → 右侧 Chat）
 * - control-event：控制事件（interrupt/resume/abort/状态变更/错误）
 * - model-task-event：自动模型任务活动（不进入专家对话或业务控制订阅）
 * - task-activity-event：所有业务任务的作者可读活动与 UI Effect
 *
 * 约定：内容流（正文/对话）与控制流严格分离，MUST NOT 混入同一通道。
 * 本文件仅定义通道常量（跨进程契约），无实现逻辑。
 */

export const IPC_CHANNELS = {
  /** 后端 → 前端：正文 token 增量流 */
  manuscriptStream: 'manuscript-stream',
  /** 后端 → 前端：对话内容增量流 */
  dialogueStream: 'dialogue-stream',
  /** 双向：控制事件（挂起/恢复/中断/状态/错误）与前端命令 */
  controlEvent: 'control-event',
  /** 后端 → 前端：自动模型任务的结构化活动，不进入专家对话流。 */
  modelTaskEvent: 'model-task-event',
  /** 后端 → 前端：统一业务任务活动、产物和工作区效果。 */
  taskActivityEvent: 'task-activity-event',
} as const;

/** 通道名联合类型 */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** 内容流通道（仅承载流式内容，不承载控制语义） */
export type StreamChannel = typeof IPC_CHANNELS.manuscriptStream | typeof IPC_CHANNELS.dialogueStream;
