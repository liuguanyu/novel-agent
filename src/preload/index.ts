/**
 * Preload（受限强类型 IPC 桥，walking-skeleton tasks 4.1, 4.2）
 *
 * 经 contextBridge 暴露**受限**收发 API：invoke 三个查询通道、send 命令（FrontendCommandMessage）、
 * on 订阅后端流式消息（BackendStreamMessage）与控制事件（BackendControlEvent）。
 * MUST NOT 暴露原始 ipcRenderer / 任意通道 / Node·Electron 能力。下行 unknown 由 Renderer 侧按判别联合收窄。
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_CHANNELS,
  QUERY_CHANNELS,
  type BackendControlEvent,
  type BackendModelTaskEvent,
  type BackendTaskActivityEvent,
  type BackendStreamMessage,
  type FrontendCommandMessage,
  type ChapterTreeDto,
  type ChapterContentDto,
  type CheckpointHistoryDto,
  type GetCheckpointHistoryRequest,
  type GetChapterContentRequest,
  type StoryBibleDto,
  type ArchitectBoardDto,
  type WorkspaceProjectContextDto,
  type GetTaskCenterRequest,
  type TaskCenterSnapshotDto,
  type LegacyOutlineDto,
  type PreservationManifestDto,
  type OutlineGenerationProgressDto,
  type StoryAssetSnapshotDto,
  type NovelAgentBridge,
  type Unsubscribe,
  WORKFLOW_QUERY_CHANNELS,
  WORKFLOW_COMMAND_CHANNEL,
  type WorkflowSnapshotResponse, type GetWorkflowSnapshotRequest, type WorkflowCommand, type WorkflowAssetQuery, type WorkflowAssetResponse, type WorkflowIssuesQuery, type WorkflowIssuesResponse,
} from '../shared/ipc/index.js';

/** 暴露给 Renderer 的受限桥 API。 */
const api: NovelAgentBridge = {
  /** 取章节树（真读盘，Main 侧 handle）。 */
  getChapterTree(): Promise<ChapterTreeDto> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getChapterTree) as Promise<ChapterTreeDto>;
  },
  getWorkspaceProject(): Promise<WorkspaceProjectContextDto> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getWorkspaceProject) as Promise<WorkspaceProjectContextDto>;
  },
  /** 以节点 id 取正文。 */
  getChapterContent(request: GetChapterContentRequest): Promise<ChapterContentDto> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getChapterContent, request) as Promise<ChapterContentDto>;
  },
  /** 取 checkpoint 历史链（time-travel）。 */
  getCheckpointHistory(request?: GetCheckpointHistoryRequest): Promise<CheckpointHistoryDto> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getCheckpointHistory, request ?? {}) as Promise<CheckpointHistoryDto>;
  },
  /** 取当前 Story Bible 事实视图（只读 DTO）。 */
  getStoryBible(): Promise<StoryBibleDto> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getStoryBible) as Promise<StoryBibleDto>;
  },
  /** 取 architect 架构看板视图（只读投影 DTO）。 */
  getArchitectBoard(): Promise<ArchitectBoardDto> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getArchitectBoard) as Promise<ArchitectBoardDto>;
  },
  getTaskCenter(request?: GetTaskCenterRequest): Promise<TaskCenterSnapshotDto> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getTaskCenter, request ?? {}) as Promise<TaskCenterSnapshotDto>;
  },
  getWorkflowSnapshot(request: GetWorkflowSnapshotRequest): Promise<WorkflowSnapshotResponse> { return ipcRenderer.invoke(WORKFLOW_QUERY_CHANNELS.snapshot, request) as Promise<WorkflowSnapshotResponse>; },
  getActiveWorkflow(projectId: string): Promise<WorkflowSnapshotResponse> { return ipcRenderer.invoke(WORKFLOW_QUERY_CHANNELS.active, projectId) as Promise<WorkflowSnapshotResponse>; },
  getWorkflowAsset(request: WorkflowAssetQuery): Promise<WorkflowAssetResponse> { return ipcRenderer.invoke(WORKFLOW_QUERY_CHANNELS.asset, request) as Promise<WorkflowAssetResponse>; },
  getWorkflowIssues(request: WorkflowIssuesQuery): Promise<WorkflowIssuesResponse> { return ipcRenderer.invoke(WORKFLOW_QUERY_CHANNELS.issues, request) as Promise<WorkflowIssuesResponse>; },
  sendWorkflowCommand(command: WorkflowCommand): Promise<WorkflowSnapshotResponse> { return ipcRenderer.invoke(WORKFLOW_COMMAND_CHANNEL, command) as Promise<WorkflowSnapshotResponse>; },
  /** 取老书整理的最新旧稿大纲。 */
  getLegacyOutline(projectId: string): Promise<LegacyOutlineDto | undefined> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getLegacyOutline, projectId) as Promise<LegacyOutlineDto | undefined>;
  },
  /** 取老书整理的保留内容清单。 */
  getPreservationManifest(projectId: string): Promise<PreservationManifestDto | undefined> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getPreservationManifest, projectId) as Promise<PreservationManifestDto | undefined>;
  },
  /** 取大纲生成进度。 */
  getOutlineGenerationProgress(projectId: string): Promise<OutlineGenerationProgressDto> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getOutlineGenerationProgress, projectId) as Promise<OutlineGenerationProgressDto>;
  },
  /** 取故事资产快照。 */
  getStoryAssetSnapshot(projectId: string): Promise<StoryAssetSnapshotDto | undefined> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getStoryAssetSnapshot, projectId) as Promise<StoryAssetSnapshotDto | undefined>;
  },
  /** 发送前端命令（召唤/中断等），经 control-event 通道上行。 */
  sendCommand(command: FrontendCommandMessage): void {
    ipcRenderer.send(IPC_CHANNELS.controlEvent, command);
  },
  /** 订阅后端对话流式消息。返回解除订阅函数。 */
  onDialogueStream(listener: (message: BackendStreamMessage) => void): Unsubscribe {
    const handler = (_event: IpcRendererEvent, message: unknown): void => {
      listener(message as BackendStreamMessage);
    };
    ipcRenderer.on(IPC_CHANNELS.dialogueStream, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.dialogueStream, handler);
  },
  /** 订阅后端正文流式消息。返回解除订阅函数。 */
  onManuscriptStream(listener: (message: BackendStreamMessage) => void): Unsubscribe {
    const handler = (_event: IpcRendererEvent, message: unknown): void => {
      listener(message as BackendStreamMessage);
    };
    ipcRenderer.on(IPC_CHANNELS.manuscriptStream, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.manuscriptStream, handler);
  },
  /** 订阅后端控制事件（挂起裁决等，同通道上行为命令、下行为事件）。返回解除订阅函数。 */
  onControlEvent(listener: (event: BackendControlEvent) => void): Unsubscribe {
    const handler = (_event: IpcRendererEvent, message: unknown): void => {
      listener(message as BackendControlEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.controlEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.controlEvent, handler);
  },
  /** 订阅自动模型任务活动。独立通道保证任务记录不会进入专家聊天或业务控制订阅。 */
  onModelTaskEvent(listener: (event: BackendModelTaskEvent) => void): Unsubscribe {
    const handler = (_event: IpcRendererEvent, message: unknown): void => {
      listener(message as BackendModelTaskEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.modelTaskEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.modelTaskEvent, handler);
  },
  onTaskActivityEvent(listener: (event: BackendTaskActivityEvent) => void): Unsubscribe {
    const handler = (_event: IpcRendererEvent, message: unknown): void => {
      listener(message as BackendTaskActivityEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.taskActivityEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.taskActivityEvent, handler);
  },
};

contextBridge.exposeInMainWorld('novelAgent', api);
