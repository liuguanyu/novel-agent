/**
 * 故事资产 hook — 管理故事资产快照的加载、提炼和确认 (Roadmap M2)
 *
 * 通过 window.novelAgent 桥查询快照、发送提炼/确认命令，
 * 并通过 subscribeControlEvent 订阅提炼开始/完成/失败事件。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeControlEvent } from '../lib/ipc-event-bus.js';
import type {
  StoryAssetSnapshotDto,
  BackendControlEvent,
} from '../../shared/ipc/index.js';

export interface UseStoryAssetsResult {
  /** 故事资产快照 */
  snapshot: StoryAssetSnapshotDto | undefined;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否正在提炼 */
  extracting: boolean;
  /** 错误信息 */
  error: string | undefined;
  /** 提炼故事资产 */
  extractAssets(): void;
  /** 确认资产条目（draft → confirmed） */
  confirmAsset(assetKind: 'plotThread' | 'character' | 'relation' | 'arc' | 'foreshadowing', assetId: string): void;
  /** 重新加载快照 */
  refresh(): Promise<void>;
}

let runIdCounter = 0;

function nextRunId(): string {
  runIdCounter += 1;
  return `ui-story-asset-${runIdCounter}-${Date.now()}`;
}

export function useStoryAssets(projectId: string | undefined): UseStoryAssetsResult {
  const [snapshot, setSnapshot] = useState<StoryAssetSnapshotDto | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [extracting, setExtracting] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const activeRunIdRef = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (projectId === undefined) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await window.novelAgent.getStoryAssetSnapshot(projectId);
      setSnapshot(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // 初始加载
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 订阅控制事件
  useEffect(() => {
    const off = subscribeControlEvent((event: BackendControlEvent) => {
      if (event.type === 'story-asset-extraction-started' && event.runId === activeRunIdRef.current) {
        setExtracting(true);
        return;
      }
      if (event.type === 'story-asset-extraction-completed' && event.runId === activeRunIdRef.current) {
        setExtracting(false);
        setSnapshot(event.snapshot);
        setError(undefined);
        return;
      }
      if (event.type === 'story-asset-extraction-failed' && event.runId === activeRunIdRef.current) {
        setExtracting(false);
        setError(event.error);
        return;
      }
      if (event.type === 'story-asset-confirmed') {
        void refresh();
        return;
      }
    });
    return off;
  }, [refresh]);

  const extractAssets = useCallback(() => {
    if (projectId === undefined) return;
    const runId = nextRunId();
    activeRunIdRef.current = runId;
    setExtracting(true);
    setError(undefined);
    window.novelAgent.sendCommand({
      type: 'extract-story-assets',
      runId,
      projectId,
    });
  }, [projectId]);

  const confirmAsset = useCallback(
    (assetKind: 'plotThread' | 'character' | 'relation' | 'arc' | 'foreshadowing', assetId: string) => {
      if (projectId === undefined) return;
      const runId = nextRunId();
      window.novelAgent.sendCommand({
        type: 'confirm-story-asset',
        runId,
        projectId,
        assetKind,
        assetId,
      });
    },
    [projectId],
  );

  return {
    snapshot,
    loading,
    extracting,
    error,
    extractAssets,
    confirmAsset,
    refresh,
  };
}
