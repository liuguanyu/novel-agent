/**
 * 受限 IPC 桥的类型契约 (walking-skeleton)
 *
 * preload 经 contextBridge 暴露的 API 形状，作为跨 preload/renderer 的**共享类型契约**置于 shared/ipc（叶子层）。
 * preload 实现此接口；renderer 经 window.novelAgent 消费。此文件仅类型，不依赖 electron/core。
 */

import type { BackendStreamMessage } from './stream-messages.js';
import type { FrontendCommandMessage } from './command-messages.js';
import type { BackendControlEvent } from './control-messages.js';
import type { BackendModelTaskEvent } from './model-task-messages.js';
import type { BackendTaskActivityEvent } from './task-activity-messages.js';
import type {
  ChapterTreeDto,
  ChapterContentDto,
  GetChapterContentRequest,
  CheckpointHistoryDto,
  GetCheckpointHistoryRequest,
  StoryBibleDto,
  ArchitectBoardDto,
  WorkspaceProjectContextDto,
  GetTaskCenterRequest,
  TaskCenterSnapshotDto,
  LegacyOutlineDto,
  PreservationManifestDto,
  OutlineGenerationProgressDto,
} from './query-messages.js';
import type { WorkflowSnapshotResponse, GetWorkflowSnapshotRequest, WorkflowCommand, WorkflowAssetQuery, WorkflowAssetResponse, WorkflowIssuesQuery, WorkflowIssuesResponse } from './workflow-messages.js';

/** 订阅解除函数。 */
export type Unsubscribe = () => void;

/** 暴露给 Renderer 的受限桥 API 契约。 */
export interface NovelAgentBridge {
  /** 取章节树（真读盘）。 */
  getChapterTree(): Promise<ChapterTreeDto>;
  /** 取当前工作区项目身份，不暴露本地路径。 */
  getWorkspaceProject(): Promise<WorkspaceProjectContextDto>;
  /** 以节点 id 取正文。 */
  getChapterContent(request: GetChapterContentRequest): Promise<ChapterContentDto>;
  /** 发送前端命令（召唤/中断等）。 */
  sendCommand(command: FrontendCommandMessage): void;
  /** 订阅后端对话流式消息。 */
  onDialogueStream(listener: (message: BackendStreamMessage) => void): Unsubscribe;
  /** 订阅后端正文流式消息。 */
  onManuscriptStream(listener: (message: BackendStreamMessage) => void): Unsubscribe;
  /** 订阅后端控制事件（挂起裁决/纠偏/冲突等，与内容流分离）。 */
  onControlEvent(listener: (event: BackendControlEvent) => void): Unsubscribe;
  /** 订阅自动模型任务的结构化活动；该记录与专家对话历史完全分离。 */
  onModelTaskEvent(listener: (event: BackendModelTaskEvent) => void): Unsubscribe;
  /** 订阅所有业务任务的作者可读活动与工作区效果。 */
  onTaskActivityEvent(listener: (event: BackendTaskActivityEvent) => void): Unsubscribe;
  /** 取 checkpoint 历史链（time-travel）。 */
  getCheckpointHistory(request?: GetCheckpointHistoryRequest): Promise<CheckpointHistoryDto>;
  /** 取当前 Story Bible 事实视图（只读 DTO）。 */
  getStoryBible(): Promise<StoryBibleDto>;
  /** 取 architect 架构看板视图（只读投影 DTO：时间线轴/情节线/人设集）。 */
  getArchitectBoard(): Promise<ArchitectBoardDto>;
  /** 取持久化任务中心快照，用于启动和重连恢复。 */
  getTaskCenter(request?: GetTaskCenterRequest): Promise<TaskCenterSnapshotDto>;
  getWorkflowSnapshot(request: GetWorkflowSnapshotRequest): Promise<WorkflowSnapshotResponse>;
  getActiveWorkflow(projectId: string): Promise<WorkflowSnapshotResponse>;
  getWorkflowAsset(request: WorkflowAssetQuery): Promise<WorkflowAssetResponse>;
  getWorkflowIssues(request: WorkflowIssuesQuery): Promise<WorkflowIssuesResponse>;
  sendWorkflowCommand(command: WorkflowCommand): Promise<WorkflowSnapshotResponse>;
  /** 取老书整理的最新旧稿大纲。 */
  getLegacyOutline(projectId: string): Promise<LegacyOutlineDto | undefined>;
  /** 取老书整理的保留内容清单。 */
  getPreservationManifest(projectId: string): Promise<PreservationManifestDto | undefined>;
  /** 取大纲生成进度。 */
  getOutlineGenerationProgress(projectId: string): Promise<OutlineGenerationProgressDto>;
}
