/**
 * 章节树与正文读取 hook (walking-skeleton task 6.1)
 *
 * 经 window.novelAgent 桥取真实章节树与选中章正文。Renderer 仅渲染，读盘在 Main。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChapterTreeDto } from '../../shared/ipc/index.js';

export interface UseChaptersResult {
  projectId: string | undefined;
  tree: ChapterTreeDto | undefined;
  selectedNodeId: string | undefined;
  /** 当前 content 实际所属章节；加载期间为空，防止旧正文被当作目标章节。 */
  contentNodeId: string | undefined;
  content: string;
  loadingContent: boolean;
  error: string | undefined;
  selectChapter(nodeId: string): Promise<void>;
}

export function useChapters(): UseChaptersResult {
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [tree, setTree] = useState<ChapterTreeDto | undefined>(undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [contentNodeId, setContentNodeId] = useState<string | undefined>(undefined);
  const [content, setContent] = useState<string>('');
  const contentRequestId = useRef(0);
  const loadedNodeId = useRef<string | undefined>(undefined);
  const [loadingContent, setLoadingContent] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    window.novelAgent.getWorkspaceProject().then((context) => {
      if (!cancelled) setProjectId(context.projectId);
    }).catch(() => {
      if (!cancelled) setProjectId(undefined);
    });
    window.novelAgent
      .getChapterTree()
      .then((dto) => {
        if (!cancelled) setTree(dto);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectChapter = useCallback(async (nodeId: string): Promise<void> => {
    if (loadedNodeId.current === nodeId) {
      setSelectedNodeId(nodeId);
      return;
    }
    const requestId = contentRequestId.current + 1;
    contentRequestId.current = requestId;
    setSelectedNodeId(nodeId);
    loadedNodeId.current = undefined;
    setContentNodeId(undefined);
    setContent('');
    setLoadingContent(true);
    setError(undefined);
    try {
      const dto = await window.novelAgent.getChapterContent({ nodeId });
      if (contentRequestId.current !== requestId) throw new Error('章节切换已被新的操作替代');
      loadedNodeId.current = nodeId;
      setContent(dto.content);
      setContentNodeId(nodeId);
      setLoadingContent(false);
    } catch (err: unknown) {
      if (contentRequestId.current === requestId) {
        setError(err instanceof Error ? err.message : String(err));
        setLoadingContent(false);
      }
      throw err;
    }
  }, []);

  return { projectId, tree, selectedNodeId, contentNodeId, content, loadingContent, error, selectChapter };
}
