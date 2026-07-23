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
  type BackendStreamMessage,
  type FrontendCommandMessage,
  type ChapterTreeDto,
  type ChapterContentDto,
  type CheckpointHistoryDto,
  type GetCheckpointHistoryRequest,
  type GetChapterContentRequest,
  type StoryBibleDto,
  type ArchitectBoardDto,
  type NovelAgentBridge,
  type Unsubscribe,
} from '../shared/ipc/index.js';

/** 暴露给 Renderer 的受限桥 API。 */
const api: NovelAgentBridge = {
  /** 取章节树（真读盘，Main 侧 handle）。 */
  getChapterTree(): Promise<ChapterTreeDto> {
    return ipcRenderer.invoke(QUERY_CHANNELS.getChapterTree) as Promise<ChapterTreeDto>;
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
};

contextBridge.exposeInMainWorld('novelAgent', api);
