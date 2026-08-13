/**
 * 旧稿大纲整理面板
 *
 * 三栏布局：
 * - 左栏：大纲树（层级缩进：volume → plot-beat）
 * - 中栏：原稿正文（只读）
 * - 右栏：当前节点详情 + 保留操作
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  BookOpen,
  Pin,
  PinOff,
  Quote,
  Loader2,
  Play,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { Button } from './ui/button.js';
import { ScrollArea } from './ui/scroll-area.js';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable.js';
import type {
  LegacyOutlineDto,
  OutlineNodeDto,
  PreservationManifestDto,
  OutlineGenerationProgressDto,
  ChapterTreeDto,
} from '../../shared/ipc/index.js';
import { buildPlotMap, groupPlotsByCharacter } from '../../core/legacy-organization/plot-map.js';

/* ── Props ──────────────────────────────────────────────────────── */

interface LegacyOutlinePanelProps {
  projectId: string | undefined;
  tree: ChapterTreeDto | undefined;
  outline: LegacyOutlineDto | undefined;
  manifest: PreservationManifestDto | undefined;
  progress: OutlineGenerationProgressDto | undefined;
  loading: boolean;
  error: string | undefined;
  content: string;
  loadingContent: boolean;
  selectedNodeId: string | undefined;
  requestedPlotNodeId: string | undefined;
  contentNodeId: string | undefined;
  onGenerateOutline(): void;
  onRecognizeChapterPlots(chapterNodeId: string): void;
  onRecognizeBookPlots(): void;
  onAddOutlinePlot(chapterNodeId: string, title: string, summary: string): void;
  onUpdateOutlinePlot(plotNodeId: string, title: string, summary: string): void;
  onMoveOutlinePlot(plotNodeId: string, direction: 'up' | 'down'): void;
  onDeleteOutlinePlot(plotNodeId: string): void;
  onRestoreDeletedPlot(plotNodeId: string): void;
  onUpdateCrossChapterIssue(issueId: string, status: 'open' | 'confirmed' | 'resolved' | 'dismissed', authorNote?: string): void;
  onAddCrossChapterIssue(input: {
    plotNodeIds: ReadonlyArray<string>;
    kind: 'timeline' | 'character-state' | 'causality' | 'duplicate-event' | 'continuity' | 'other';
    severity: 'low' | 'medium' | 'high' | 'unknown';
    description: string;
    evidence: ReadonlyArray<string>;
    authorNote?: string;
  }): void;
  onPreservePlot(outlineNodeId: string, authorNote?: string): void;
  onUnpreservePlot(plotId: string): void;
  onPreserveQuote(text: string, sourceNodeId: string, sourceChapterTitle: string, outlineNodeId?: string, authorNote?: string): void;
  onUnpreserveQuote(quoteId: string): void;
  onSaveAdvisorConversation(plotNodeId: string, turns: ReadonlyArray<{ question: string; advice: string; options: ReadonlyArray<string>; askedAt: string }>): void;
  onClearAdvisorConversation(plotNodeId: string): void;
  onDiagnoseBook(): void;
  onSelectChapter(nodeId: string): Promise<void>;
  onRefresh(): Promise<void>;
}

/* ── 大纲树子组件 ───────────────────────────────────────────────── */

function OutlineTreeItem({
  node,
  depth,
  children,
  selectedNodeId,
  onSelect,
  onPreserve,
  onUnpreserve,
}: {
  node: OutlineNodeDto;
  depth: number;
  children: ReadonlyArray<OutlineNodeDto>;
  selectedNodeId: string | undefined;
  onSelect: (node: OutlineNodeDto) => void;
  onPreserve: (nodeId: string) => void;
  onUnpreserve: (nodeId: string) => void;
}): JSX.Element {
  const childNodes = useMemo(
    () => children.filter((c) => c.parentId === node.id).sort((a, b) => a.order - b.order),
    [children, node.id],
  );
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = childNodes.length > 0;
  const isSelected = selectedNodeId === node.id;
  const isPreserved = node.preserved;
  const canPreserve = node.kind === 'plot-beat';

  const kindLabel: Record<string, string> = {
    volume: '卷',
    arc: '篇',
    chapter: '章',
    'plot-beat': '情节',
    scene: '场',
  };

  return (
    <div>
      <div
        className={`group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm transition-colors ${
          isSelected
            ? 'bg-primary/10 font-medium text-primary'
            : 'hover:bg-muted/60 text-foreground'
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => onSelect(node)}
      >
        {/* 折叠/展开 */}
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => !prev);
            }}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="inline-block w-3 shrink-0" />
        )}

        {/* 类型标签 */}
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {kindLabel[node.kind] ?? node.kind}
        </span>

        {/* 标题 */}
        <span className="min-w-0 truncate flex-1">{node.title}</span>

        {/* 卷只是结构分组，具体情节节点才可以保留 */}
        {canPreserve && (
          <button
            type="button"
            className={`shrink-0 opacity-0 transition-opacity group-hover:opacity-100 ${
              isPreserved ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              if (isPreserved) {
                onUnpreserve(node.id);
              } else {
                onPreserve(node.id);
              }
            }}
            title={isPreserved ? `取消保留「${node.title}」` : `保留「${node.title}」这个情节`}
            aria-label={isPreserved ? `取消保留「${node.title}」` : `保留「${node.title}」这个情节`}
          >
            {isPreserved ? (
              <PinOff className="size-3" />
            ) : (
              <Pin className="size-3" />
            )}
          </button>
        )}
      </div>

      {/* 子节点 */}
      {hasChildren && expanded && (
        <div>
          {childNodes.map((child) => (
            <OutlineTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              children={children}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onPreserve={onPreserve}
              onUnpreserve={onUnpreserve}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 主组件 ─────────────────────────────────────────────────────── */

export function LegacyOutlinePanel({
  projectId: _projectId,
  tree,
  outline,
  manifest,
  progress,
  loading,
  error,
  content,
  loadingContent,
  selectedNodeId: _selectedNodeId,
  requestedPlotNodeId,
  contentNodeId,
  onGenerateOutline,
  onRecognizeChapterPlots,
  onRecognizeBookPlots,
  onAddOutlinePlot,
  onUpdateOutlinePlot,
  onMoveOutlinePlot,
  onDeleteOutlinePlot,
  onRestoreDeletedPlot,
  onAddCrossChapterIssue,
  onUpdateCrossChapterIssue,
  onPreservePlot,
  onUnpreservePlot,
  onPreserveQuote,
  onUnpreserveQuote,
  onSaveAdvisorConversation,
  onClearAdvisorConversation,
  onDiagnoseBook,
  onSelectChapter,
  onRefresh,
}: LegacyOutlinePanelProps): JSX.Element {
  const [selectedOutlineNodeId, setSelectedOutlineNodeId] = useState<string | undefined>(undefined);
  const [selectionText, setSelectionText] = useState<string | undefined>(undefined);
  const [editingPlotId, setEditingPlotId] = useState<string | undefined>(undefined);
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [newPlotTitle, setNewPlotTitle] = useState('');
  const [newPlotSummary, setNewPlotSummary] = useState('');
  const [selectedPlotIds, setSelectedPlotIds] = useState<ReadonlyArray<string>>([]);

  const [issueKind, setIssueKind] = useState<'timeline' | 'character-state' | 'causality' | 'duplicate-event' | 'continuity' | 'other'>('timeline');
  const [issueSeverity, setIssueSeverity] = useState<'low' | 'medium' | 'high' | 'unknown'>('unknown');
  const [issueDescription, setIssueDescription] = useState('');
  const [issueEvidence, setIssueEvidence] = useState('');
  const [issueAuthorNote, setIssueAuthorNote] = useState('');
  const [issueWorkbenchOpen, setIssueWorkbenchOpen] = useState(false);
  const [plotMapOpen, setPlotMapOpen] = useState(false);
  const [plotSequenceOpen, setPlotSequenceOpen] = useState(false);
  const [diagnosisCandidates, setDiagnosisCandidates] = useState<ReadonlyArray<{ kind: string; severity: string; description: string; evidence: ReadonlyArray<string>; plotNodeIds: ReadonlyArray<string> }>>([]);
  const [diagnosisBusy, setDiagnosisBusy] = useState(false);
  const [diagnosisFeedback, setDiagnosisFeedback] = useState<
    | { status: 'completed'; count: number }
    | { status: 'failed'; error: string }
    | undefined
  >(undefined);
  const [issueWorkbenchTab, setIssueWorkbenchTab] = useState<'new' | 'open' | 'resolved'>('open');
  const [advisorByPlot, setAdvisorByPlot] = useState<Record<string, {
    turns: ReadonlyArray<{ question: string; advice: string; options: ReadonlyArray<string>; askedAt: string }>;
    error?: string;
  }>>({});
  const [advisorBusyPlotId, setAdvisorBusyPlotId] = useState<string | undefined>(undefined);
  const [workbenchDecisionNotes, setWorkbenchDecisionNotes] = useState<Record<string, string>>({});
  const contentRef = useRef<HTMLDivElement>(null);

  // 从大纲加载持久化的参谋讨论记录（刷新后不丢失）。
  useEffect(() => {
    if (outline?.advisorConversations === undefined) return;
    setAdvisorByPlot((previous) => {
      const restored: typeof previous = {};
      for (const conv of outline.advisorConversations) {
        // 只恢复尚未在内存中的情节讨论，避免覆盖作者刚发起但尚未保存的新轮次。
        if (previous[conv.plotNodeId] === undefined) {
          restored[conv.plotNodeId] = { turns: conv.turns };
        }
      }
      return Object.keys(restored).length > 0 ? { ...previous, ...restored } : previous;
    });
  }, [outline?.advisorConversations]);

  // 接收当前窗口内情节参谋的结构化回复，并持久化。
  useEffect(() => {
    return window.novelAgent.onControlEvent((event) => {
      if (event.type === 'legacy-plot-advisor-completed') {
        setAdvisorBusyPlotId(undefined);
        setAdvisorByPlot((previous) => {
          const existing = previous[event.plotNodeId] ?? { turns: [] };
          const newTurns = [...existing.turns, { question: event.question, advice: event.advice, options: event.options, askedAt: new Date().toISOString() }];
          // 持久化讨论记录（与最终改写要求分开存储）。
          onSaveAdvisorConversation(event.plotNodeId, newTurns);
          return {
            ...previous,
            [event.plotNodeId]: {
              turns: newTurns,
            },
          };
        });
      } else if (event.type === 'legacy-plot-advisor-failed') {
        setAdvisorBusyPlotId(undefined);
        setAdvisorByPlot((previous) => {
          const existing = previous[event.plotNodeId] ?? { turns: [] };
          return { ...previous, [event.plotNodeId]: { ...existing, error: event.error } };
        });
      } else if (event.type === 'legacy-book-diagnosis-completed') {
        setDiagnosisBusy(false);
        setDiagnosisCandidates(event.candidates);
        setDiagnosisFeedback({ status: 'completed', count: event.candidates.length });
        setIssueWorkbenchTab('new');
        setIssueWorkbenchOpen(true);
      } else if (event.type === 'legacy-book-diagnosis-failed') {
        setDiagnosisBusy(false);
        setDiagnosisFeedback({ status: 'failed', error: event.error });
        setIssueWorkbenchOpen(true);
      }
    });
  }, []);

  // 跟踪文本选区
  useEffect(() => {
    const handleSelectionChange = (): void => {
      const sel = window.getSelection();
      if (sel !== null && sel.rangeCount > 0) {
        const text = sel.toString().trim();
        if (text.length > 0 && text.length <= 500) {
          const range = sel.getRangeAt(0);
          if (contentRef.current?.contains(range.commonAncestorContainer)) {
            setSelectionText(text);
            return;
          }
        }
      }
      setSelectionText(undefined);
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  // 大纲节点列表 (扁平，通过 parentId+order 表达树)
  const outlineNodes = outline?.nodes ?? [];

  // 根节点
  const rootNodes = useMemo(
    () => outlineNodes.filter((n) => n.parentId === undefined).sort((a, b) => a.order - b.order),
    [outlineNodes],
  );

  // 当前选中的大纲节点
  const selectedNode = useMemo(
    () => outlineNodes.find((n) => n.id === selectedOutlineNodeId),
    [outlineNodes, selectedOutlineNodeId],
  );

  // 当前大纲节点对应的来源章节
  const selectedNodeSources = useMemo(() => {
    if (selectedNode === undefined) return [];
    return selectedNode.sources;
  }, [selectedNode]);
  const selectedNodeChildren = useMemo(
    () => selectedNode === undefined ? [] : outlineNodes.filter((node) => node.parentId === selectedNode.id).sort((a, b) => a.order - b.order),
    [outlineNodes, selectedNode],
  );
  const isRecognizingPlots = progress?.status === 'analyzing';
  const recognitionError = progress?.status === 'failed' ? progress.error : undefined;

  // 保留内容摘要
  const preservedCounts = useMemo(() => {
    return {
      plots: manifest?.plots.length ?? 0,
      quotes: manifest?.quotes.length ?? 0,
    };
  }, [manifest]);

  // 处理保留原文
  const handlePreserveQuote = useCallback(() => {
    if (selectionText === undefined || contentNodeId === undefined) return;
    // 查找来源章节标题
    const chapterNode = findChapterNode(tree, contentNodeId);
    const chapterTitle = chapterNode?.title ?? '';
    onPreserveQuote(selectionText, contentNodeId, chapterTitle, selectedOutlineNodeId);
    setSelectionText(undefined);
  }, [selectionText, contentNodeId, selectedOutlineNodeId, onPreserveQuote, tree]);

  // 点击大纲节点时，跳转到对应原稿章节
  const handleSelectOutlineNode = useCallback(
    (node: OutlineNodeDto) => {
      setSelectedOutlineNodeId(node.id);
      // 如果有来源章节，跳转到第一个来源
      if (node.sources.length > 0) {
        const firstSource = node.sources[0];
        if (firstSource !== undefined) {
          void onSelectChapter(firstSource.nodeId);
        }
      }
    },
    [onSelectChapter],
  );

  useEffect(() => {
    if (requestedPlotNodeId === undefined) return;
    const requestedNode = outlineNodes.find((node) => node.id === requestedPlotNodeId && node.kind === 'plot-beat');
    if (requestedNode !== undefined) handleSelectOutlineNode(requestedNode);
  }, [requestedPlotNodeId, outlineNodes, handleSelectOutlineNode]);

  // 处理保留情节（点击保留按钮时找到对应的 manifest plot id 来取消）
  const handlePreserveWithNote = useCallback(
    (nodeId: string) => {
      onPreservePlot(nodeId);
    },
    [onPreservePlot],
  );

  // 处理取消保留情节（需要找到对应的 plot id）
  const handleUnpreservePlotById = useCallback(
    (nodeId: string) => {
      const plot = manifest?.plots.find((p) => p.outlineNodeId === nodeId);
      if (plot !== undefined) {
        onUnpreservePlot(plot.id);
      }
    },
    [manifest, onUnpreservePlot],
  );

  // 状态渲染
  if (loading && outline === undefined && progress === undefined) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        载入中…
      </div>
    );
  }

  if (error !== undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="size-3" />
          重试
        </Button>
      </div>
    );
  }

  // 未生成大纲的空态
  if (outline === undefined) {
    const isGenerating = progress !== undefined && progress.status !== 'idle' && progress.status !== 'failed' && progress.status !== 'completed';
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <BookOpen className="size-12 text-muted-foreground/40" />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">尚未生成旧稿大纲</p>
          <p className="mt-1 text-xs text-muted-foreground">
            从当前书稿章节树自动提取大纲结构
          </p>
        </div>
        {isGenerating ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>
              {progress?.status === 'reading' && '正在读取章节…'}
              {progress?.status === 'structuring' && '正在构建大纲…'}
              {progress?.status === 'analyzing' && '正在分析内容…'}
            </span>
            {progress?.totalChapters !== undefined && (
              <span className="text-xs">
                {progress.chaptersRead ?? 0}/{progress.totalChapters}
              </span>
            )}
          </div>
        ) : (
          <Button onClick={onGenerateOutline} disabled={tree === undefined}>
            <Play className="size-4" />
            生成大纲
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部工具栏 */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">旧稿大纲</span>
          <span>·</span>
          <span>{outline.nodes.length} 个节点</span>
          <span>·</span>
          <span>{preservedCounts.plots} 处保留情节</span>
          {(outline.deletedPlots?.length ?? 0) > 0 && <><span>·</span><span className="text-amber-600">回收站 {outline.deletedPlots?.length}</span></>}
          {(outline.crossChapterIssues?.filter((issue) => issue.status === 'open' || issue.status === 'confirmed').length ?? 0) > 0 && <><span>·</span><button type="button" className="text-destructive underline underline-offset-2" onClick={() => setIssueWorkbenchOpen(true)}>贯穿问题 {outline.crossChapterIssues?.filter((issue) => issue.status === 'open' || issue.status === 'confirmed').length}</button></>}
          {preservedCounts.quotes > 0 && (
            <>
              <span>·</span>
              <span>{preservedCounts.quotes} 处原文</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={progress?.status === 'analyzing'} onClick={onRecognizeBookPlots}>
            {progress?.status === 'analyzing' && progress.totalChapters !== 1 && <Loader2 className="size-3 animate-spin" />}
            {progress?.status === 'analyzing' && progress.totalChapters !== 1 ? '识别全书中…' : '识别全书情节'}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPlotSequenceOpen(true)}>整理情节线</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPlotMapOpen(true)}>情节地图</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIssueWorkbenchOpen(true)}>贯穿问题</Button>
          <Button variant="ghost" size="sm" onClick={onRefresh} title="刷新">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </header>

      {progress?.status === 'analyzing' && progress.totalChapters !== 1 && (
        <div className="shrink-0 border-b border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-700">
          正在识别 {progress.currentChapterTitle ?? '全书情节'}
          {progress.totalChapters !== undefined ? ` · 已完成章节 ${progress.chaptersRead ?? 0}/${progress.totalChapters}` : ''}
          {progress.totalSegments !== undefined && progress.totalSegments > 1 ? ` · 本章分段 ${progress.currentSegment ?? 0}/${progress.totalSegments}` : ''}
        </div>
      )}
      {progress?.status === 'completed' && (progress.failedChapters?.length ?? 0) > 0 && (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700">
          全书识别已完成 {progress.chaptersRead ?? 0}/{progress.totalChapters ?? 0} 章；{progress.failedChapters?.length ?? 0} 章失败。再次点击“识别全书情节”会只重试尚无结果的章节。
        </div>
      )}

      {(outline.deletedPlots?.length ?? 0) > 0 && (
        <details className="shrink-0 border-b border-border bg-muted/20 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-foreground">回收站 · 已删除情节候选（可恢复）</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {outline.deletedPlots?.map((item) => (
              <span key={item.node.id} className="inline-flex items-center gap-1 rounded border border-dashed border-border bg-background px-2 py-1">
                <span className="max-w-48 truncate">{item.node.title}</span>
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px]" onClick={() => onRestoreDeletedPlot(item.node.id)}>恢复</Button>
              </span>
            ))}
          </div>
        </details>
      )}

      {plotSequenceOpen && outline !== undefined && (() => {
        const nodeById = new Map(outline.nodes.map((node) => [node.id, node]));
        const sequence = outline.plotSequence.map((id) => nodeById.get(id)).filter((node): node is OutlineNodeDto => node?.kind === 'plot-beat');
        const chapterById = new Map(outline.nodes.filter((node) => node.kind === 'chapter').map((node) => [node.id, node]));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <div className="flex h-[82vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-background shadow-xl">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
                <div>
                  <h2 className="text-base font-semibold">整理重写情节线</h2>
                  <p className="mt-1 text-xs text-muted-foreground">这里的顺序将作为新大纲的主输入。章节名可以重复，系统按稳定节点 ID 区分；移动情节不会修改原文或来源章节。</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPlotSequenceOpen(false)}>关闭</Button>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <ol className="space-y-1.5 p-4">
                  {sequence.length === 0 ? (
                    <li className="rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">尚无情节。请先识别全书情节。</li>
                  ) : sequence.map((plot, index) => {
                    const chapter = plot.parentId === undefined ? undefined : chapterById.get(plot.parentId);
                    return (
                      <li key={plot.id} className="flex items-start gap-2 rounded-md border border-border p-2">
                        <span className="w-8 shrink-0 pt-1 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{plot.title}</div>
                          {plot.summary.length > 0 && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{plot.summary}</p>}
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">原文来源：{chapter?.title ?? plot.sources[0]?.label ?? '未归属章节'}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={index === 0} onClick={() => onMoveOutlinePlot(plot.id, 'up')} title="在情节线中上移"><ArrowUp className="size-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={index === sequence.length - 1} onClick={() => onMoveOutlinePlot(plot.id, 'down')} title="在情节线中下移"><ArrowDown className="size-3.5" /></Button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </ScrollArea>
            </div>
          </div>
        );
      })()}

      {plotMapOpen && outline !== undefined && (() => {
        const map = buildPlotMap(outline as unknown as Parameters<typeof buildPlotMap>[0]);
        const characterGroups = groupPlotsByCharacter(map);
        const plotTitleById = new Map(map.nodes.map((n) => [n.plotNodeId, n.title]));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <div className="flex h-[82vh] w-full max-w-5xl flex-col rounded-lg border border-border bg-background shadow-xl">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
                <div><h2 className="text-base font-semibold">情节地图</h2><p className="mt-1 text-xs text-muted-foreground">全书情节按章节归属、人物关联和贯穿问题组织；只读视图，不修改任何数据。</p></div>
                <Button variant="ghost" size="sm" onClick={() => setPlotMapOpen(false)}>关闭</Button>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-4">
                  {/* 按章节分组的情节 */}
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">按章节归属</h3>
                    <div className="space-y-2">
                      {map.chapters.map((ch) => (
                        <div key={ch.chapterNodeId} className="rounded-md border border-border p-2">
                          <button type="button" className="text-sm font-medium hover:underline" onClick={() => void onSelectChapter(ch.chapterNodeId)}>{ch.chapterTitle}</button>
                          {ch.plotNodeIds.length === 0 ? (
                            <span className="ml-2 text-xs text-muted-foreground">无情节</span>
                          ) : (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {ch.plotNodeIds.map((pid) => {
                                const node = map.nodes.find((n) => n.plotNodeId === pid);
                                return (
                                  <span key={pid} className={`rounded px-1.5 py-0.5 text-[11px] ${node?.preserved ? 'bg-green-500/10 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                                    {node?.crossChapter === true && '⇄ '}{node?.title ?? pid}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* 共享人物 */}
                  {characterGroups.length > 0 && (
                    <section>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">人物关联（出现在多个情节中）</h3>
                      <div className="space-y-2">
                        {characterGroups.map((group) => (
                          <div key={group.character} className="rounded-md border border-border p-2">
                            <span className="text-sm font-medium">{group.character}</span>
                            <span className="ml-2 text-xs text-muted-foreground">出现在 {group.plotNodeIds.length} 个情节中</span>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {group.plotNodeIds.map((pid) => (
                                <span key={pid} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{plotTitleById.get(pid) ?? pid}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 贯穿问题关联 */}
                  {map.links.filter((l) => l.kind === 'cross-chapter-issue').length > 0 && (
                    <section>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">贯穿问题关联</h3>
                      <div className="space-y-2">
                        {map.links.filter((l) => l.kind === 'cross-chapter-issue').map((link, idx) => (
                          <div key={`${link.issueId ?? idx}`} className="rounded-md border border-border p-2">
                            <div className="flex flex-wrap items-center gap-1 text-xs">
                              <span className="rounded bg-muted px-1.5 py-0.5">{plotTitleById.get(link.fromPlotNodeId) ?? link.fromPlotNodeId}</span>
                              <span className="text-muted-foreground">↔</span>
                              <span className="rounded bg-muted px-1.5 py-0.5">{plotTitleById.get(link.toPlotNodeId) ?? link.toPlotNodeId}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{link.description}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 跨章情节 */}
                  {map.nodes.filter((n) => n.crossChapter).length > 0 && (
                    <section>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">标记为跨章的情节</h3>
                      <div className="flex flex-wrap gap-1">
                        {map.nodes.filter((n) => n.crossChapter).map((node) => (
                          <span key={node.plotNodeId} className={`rounded px-1.5 py-0.5 text-[11px] ${node.preserved ? 'bg-green-500/10 text-green-700' : 'bg-muted text-muted-foreground'}`}>⇄ {node.title}（{node.chapterTitle}）</span>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        );
      })()}

      {issueWorkbenchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex h-[82vh] w-full max-w-5xl flex-col rounded-lg border border-border bg-background shadow-xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
              <div>
                <h2 className="text-base font-semibold">贯穿问题</h2>
                <p className="mt-1 text-xs text-muted-foreground">集中核对贯穿全书的情节关联、冲突和作者裁决；不会合并情节，也不会修改原稿。</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={diagnosisBusy} onClick={() => { setDiagnosisBusy(true); setDiagnosisCandidates([]); setDiagnosisFeedback(undefined); onDiagnoseBook(); }}>
                  {diagnosisBusy && <Loader2 className="size-3 animate-spin" />}
                  {diagnosisBusy ? '诊断中…' : diagnosisFeedback?.status === 'failed' ? '重新诊断' : '全书诊断'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setIssueWorkbenchOpen(false)}>关闭</Button>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 border-b border-border px-4 py-2">
              <Button variant={issueWorkbenchTab === 'new' ? 'default' : 'outline'} size="sm" onClick={() => setIssueWorkbenchTab('new')}>新增问题（已选 {selectedPlotIds.length}）</Button>
              <Button variant={issueWorkbenchTab === 'open' ? 'default' : 'outline'} size="sm" onClick={() => setIssueWorkbenchTab('open')}>待处理（{(outline.crossChapterIssues ?? []).filter((issue) => issue.status === 'open' || issue.status === 'confirmed').length}）</Button>
              <Button variant={issueWorkbenchTab === 'resolved' ? 'default' : 'outline'} size="sm" onClick={() => setIssueWorkbenchTab('resolved')}>已裁决（{(outline.crossChapterIssues ?? []).filter((issue) => issue.status === 'resolved' || issue.status === 'dismissed').length}）</Button>
            </div>
            {diagnosisBusy && (
              <div className="flex shrink-0 items-center gap-2 border-b border-violet-500/20 bg-violet-500/5 px-4 py-2 text-xs text-violet-700">
                <Loader2 className="size-3.5 animate-spin" />
                正在根据全书情节地图检查跨章节问题，请稍候…
              </div>
            )}
            {!diagnosisBusy && diagnosisFeedback?.status === 'completed' && (
              <div className={`shrink-0 border-b px-4 py-2 text-xs ${diagnosisFeedback.count > 0 ? 'border-violet-500/20 bg-violet-500/5 text-violet-700' : 'border-green-500/20 bg-green-500/5 text-green-700'}`}>
                {diagnosisFeedback.count > 0
                  ? `全书诊断完成：发现 ${diagnosisFeedback.count} 个候选问题，请逐项确认后再采纳。`
                  : '全书诊断完成：暂未发现明确的跨章节问题。'}
              </div>
            )}
            {!diagnosisBusy && diagnosisFeedback?.status === 'failed' && (
              <div className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>全书诊断失败：{diagnosisFeedback.error}。可点击右上角“重新诊断”。</span>
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1">
              {issueWorkbenchTab === 'new' ? (
                <div className="mx-auto max-w-3xl space-y-3 p-4">
                  {diagnosisCandidates.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-violet-700">全书诊断候选（{diagnosisCandidates.length}）</span>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setDiagnosisCandidates([])}>清除候选</Button>
                      </div>
                      {diagnosisCandidates.map((candidate, idx) => (
                        <div key={idx} className="rounded-md border border-violet-500/30 bg-violet-500/5 p-2">
                          <div className="flex flex-wrap items-center gap-1 text-[11px]"><span className="rounded bg-muted px-1.5 py-0.5">{candidate.kind}</span><span className="rounded bg-muted px-1.5 py-0.5">{candidate.severity}</span></div>
                          <p className="mt-1 text-sm">{candidate.description}</p>
                          {candidate.evidence.length > 0 && <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">{candidate.evidence.map((e, ei) => <p key={ei}>“{e}”</p>)}</div>}
                          <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">关联情节：{candidate.plotNodeIds.map((pid) => { const node = outline.nodes.find((n) => n.id === pid); return node?.title ?? pid; }).join('、')}</div>
                          <div className="mt-2 flex justify-end">
                            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => { onAddCrossChapterIssue({ plotNodeIds: candidate.plotNodeIds, kind: candidate.kind as 'timeline' | 'character-state' | 'causality' | 'duplicate-event' | 'continuity' | 'other', severity: candidate.severity as 'low' | 'medium' | 'high' | 'unknown', description: candidate.description, evidence: candidate.evidence }); setDiagnosisCandidates((prev) => prev.filter((_, i) => i !== idx)); }}>采纳为贯穿问题</Button>
                          </div>
                        </div>
                      ))}
                      <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">以上候选由模型根据全书情节自动识别，仅供参考。点击“采纳”会保存为正式贯穿问题；也可以忽略并手动新增。</div>
                    </div>
                  )}
                  <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">先在左侧/右侧情节候选中勾选至少两个情节；这里只记录关联或冲突，不会合并情节、删除候选或修改原稿。</div>
                  <label className="block text-xs">问题类型<select className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm" value={issueKind} onChange={(event) => setIssueKind(event.target.value as typeof issueKind)}><option value="timeline">时间线冲突</option><option value="character-state">人物状态冲突</option><option value="causality">因果关系冲突</option><option value="duplicate-event">可能是同一事件</option><option value="continuity">连续性问题</option><option value="other">其他</option></select></label>
                  <label className="block text-xs">严重程度<select className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm" value={issueSeverity} onChange={(event) => setIssueSeverity(event.target.value as typeof issueSeverity)}><option value="unknown">尚不确定</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
                  <label className="block text-xs">问题描述<textarea className="mt-1 min-h-20 w-full rounded border border-border bg-background px-2 py-1.5 text-sm" value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} placeholder="例如：前一章说人物尚未见过此人，后一章却写成多年旧识。" /></label>
                  <label className="block text-xs">原文证据（每行一条，可选）<textarea className="mt-1 min-h-16 w-full rounded border border-border bg-background px-2 py-1.5 text-sm" value={issueEvidence} onChange={(event) => setIssueEvidence(event.target.value)} /></label>
                  <label className="block text-xs">作者备注（可选）<textarea className="mt-1 min-h-14 w-full rounded border border-border bg-background px-2 py-1.5 text-sm" value={issueAuthorNote} onChange={(event) => setIssueAuthorNote(event.target.value)} /></label>
                  <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setIssueWorkbenchTab('open')}>取消</Button><Button disabled={selectedPlotIds.length < 2 || issueDescription.trim().length === 0} onClick={() => { onAddCrossChapterIssue({ plotNodeIds: selectedPlotIds, kind: issueKind, severity: issueSeverity, description: issueDescription, evidence: issueEvidence.split('\\n').map((item) => item.trim()).filter((item) => item.length > 0), ...(issueAuthorNote.trim().length === 0 ? {} : { authorNote: issueAuthorNote }) }); setSelectedPlotIds([]); setIssueDescription(''); setIssueEvidence(''); setIssueAuthorNote(''); setIssueWorkbenchTab('open'); }}>保存问题</Button></div>
                </div>
              ) : (
              <div className="space-y-3 p-4">
                {(outline.crossChapterIssues ?? []).filter((issue) => issueWorkbenchTab === 'open' ? issue.status === 'open' || issue.status === 'confirmed' : issue.status === 'resolved' || issue.status === 'dismissed').map((issue) => (
                  <article key={issue.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded bg-muted px-2 py-0.5 font-medium">{issue.kind}</span><span className="rounded bg-muted px-2 py-0.5">{issue.severity}</span><span className="rounded bg-muted px-2 py-0.5">{issue.status}</span></div>
                    <p className="mt-2 text-sm font-medium">{issue.description}</p>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">{issue.evidence.map((item) => <p key={item}>“{item}”</p>)}</div>
                    <div className="mt-3 flex flex-wrap gap-2">{issue.chapterNodeIds.map((chapterId) => <Button key={chapterId} variant="outline" size="sm" onClick={() => void onSelectChapter(chapterId)}>查看章节</Button>)}</div>
                    <textarea className="mt-3 min-h-14 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" placeholder="裁决备注（可选）" value={workbenchDecisionNotes[issue.id] ?? ''} onChange={(event) => setWorkbenchDecisionNotes((previous) => ({ ...previous, [issue.id]: event.target.value }))} />
                    <div className="mt-2 flex justify-end gap-2">
                      {(issue.status === 'resolved' || issue.status === 'dismissed') ? (
                        <Button variant="outline" size="sm" onClick={() => { onUpdateCrossChapterIssue(issue.id, 'open', workbenchDecisionNotes[issue.id] || undefined); setWorkbenchDecisionNotes((previous) => ({ ...previous, [issue.id]: '' })); }}>重新打开</Button>
                      ) : (
                        <>
                          <Button variant="outline" size="sm" onClick={() => { onUpdateCrossChapterIssue(issue.id, 'confirmed', workbenchDecisionNotes[issue.id] || undefined); setWorkbenchDecisionNotes((previous) => ({ ...previous, [issue.id]: '' })); }}>确认问题</Button>
                          <Button variant="outline" size="sm" onClick={() => { onUpdateCrossChapterIssue(issue.id, 'resolved', workbenchDecisionNotes[issue.id] || undefined); setWorkbenchDecisionNotes((previous) => ({ ...previous, [issue.id]: '' })); }}>标记已解决</Button>
                          <Button variant="ghost" size="sm" onClick={() => { onUpdateCrossChapterIssue(issue.id, 'dismissed', workbenchDecisionNotes[issue.id] || undefined); setWorkbenchDecisionNotes((previous) => ({ ...previous, [issue.id]: '' })); }}>忽略</Button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              )}
            </ScrollArea>
          </div>
        </div>
      )}


      {/* 三栏内容区 */}
      <div className="flex min-h-0 flex-1">
        {/* 左栏：大纲树 */}
        <div className="w-[240px] shrink-0 border-r border-border">
          <ScrollArea className="h-full">
            <div className="py-1">
              {rootNodes.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted-foreground">空大纲</p>
              ) : (
                rootNodes.map((node) => (
                  <OutlineTreeItem
                    key={node.id}
                    node={node}
                    depth={0}
                    children={outlineNodes}
                    selectedNodeId={selectedOutlineNodeId}
                    onSelect={handleSelectOutlineNode}
                    onPreserve={handlePreserveWithNote}
                    onUnpreserve={handleUnpreservePlotById}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 中栏 + 右栏：可拖拽调整宽度 */}
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="legacy-organization.content-details"
          className="min-w-0 flex-1"
        >
          {/* 中栏：原稿正文（只读） */}
          <ResizablePanel defaultSize={68} minSize={52} className="min-w-0 border-r border-border">
            {contentNodeId === undefined ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                点击左侧大纲节点查看原稿
              </div>
            ) : loadingContent ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                加载正文…
              </div>
            ) : (
              <div className="relative h-full">
                {/* 原文选区浮动按钮 */}
                {selectionText !== undefined && (
                  <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 shadow-md">
                    <span className="max-w-[200px] truncate text-xs text-muted-foreground">
                      &ldquo;{selectionText.slice(0, 30)}{selectionText.length > 30 ? '…' : ''}&rdquo;
                    </span>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={handlePreserveQuote}
                    >
                      <Quote className="size-3" />
                      保留原文
                    </Button>
                  </div>
                )}
                <ScrollArea className="h-full">
                  <div ref={contentRef} className="p-6">
                    <ReadOnlyManuscript content={content} />
                  </div>
                </ScrollArea>
              </div>
            )}
          </ResizablePanel>
          <ResizableHandle withHandle className="z-20 w-2 bg-transparent after:bg-border hover:after:bg-primary" />

          {/* 右栏：节点详情 + 已保留内容 */}
          <ResizablePanel defaultSize={32} minSize={22} maxSize={48} className="min-w-0">
            <ScrollArea className="h-full">
            <div className="space-y-4 p-3">
              {/* 当前节点信息 */}
              {selectedNode !== undefined && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    当前节点
                  </h3>
                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-1 text-sm font-medium">{selectedNode.title}</div>
                    {selectedNode.summary !== undefined && selectedNode.summary.length > 0 && (
                      <p className="mb-2 text-xs text-muted-foreground">{selectedNode.summary}</p>
                    )}
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        {selectedNode.kind === 'volume' ? '卷' : selectedNode.kind === 'chapter' ? '章' : selectedNode.kind === 'plot-beat' ? '情节' : selectedNode.kind}
                      </span>
                      {selectedNode.preserved && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                          已保留
                        </span>
                      )}
                    </div>

                    {/* 来源章节 */}
                    {selectedNodeSources.length > 0 && (
                      <div className="border-t border-border pt-2">
                        <p className="text-[10px] font-medium text-muted-foreground">原稿来源</p>
                        {selectedNodeSources.map((source, idx) => (
                          <p
                            key={idx}
                            className="cursor-pointer text-xs text-primary hover:underline"
                            onClick={() => {
                              void onSelectChapter(source.nodeId);
                            }}
                          >
                            {source.label}
                          </p>
                        ))}
                      </div>
                    )}

                    {selectedNode.kind === 'volume' ? (
                      <p className="mt-2 text-xs text-muted-foreground">这是卷目录，请选择具体章节。</p>
                    ) : selectedNode.kind === 'chapter' ? (
                      <div className="mt-3 space-y-2 border-t border-border pt-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium">本章情节候选</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={isRecognizingPlots}
                            onClick={() => onRecognizeChapterPlots(selectedNode.id)}
                          >
                            {isRecognizingPlots && <Loader2 className="size-3 animate-spin" />}
                            {isRecognizingPlots ? '正在识别…' : '重新识别'}
                          </Button>
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          识别结果只是候选，可能遗漏或误判；你可以修改、删除，或手动新增。
                        </p>
                        {recognitionError !== undefined && (
                          <p className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                            识别失败：{recognitionError}
                          </p>
                        )}
                        {selectedNodeChildren.length === 0 && (
                          <Button
                            variant="default"
                            size="sm"
                            className="w-full text-xs"
                            disabled={isRecognizingPlots}
                            onClick={() => onRecognizeChapterPlots(selectedNode.id)}
                          >
                            {isRecognizingPlots && <Loader2 className="size-3 animate-spin" />}
                            {isRecognizingPlots ? '正在识别本章情节…' : '识别本章情节'}
                          </Button>
                        )}
                        <div className="mb-2 flex items-center justify-between rounded border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground">
                          <span>可跨章节选择多个情节，记录关联或冲突；不会自动合并。</span>
                          <Button variant="outline" size="sm" className="h-6 text-[11px]" disabled={selectedPlotIds.length < 2} onClick={() => { setIssueWorkbenchTab('new'); setIssueWorkbenchOpen(true); }}>记录贯穿问题 ({selectedPlotIds.length})</Button>
                        </div>
                        <div className="space-y-2">
                          {selectedNodeChildren.map((plot) => (
                            <PlotCandidateEditor
                              key={plot.id}
                              selected={selectedPlotIds.includes(plot.id)}
                              onToggleSelect={() => setSelectedPlotIds((previous) => previous.includes(plot.id) ? previous.filter((id) => id !== plot.id) : [...previous, plot.id])}
                              plot={plot}
                              editing={editingPlotId === plot.id}
                              editTitle={editingPlotId === plot.id ? editTitle : plot.title}
                              editSummary={editingPlotId === plot.id ? editSummary : plot.summary}
                              onStartEdit={() => {
                                setEditingPlotId(plot.id);
                                setEditTitle(plot.title);
                                setEditSummary(plot.summary);
                              }}
                              onCancelEdit={() => setEditingPlotId(undefined)}
                              onTitleChange={setEditTitle}
                              onSummaryChange={setEditSummary}
                              onSave={() => {
                                onUpdateOutlinePlot(plot.id, editTitle, editSummary);
                                setEditingPlotId(undefined);
                              }}
                              onDelete={() => onDeleteOutlinePlot(plot.id)}
                              onPreserve={() => handlePreserveWithNote(plot.id)}
                              onUnpreserve={() => handleUnpreservePlotById(plot.id)}
                              advisor={advisorByPlot[plot.id]}
                              advisorBusy={advisorBusyPlotId === plot.id}
                              onResetAdvisor={() => {
                                onClearAdvisorConversation(plot.id);
                                setAdvisorByPlot((previous) => {
                                  const next = { ...previous };
                                  delete next[plot.id];
                                  return next;
                                });
                              }}
                              onAskAdvisor={(question, mode) => {
                                if (_projectId === undefined) return;
                                const previousTurns = advisorByPlot[plot.id]?.turns ?? [];
                                const conversation = previousTurns.flatMap((turn) => [
                                  { role: 'author' as const, content: turn.question.trim() || '请主动检查当前情节。' },
                                  { role: 'advisor' as const, content: turn.advice },
                                ]);
                                setAdvisorBusyPlotId(plot.id);
                                window.novelAgent.sendCommand({
                                  type: 'ask-legacy-plot-advisor',
                                  runId: `ui-legacy-advisor-${Date.now()}`,
                                  projectId: _projectId,
                                  chapterNodeId: selectedNode.id,
                                  plotNodeId: plot.id,
                                  plotTitle: plot.title,
                                  plotSummary: plot.summary,
                                  ...(plot.sources[0]?.quote === undefined ? {} : { evidenceQuote: plot.sources[0].quote }),
                                  question,
                                  conversation,
                                  mode,
                                });
                              }}
                              onAdoptAdvice={(advice) => {
                                setEditingPlotId(plot.id);
                                setEditTitle(plot.title);
                                setEditSummary(advice);
                              }}
                              onSaveRewriteConstraint={(advice) => onPreservePlot(plot.id, advice)}
                            />
                          ))}
                        </div>
                        {(outline.deletedPlots?.filter((item) => item.node.parentId === selectedNode.id).length ?? 0) > 0 && (
                          <div className="border-t border-border pt-3">
                            <p className="mb-2 text-xs font-medium text-muted-foreground">回收站（本章已删除）</p>
                            <div className="space-y-1.5">
                              {outline.deletedPlots?.filter((item) => item.node.parentId === selectedNode.id).map((item) => (
                                <div key={item.node.id} className="flex items-center justify-between rounded border border-dashed border-border px-2 py-1.5 text-xs">
                                  <span className="min-w-0 truncate">{item.node.title}</span>
                                  <Button variant="ghost" size="sm" className="h-6 shrink-0 text-xs" onClick={() => onRestoreDeletedPlot(item.node.id)}>恢复</Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="border-t border-border pt-2">
                          <input className="mb-1 w-full rounded border border-border bg-background px-2 py-1 text-xs" placeholder="新情节标题" value={newPlotTitle} onChange={(event) => setNewPlotTitle(event.target.value)} />
                          <textarea className="mb-1 min-h-14 w-full rounded border border-border bg-background px-2 py-1 text-xs" placeholder="一句话摘要（可选）" value={newPlotSummary} onChange={(event) => setNewPlotSummary(event.target.value)} />
                          <Button variant="outline" size="sm" className="w-full text-xs" disabled={newPlotTitle.trim().length === 0} onClick={() => { onAddOutlinePlot(selectedNode.id, newPlotTitle, newPlotSummary); setNewPlotTitle(''); setNewPlotSummary(''); }}>
                            手动新增情节
                          </Button>
                        </div>
                      </div>
                    ) : selectedNode.preserved ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full gap-1 text-xs"
                        onClick={() => handleUnpreservePlotById(selectedNode.id)}
                      >
                        <PinOff className="size-3" />
                        取消保留「{selectedNode.title}」
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full gap-1 text-xs"
                        onClick={() => handlePreserveWithNote(selectedNode.id)}
                      >
                        <Pin className="size-3" />
                        保留「{selectedNode.title}」这个情节
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* 保留情节列表 */}
              {manifest !== undefined && manifest.plots.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    已保留情节 ({manifest.plots.length})
                  </h3>
                  <div className="space-y-1">
                    {manifest.plots.map((plot) => (
                      <PreservedPlotCard
                        key={plot.id}
                        plot={plot}
                        onUnpreserve={onUnpreservePlot}
                        onOpenPlot={(outlineNodeId) => {
                          const node = outlineNodes.find((candidate) => candidate.id === outlineNodeId);
                          if (node !== undefined) handleSelectOutlineNode(node);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 保留原文列表 */}
              {manifest !== undefined && manifest.quotes.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    已保留原文 ({manifest.quotes.length})
                  </h3>
                  <div className="space-y-1">
                    {manifest.quotes.map((quote) => (
                      <PreservedQuoteCard
                        key={quote.id}
                        quote={quote}
                        onUnpreserve={onUnpreserveQuote}
                        onSelectChapter={onSelectChapter}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 空保留状态 */}
              {manifest !== undefined && manifest.plots.length === 0 && manifest.quotes.length === 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    保留内容
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    暂无保留内容。点击大纲节点旁的图钉按钮保留精彩情节，或在阅读正文时框选原文。
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function PlotCandidateEditor({
  plot,
  selected,
  onToggleSelect,
  editing,
  editTitle,
  editSummary,
  onStartEdit,
  onCancelEdit,
  onTitleChange,
  onSummaryChange,
  onSave,
  onDelete,
  onPreserve,
  onUnpreserve,
  advisor,
  advisorBusy,
  onAskAdvisor,
  onResetAdvisor,
  onAdoptAdvice,
  onSaveRewriteConstraint,
}: {
  plot: OutlineNodeDto;
  selected: boolean;
  onToggleSelect(): void;
  editing: boolean;
  editTitle: string;
  editSummary: string;
  onStartEdit(): void;
  onCancelEdit(): void;
  onTitleChange(value: string): void;
  onSummaryChange(value: string): void;
  onSave(): void;
  onDelete(): void;
  onPreserve(): void;
  onUnpreserve(): void;
  advisor: { turns: ReadonlyArray<{ question: string; advice: string; options: ReadonlyArray<string>; askedAt: string }>; error?: string } | undefined;
  advisorBusy: boolean;
  onAskAdvisor(question: string, mode: 'auto' | 'timeline' | 'historical-context' | 'plot-logic' | 'character' | 'panel'): void;
  onResetAdvisor(): void;
  onAdoptAdvice(advice: string): void;
  onSaveRewriteConstraint(advice: string): void;
}): JSX.Element {
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorQuestion, setAdvisorQuestion] = useState('');
  const [advisorMode, setAdvisorMode] = useState<'auto' | 'timeline' | 'historical-context' | 'plot-logic' | 'character' | 'panel'>('auto');
  const advisorQuestionRef = useRef<HTMLTextAreaElement>(null);

  if (editing) {
    return (
      <div className="space-y-1 rounded border border-primary/40 bg-primary/5 p-2">
        <input className="w-full rounded border border-border bg-background px-2 py-1 text-xs" value={editTitle} onChange={(event) => onTitleChange(event.target.value)} />
        <textarea className="min-h-16 w-full rounded border border-border bg-background px-2 py-1 text-xs" value={editSummary} onChange={(event) => onSummaryChange(event.target.value)} />
        <div className="flex gap-1">
          <Button variant="default" size="sm" className="h-7 text-xs" onClick={onSave}>保存修改</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancelEdit}>取消</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded border border-border p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`选择情节「${plot.title}」用于记录贯穿问题`} className="mt-1" />
          <p className="text-xs font-medium">{plot.title}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{plot.summary || '暂无摘要'}</p>
          <p className="mt-1 text-[10px] text-muted-foreground/70">原文证据请在中栏查看</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={`inline-flex items-center gap-0.5 text-[11px] hover:underline ${plot.preserved ? 'text-amber-600' : 'text-primary'}`}
            onClick={plot.preserved ? onUnpreserve : onPreserve}
          >
            {plot.preserved ? <PinOff className="size-3" /> : <Pin className="size-3" />}
            {plot.preserved ? '取消保留' : '保留'}
          </button>
          <button type="button" className="text-[11px] text-primary hover:underline" onClick={onStartEdit}>修改</button>
          <button type="button" className="text-[11px] text-violet-600 hover:underline" onClick={() => setAdvisorOpen((open) => !open)}>找参谋</button>
          {!plot.preserved && <button type="button" className="text-[11px] text-destructive hover:underline" onClick={onDelete}>删除</button>}
        </div>
      </div>
      <p className="mt-1 text-[10px] text-amber-700">候选 · 请人工确认</p>
      {advisorOpen && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">可以提出疑问、补充真实意图或继续追问。参谋会参考本轮之前的讨论，但不会自动修改。</p>
          <select className="w-full rounded border border-border bg-background px-2 py-1 text-xs" value={advisorMode} onChange={(event) => setAdvisorMode(event.target.value as typeof advisorMode)}>
            <option value="auto">让参谋判断检查方向</option>
            <option value="timeline">时间线核查</option>
            <option value="historical-context">时代背景核查</option>
            <option value="plot-logic">情节逻辑核查</option>
            <option value="character">人物合理性核查</option>
            <option value="panel">参谋团综合核查</option>
          </select>
          <textarea
            className="min-h-16 w-full rounded border border-border bg-background px-2 py-1 text-xs"
            placeholder="例如：我的本意是佐藤临时拿走了印章，体现他的警觉，也考验顾长风的急智。这样是否成立？"
            value={advisorQuestion}
            onChange={(event) => setAdvisorQuestion(event.target.value)}
            ref={advisorQuestionRef}
          />
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 text-xs"
              disabled={advisorBusy}
              onClick={() => { onAskAdvisor(advisorQuestion.trim(), advisorMode); }}
            >
            {advisorBusy && <Loader2 className="size-3 animate-spin" />}
              {advisorBusy ? '参谋思考中…' : (advisor?.turns.length ?? 0) > 0 ? '继续讨论' : advisorQuestion.trim().length > 0 ? '开始讨论' : '让参谋主动检查'}
            </Button>
            {(advisor?.turns.length ?? 0) > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-xs"
                disabled={advisorBusy}
                onClick={() => {
                  setAdvisorQuestion('');
                  setAdvisorMode('auto');
                  advisorQuestionRef.current?.focus();
                  onResetAdvisor();
                }}
              >
                重新开始
              </Button>
            )}
          </div>
          {advisor?.error !== undefined && <p className="text-[11px] text-destructive">{advisor.error}</p>}
          {advisor !== undefined && advisor.turns.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-medium text-muted-foreground">讨论记录</p>
              {advisor.turns.map((turn, index) => (
                <div key={`${index}-${turn.advice.slice(0, 12)}`} className="space-y-2">
                  <div className="rounded border border-border bg-muted/30 p-2">
                    <p className="text-[11px] font-medium">作者补充</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{turn.question.trim() || '（请参谋主动检查）'}</p>
                  </div>
                  <div className="rounded border border-violet-500/30 bg-violet-500/5 p-2">
                    <p className="text-[11px] font-medium text-violet-700">参谋建议</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{turn.advice}</p>
                    {turn.options.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[10px] text-muted-foreground">前几项可采纳，最后一项用于继续补充讨论：</p>
                        {turn.options.map((option, optionIndex) => {
                          const isFollowUp = optionIndex === turn.options.length - 1;
                          return (
                            <button
                              key={option}
                              type="button"
                              className="block w-full rounded border border-border px-2 py-1 text-left text-[11px] hover:bg-muted"
                              onClick={() => {
                                if (isFollowUp) {
                                  setAdvisorQuestion(option);
                                  advisorQuestionRef.current?.focus();
                                  return;
                                }
                                onAdoptAdvice(option);
                              }}
                            >
                              <span className={isFollowUp ? 'text-violet-700' : 'text-foreground'}>{isFollowUp ? '补充：' : '采纳：'}</span>{option}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {index === advisor.turns.length - 1 && (
                      <div className="mt-2 grid gap-1">
                        <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={() => onSaveRewriteConstraint(turn.advice)}>保存本轮结论为后续改写要求</Button>
                        <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => onAdoptAdvice(turn.advice)}>放入摘要编辑框继续修改</Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 只读正文渲染 ────────────────────────────────────────────────── */

function ReadOnlyManuscript({ content }: { content: string }): JSX.Element {
  const paragraphs = useMemo(
    () =>
      content
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0),
    [content],
  );

  if (paragraphs.length === 0) {
    return <p className="text-sm text-muted-foreground">（空章节）</p>;
  }

  return (
    <article>
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className="mb-4 whitespace-pre-wrap text-[0.9375rem] leading-[1.8] tracking-[0.01em] select-text"
        >
          {paragraph}
        </p>
      ))}
    </article>
  );
}

/* ── 保留情节卡片 ────────────────────────────────────────────────── */

function PreservedPlotCard({
  plot,
  onUnpreserve,
  onOpenPlot,
}: {
  plot: { id: string; outlineNodeId: string; title: string; authorNote: string | undefined };
  onUnpreserve: (plotId: string) => void;
  onOpenPlot: (outlineNodeId: string) => void;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="flex items-start justify-between gap-1">
        <button type="button" className="min-w-0 text-left text-xs font-medium hover:text-primary hover:underline" onClick={() => onOpenPlot(plot.outlineNodeId)}>{plot.title}</button>
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onUnpreserve(plot.id)}
          title="取消保留"
        >
          <PinOff className="size-3" />
        </button>
      </div>
      {plot.authorNote !== undefined && plot.authorNote.length > 0 ? (
        <div className="mt-2 rounded bg-muted/50 px-2 py-1.5">
          <p className="text-[10px] font-medium text-muted-foreground">后续改写要求</p>
          <p className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed">{plot.authorNote}</p>
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-muted-foreground">点击标题重新打开此情节</p>
      )}
    </div>
  );
}

/* ── 保留原文卡片 ────────────────────────────────────────────────── */

function PreservedQuoteCard({
  quote,
  onUnpreserve,
  onSelectChapter,
}: {
  quote: { id: string; text: string; sourceNodeId: string; sourceChapterTitle: string; preservedAt: string };
  onUnpreserve: (quoteId: string) => void;
  onSelectChapter: (nodeId: string) => Promise<void>;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="mb-1 flex items-start justify-between gap-1">
        <button
          type="button"
          className="text-left text-xs leading-snug text-foreground hover:text-primary"
          onClick={() => {
            void onSelectChapter(quote.sourceNodeId);
          }}
          title="跳转到原稿位置"
        >
          &ldquo;{quote.text.length > 60 ? `${quote.text.slice(0, 60)}…` : quote.text}&rdquo;
        </button>
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onUnpreserve(quote.id)}
          title="取消保留"
        >
          <PinOff className="size-3" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">{quote.sourceChapterTitle}</p>
    </div>
  );
}

/* ── 工具函数 ────────────────────────────────────────────────────── */

function findChapterNode(tree: ChapterTreeDto | undefined, nodeId: string): { title: string } | undefined {
  if (tree === undefined) return undefined;
  for (const root of tree.roots) {
    if (root.kind === 'chapter' && root.id === nodeId) return root;
    for (const child of root.children) {
      if (child.kind === 'chapter' && child.id === nodeId) return child;
    }
  }
  return undefined;
}
