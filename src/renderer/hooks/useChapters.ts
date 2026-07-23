/**
 * 章节树与正文读取 hook (walking-skeleton task 6.1)
 *
 * 经 window.novelAgent 桥取真实章节树与选中章正文。Renderer 仅渲染，读盘在 Main。
 */

import { useCallback, useEffect, useState } from 'react';
import type { ChapterTreeDto } from '../../shared/ipc/index.js';

export interface UseChaptersResult {
  tree: ChapterTreeDto | undefined;
  selectedNodeId: string | undefined;
  content: string;
  loadingContent: boolean;
  error: string | undefined;
  selectChapter(nodeId: string): void;
}

export function useChapters(): UseChaptersResult {
  const [tree, setTree] = useState<ChapterTreeDto | undefined>(undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [content, setContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
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

  const selectChapter = useCallback((nodeId: string): void => {
    setSelectedNodeId(nodeId);
    setLoadingContent(true);
    setError(undefined);
    window.novelAgent
      .getChapterContent({ nodeId })
      .then((dto) => {
        setContent(dto.content);
        setLoadingContent(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoadingContent(false);
      });
  }, []);

  return { tree, selectedNodeId, content, loadingContent, error, selectChapter };
}
