/**
 * 老书整理 v2 — 前端状态管理 hook
 *
 * 通过 window.novelAgent 桥查询大纲/保留清单，
 * 并通过 sendCommand 下发保留/取消保留/生成大纲等命令。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LegacyOutlineDto,
  PreservationManifestDto,
  OutlineGenerationProgressDto,
} from '../../shared/ipc/index.js';

export interface UseLegacyOrganizationResult {
  /** 旧稿大纲 */
  outline: LegacyOutlineDto | undefined;
  /** 保留内容清单 */
  manifest: PreservationManifestDto | undefined;
  /** 大纲生成进度 */
  progress: OutlineGenerationProgressDto | undefined;
  /** 是否正在加载大纲/清单 */
  loading: boolean;
  /** 错误信息 */
  error: string | undefined;
  /** 开始生成大纲 */
  generateOutline(): void;
  /** 识别本章情节候选 */
  recognizeChapterPlots(chapterNodeId: string): void;
  /** 依次识别所有尚无情节候选的章节。 */
  recognizeBookPlots(): void;
  /** 人工新增情节候选 */
  addOutlinePlot(chapterNodeId: string, title: string, summary: string): void;
  /** 编辑情节候选 */
  updateOutlinePlot(plotNodeId: string, title: string, summary: string): void;
  /** 调整重写情节线顺序，不改变原文章节归属。 */
  moveOutlinePlot(plotNodeId: string, direction: 'up' | 'down'): void;
  /** 删除未保留情节候选 */
  deleteOutlinePlot(plotNodeId: string): void;
  /** 从回收站恢复情节候选 */
  restoreDeletedPlot(plotNodeId: string): void;
  updateCrossChapterIssue(issueId: string, status: 'open' | 'confirmed' | 'resolved' | 'dismissed', authorNote?: string): void;
  addCrossChapterIssue(input: {
    plotNodeIds: ReadonlyArray<string>;
    kind: 'timeline' | 'character-state' | 'causality' | 'duplicate-event' | 'continuity' | 'other';
    severity: 'low' | 'medium' | 'high' | 'unknown';
    description: string;
    evidence: ReadonlyArray<string>;
    authorNote?: string;
  }): void;
  /** 保留情节 */
  preservePlot(outlineNodeId: string, authorNote?: string): void;
  /** 取消保留情节 */
  unpreservePlot(plotId: string): void;
  /** 保留原文 */
  preserveQuote(text: string, sourceNodeId: string, sourceChapterTitle: string, outlineNodeId?: string, authorNote?: string): void;
  /** 取消保留原文 */
  unpreserveQuote(quoteId: string): void;
  /** 更新备注 */
  updateNote(itemId: string, kind: 'plot' | 'quote', note: string): void;
  /** 保存某情节的参谋讨论记录 */
  saveAdvisorConversation(plotNodeId: string, turns: ReadonlyArray<{ question: string; advice: string; options: ReadonlyArray<string>; askedAt: string }>): void;
  /** 清空某情节的参谋讨论记录 */
  clearAdvisorConversation(plotNodeId: string): void;
  /** 发起全书诊断 */
  diagnoseBook(): void;
  /** 重新加载大纲和清单 */
  refresh(): Promise<void>;
}

let runIdCounter = 0;

function nextRunId(): string {
  runIdCounter += 1;
  return `ui-legacy-org-${runIdCounter}-${Date.now()}`;
}

export function useLegacyOrganization(projectId: string | undefined): UseLegacyOrganizationResult {
  const [outline, setOutline] = useState<LegacyOutlineDto | undefined>(undefined);
  const [manifest, setManifest] = useState<PreservationManifestDto | undefined>(undefined);
  const [progress, setProgress] = useState<OutlineGenerationProgressDto | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (projectId === undefined) return;
    setLoading(true);
    setError(undefined);
    try {
      const [outlineResult, manifestResult, progressResult] = await Promise.all([
        window.novelAgent.getLegacyOutline(projectId),
        window.novelAgent.getPreservationManifest(projectId),
        window.novelAgent.getOutlineGenerationProgress(projectId),
      ]);
      setOutline(outlineResult);
      setManifest(manifestResult);
      setProgress(progressResult);
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

  // 生成中轮询进度
  useEffect(() => {
    if (progress !== undefined && (progress.status === 'reading' || progress.status === 'structuring' || progress.status === 'analyzing')) {
      pollRef.current = setInterval(() => {
        void refresh();
      }, 2000);
      return () => {
        if (pollRef.current !== undefined) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
        }
      };
    }
    return undefined;
  }, [progress?.status, refresh]);

  const generateOutline = useCallback(() => {
    if (projectId === undefined) return;
    const runId = nextRunId();
    window.novelAgent.sendCommand({
      type: 'generate-legacy-outline',
      runId,
      projectId,
    });
    // 给后端一点时间写入进度，然后轮询
    setTimeout(() => {
      void refresh();
    }, 500);
  }, [projectId, refresh]);

  const recognizeChapterPlots = useCallback(
    (chapterNodeId: string) => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({ type: 'recognize-chapter-plots', runId: nextRunId(), projectId, chapterNodeId });
      setProgress({ status: 'analyzing', chaptersRead: 0, totalChapters: 1, error: undefined });
      setTimeout(() => void refresh(), 300);
    },
    [projectId, refresh],
  );

  const recognizeBookPlots = useCallback(() => {
    if (projectId === undefined) return;
    window.novelAgent.sendCommand({ type: 'recognize-book-plots', runId: nextRunId(), projectId });
    setProgress({ status: 'analyzing', chaptersRead: 0, totalChapters: undefined, error: undefined });
    setTimeout(() => void refresh(), 300);
  }, [projectId, refresh]);

  const addOutlinePlot = useCallback(
    (chapterNodeId: string, title: string, summary: string) => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({ type: 'add-outline-plot', runId: nextRunId(), projectId, chapterNodeId, title, summary });
      setTimeout(() => void refresh(), 300);
    },
    [projectId, refresh],
  );

  const updateOutlinePlot = useCallback(
    (plotNodeId: string, title: string, summary: string) => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({ type: 'update-outline-plot', runId: nextRunId(), projectId, plotNodeId, title, summary });
      setTimeout(() => void refresh(), 300);
    },
    [projectId, refresh],
  );

  const moveOutlinePlot = useCallback(
    (plotNodeId: string, direction: 'up' | 'down') => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({ type: 'move-outline-plot', runId: nextRunId(), projectId, plotNodeId, direction });
      setTimeout(() => void refresh(), 300);
    },
    [projectId, refresh],
  );

  const deleteOutlinePlot = useCallback(
    (plotNodeId: string) => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({ type: 'delete-outline-plot', runId: nextRunId(), projectId, plotNodeId });
      setTimeout(() => void refresh(), 300);
    },
    [projectId, refresh],
  );

  const restoreDeletedPlot = useCallback(
    (plotNodeId: string) => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({ type: 'restore-deleted-plot', runId: nextRunId(), projectId, plotNodeId });
      setTimeout(() => void refresh(), 300);
    },
    [projectId, refresh],
  );

  const addCrossChapterIssue = useCallback(
    (input: {
      plotNodeIds: ReadonlyArray<string>;
      kind: 'timeline' | 'character-state' | 'causality' | 'duplicate-event' | 'continuity' | 'other';
      severity: 'low' | 'medium' | 'high' | 'unknown';
      description: string;
      evidence: ReadonlyArray<string>;
      authorNote?: string;
    }) => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({ type: 'add-cross-chapter-issue', runId: nextRunId(), projectId, ...input });
      setTimeout(() => void refresh(), 300);
    },
    [projectId, refresh],
  );

  const updateCrossChapterIssue = useCallback(
    (issueId: string, status: 'open' | 'confirmed' | 'resolved' | 'dismissed', authorNote?: string) => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({
        type: 'update-cross-chapter-issue',
        runId: nextRunId(),
        projectId,
        issueId,
        status,
        ...(authorNote === undefined ? {} : { authorNote }),
      });
      setTimeout(() => void refresh(), 300);
    },
    [projectId, refresh],
  );

  const preservePlot = useCallback(
    (outlineNodeId: string, authorNote?: string) => {
      if (projectId === undefined) return;
      const runId = nextRunId();
      window.novelAgent.sendCommand({
        type: 'preserve-plot',
        runId,
        projectId,
        outlineNodeId,
        authorNote,
      });
      // 乐观更新后刷新
      setTimeout(() => {
        void refresh();
      }, 300);
    },
    [projectId, refresh],
  );

  const unpreservePlot = useCallback(
    (plotId: string) => {
      if (projectId === undefined) return;
      const runId = nextRunId();
      window.novelAgent.sendCommand({
        type: 'unpreserve-plot',
        runId,
        projectId,
        plotId,
      });
      setTimeout(() => {
        void refresh();
      }, 300);
    },
    [projectId, refresh],
  );

  const preserveQuote = useCallback(
    (text: string, sourceNodeId: string, sourceChapterTitle: string, outlineNodeId?: string, authorNote?: string) => {
      if (projectId === undefined) return;
      const runId = nextRunId();
      window.novelAgent.sendCommand({
        type: 'preserve-quote',
        runId,
        projectId,
        text,
        sourceNodeId,
        sourceChapterTitle,
        outlineNodeId,
        authorNote,
      });
      setTimeout(() => {
        void refresh();
      }, 300);
    },
    [projectId, refresh],
  );

  const unpreserveQuote = useCallback(
    (quoteId: string) => {
      if (projectId === undefined) return;
      const runId = nextRunId();
      window.novelAgent.sendCommand({
        type: 'unpreserve-quote',
        runId,
        projectId,
        quoteId,
      });
      setTimeout(() => {
        void refresh();
      }, 300);
    },
    [projectId, refresh],
  );

  const updateNote = useCallback(
    (itemId: string, kind: 'plot' | 'quote', note: string) => {
      if (projectId === undefined) return;
      const runId = nextRunId();
      window.novelAgent.sendCommand({
        type: 'update-preservation-note',
        runId,
        projectId,
        itemId,
        kind,
        note,
      });
      setTimeout(() => {
        void refresh();
      }, 300);
    },
    [projectId, refresh],
  );

  const saveAdvisorConversation = useCallback(
    (plotNodeId: string, turns: ReadonlyArray<{ question: string; advice: string; options: ReadonlyArray<string>; askedAt: string }>) => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({
        type: 'save-advisor-conversation',
        runId: nextRunId(),
        projectId,
        plotNodeId,
        turns,
      });
    },
    [projectId],
  );

  const clearAdvisorConversation = useCallback(
    (plotNodeId: string) => {
      if (projectId === undefined) return;
      window.novelAgent.sendCommand({
        type: 'clear-advisor-conversation',
        runId: nextRunId(),
        projectId,
        plotNodeId,
      });
      setTimeout(() => void refresh(), 300);
    },
    [projectId, refresh],
  );

  const diagnoseBook = useCallback(() => {
    if (projectId === undefined) return;
    window.novelAgent.sendCommand({
      type: 'diagnose-legacy-book',
      runId: nextRunId(),
      projectId,
    });
  }, [projectId]);

  return {
    outline,
    manifest,
    progress,
    loading,
    error,
    generateOutline,
    recognizeChapterPlots,
    recognizeBookPlots,
    addOutlinePlot,
    updateOutlinePlot,
    moveOutlinePlot,
    deleteOutlinePlot,
    restoreDeletedPlot,
    addCrossChapterIssue,
    updateCrossChapterIssue,
    preservePlot,
    unpreservePlot,
    preserveQuote,
    unpreserveQuote,
    updateNote,
    saveAdvisorConversation,
    clearAdvisorConversation,
    diagnoseBook,
    refresh,
  };
}
