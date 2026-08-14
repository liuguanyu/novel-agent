import type {
  BackendControlEvent,
  BackendModelTaskEvent,
  BackendStreamMessage,
  BackendTaskActivityEvent,
  Unsubscribe,
} from '../../shared/ipc/index.js';

type Listener<T> = (event: T) => void;

interface ChannelBus<T> {
  subscribe(listener: Listener<T>): Unsubscribe;
  dispose(): void;
}

/**
 * Renderer 侧 IPC 事件总线：每个 preload 订阅通道只建立一个真实 ipcRenderer listener，
 * 再在 Renderer 内部分发给各 Hook，避免长时间使用时同一 Electron channel 累积过多 listener。
 */
function createChannelBus<T>(connect: (dispatch: Listener<T>) => Unsubscribe): ChannelBus<T> {
  const listeners = new Set<Listener<T>>();
  let upstream: Unsubscribe | undefined;

  const dispatch = (event: T): void => {
    for (const listener of [...listeners]) listener(event);
  };

  const ensureConnected = (): void => {
    if (upstream !== undefined) return;
    upstream = connect(dispatch);
  };

  const disconnectIfIdle = (): void => {
    if (listeners.size > 0 || upstream === undefined) return;
    upstream();
    upstream = undefined;
  };

  return {
    subscribe(listener: Listener<T>): Unsubscribe {
      listeners.add(listener);
      ensureConnected();
      return () => {
        listeners.delete(listener);
        disconnectIfIdle();
      };
    },
    dispose(): void {
      listeners.clear();
      if (upstream !== undefined) {
        upstream();
        upstream = undefined;
      }
    },
  };
}

const controlBus = createChannelBus<BackendControlEvent>((dispatch) => window.novelAgent.onControlEvent(dispatch));
const dialogueBus = createChannelBus<BackendStreamMessage>((dispatch) => window.novelAgent.onDialogueStream(dispatch));
const manuscriptBus = createChannelBus<BackendStreamMessage>((dispatch) => window.novelAgent.onManuscriptStream(dispatch));
const modelTaskBus = createChannelBus<BackendModelTaskEvent>((dispatch) => window.novelAgent.onModelTaskEvent(dispatch));
const taskActivityBus = createChannelBus<BackendTaskActivityEvent>((dispatch) => window.novelAgent.onTaskActivityEvent(dispatch));

export function subscribeControlEvent(listener: Listener<BackendControlEvent>): Unsubscribe {
  return controlBus.subscribe(listener);
}

export function subscribeDialogueStream(listener: Listener<BackendStreamMessage>): Unsubscribe {
  return dialogueBus.subscribe(listener);
}

export function subscribeManuscriptStream(listener: Listener<BackendStreamMessage>): Unsubscribe {
  return manuscriptBus.subscribe(listener);
}

export function subscribeModelTaskEvent(listener: Listener<BackendModelTaskEvent>): Unsubscribe {
  return modelTaskBus.subscribe(listener);
}

export function subscribeTaskActivityEvent(listener: Listener<BackendTaskActivityEvent>): Unsubscribe {
  return taskActivityBus.subscribe(listener);
}

export function disposeRendererIpcEventBuses(): void {
  controlBus.dispose();
  dialogueBus.dispose();
  manuscriptBus.dispose();
  modelTaskBus.dispose();
  taskActivityBus.dispose();
}
