/**
 * 应用外壳 (walking-skeleton tasks 5.3, 6.x)
 *
 * 按 core/shell/layout.ts 的三轴布局组织：左导航轴 / 中正文轴 / 右对话轴 + 顶栏（仪表盘抽屉入口）
 * + Cmd+K 命令面板覆盖层。Renderer 无业务逻辑：章节树/正文经桥取真实数据，对话调真实 LLM 流式，
 * 全部业务经 IPC 委派后端。视觉后置（task 7.5）：仅骨架级样式。
 */

import { NavAxis } from './components/NavAxis.js';
import { ManuscriptAxis, type ManuscriptAxisHandle } from './components/ManuscriptAxis.js';
import { DialogueAxis } from './components/DialogueAxis.js';
import { CommandPalette } from './components/CommandPalette.js';
import { DashboardDrawer } from './components/DashboardDrawer.js';
import { ArchitectBoardDrawer } from './components/ArchitectBoardDrawer.js';
import { FactExtractionPanel } from './components/FactExtractionPanel.js';
import { StoryBibleDrawer } from './components/StoryBibleDrawer.js';
import { RefactorReviewPanel } from './components/RefactorReviewPanel.js';
import { FindingConnector } from './components/FindingConnector.js';
import { ExpertWorkbench } from './components/ExpertWorkbench.js';
import { ToolboxDrawer } from './components/ToolboxDrawer.js';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from './components/ui/resizable.js';
import { useChapters } from './hooks/useChapters.js';
import { useDialogue, type SummonRequest } from './hooks/useDialogue.js';
import { useReviewFindings } from './hooks/useReviewFindings.js';
import { useFactExtraction } from './hooks/useFactExtraction.js';
import { useRefactor } from './hooks/useRefactor.js';
import { useDashboard } from './hooks/useDashboard.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { ThemeToggle } from './components/ThemeToggle.js';
import {
  DEFAULT_DIAGNOSE_AGENT,
  resolveAgentEntry,
  resolveAgentMention,
} from '../core/shell/agent-catalog.js';
import type { ToolboxBoardId, ToolboxActionId } from '../core/shell/toolbox-catalog.js';
import type { ConsistencyIssueDto } from '../shared/ipc/index.js';
import { useWorkbenchActivities } from './hooks/useWorkbenchActivities.js';

export function App(): JSX.Element {
  const { tree, selectedNodeId, content, loadingContent, error, selectChapter } = useChapters();
  const { turns, activeRunId, pendingConflict, summon, abort, approveConflict, rejectConflict, modifyConflict } =
    useDialogue();
  const { findingsByRun, activeFinding, selectFinding, clearFinding } = useReviewFindings();
  const factExtraction = useFactExtraction();
  const dashboard = useDashboard();
  const manuscriptRef = useRef<ManuscriptAxisHandle>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [refactorOpen, setRefactorOpen] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);

  // 成功摘要短暂保留，随后让顶部任务条自动退出；冲突与失败必须等待作者处理。
  useEffect(() => {
    if (factExtraction.state.status !== 'completed') return;
    const timeoutId = window.setTimeout(factExtraction.clear, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [factExtraction.state.status, factExtraction.clear]);

  // 专家工作台活图染色：直接消费后端 LangGraph 节点生命周期事件。
  const {
    activities: workbenchActivities,
    trace: workbenchTrace,
    runId: workbenchRunId,
    observation: workbenchObservation,
  } = useWorkbenchActivities(activeRunId);
  const workbenchObjective =
    workbenchRunId === undefined
      ? undefined
      : turns.find((turn) => turn.runId === workbenchRunId && turn.role === 'user')?.content;
  const workbenchTargetAgent =
    workbenchRunId === undefined
      ? undefined
      : turns.find((turn) => turn.runId === workbenchRunId && turn.role === 'assistant')?.agent;
  const [refactorPrefill, setRefactorPrefill] = useState<
    { readonly nodeId: string; readonly original: string; readonly suggestion: string } | undefined
  >(undefined);

  // 选中的审校问题变化时：据证据引文在正文定位高亮；取消选中则清高亮。
  const activeIssue =
    activeFinding === undefined
      ? undefined
      : findingsByRun.get(activeFinding.runId)?.issues[activeFinding.index];
  useEffect(() => {
    const handle = manuscriptRef.current;
    if (handle === null) return;
    const quote = activeIssue?.evidence?.quote;
    if (quote === undefined || quote.length === 0) {
      handle.clearHighlight();
      return;
    }
    handle.highlightQuote(quote);
  }, [activeIssue]);

  // 切换章节时清除选中与高亮（避免跨章错位连线）。
  useEffect(() => {
    clearFinding();
    manuscriptRef.current?.clearHighlight();
  }, [selectedNodeId, clearFinding]);

  // 改写拼回落盘成功后重载当前章节正文，呈现磁盘变更。
  const onRefactorApplied = useCallback(
    (nodeId: string): void => {
      selectChapter(nodeId);
    },
    [selectChapter],
  );
  const refactor = useRefactor(onRefactorApplied);

  // 采纳某条审校发现：以证据引文预填原片段、建议修复预填改写片段，打开重构审阅面板。
  const handleRefactorOpenChange = useCallback((open: boolean): void => {
    setRefactorOpen(open);
    if (!open) setRefactorPrefill(undefined);
  }, []);

  const handleAdoptFinding = useCallback((issue: ConsistencyIssueDto): void => {
    const original = issue.evidence?.quote ?? '';
    const chapterAnchor = issue.anchors.find((anchor) => anchor.kind === 'chapter');
    if (original.length === 0 || chapterAnchor === undefined) return;
    setRefactorPrefill({
      nodeId: chapterAnchor.id,
      original,
      suggestion: issue.suggestedFix ?? '',
    });
    selectChapter(chapterAnchor.id);
    setRefactorOpen(true);
  }, [selectChapter]);

  /** 工具条看板排：打开对应查阅抽屉（不产召唤命令）。 */
  const handleOpenBoard = useCallback((id: ToolboxBoardId): void => {
    switch (id) {
      case 'architect-board':
        setBoardOpen(true);
        return;
      case 'story-bible':
        setBibleOpen(true);
        return;
      case 'quality-dashboard':
        setDashOpen(true);
        return;
    }
  }, []);

  /** 工具条动作排：经既有 hook 对当前内容发起后端操作。 */
  const handleAction = useCallback(
    (id: ToolboxActionId): void => {
      switch (id) {
        case 'fact-extract-chapter':
          if (selectedNodeId !== undefined) factExtraction.extractCurrentChapter(selectedNodeId);
          return;
        case 'fact-backfill-all':
          factExtraction.backfillAll();
          return;
        case 'refactor-review':
          setRefactorOpen(true);
          return;
        case 'global-audit':
          setDashOpen(true);
          dashboard.runGlobalAudit();
          return;
      }
    },
    [selectedNodeId, factExtraction, dashboard],
  );

  const retryFactExtraction = useCallback((): void => {
    if (factExtraction.state.mode === 'backfill') {
      factExtraction.backfillAll();
      return;
    }
    const chapterId = factExtraction.state.currentChapterId;
    if (chapterId !== undefined) factExtraction.extractCurrentChapter(chapterId);
  }, [factExtraction]);

  // 对话输入默认延续最近一次明确召唤的专家；没有历史专家时才回退到默认审校。
  let conversationAgent = DEFAULT_DIAGNOSE_AGENT;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role !== 'assistant' || turn.agent === undefined) continue;
    const entry = resolveAgentEntry(turn.agent);
    if (entry === undefined) continue;
    conversationAgent = entry.agent;
    break;
  }
  const conversationAgentEntry = resolveAgentEntry(conversationAgent);
  const conversationAgentLabel = conversationAgentEntry?.label ?? conversationAgent;

  /** 对话轴后续意见：开头 `@专家` 显式覆盖，否则沿用当前会话专家。 */
  const ask = (input: string): void => {
    const mention = resolveAgentMention(input);
    if (mention.kind === 'unknown') return;
    const targetEntry = mention.kind === 'resolved' ? mention.entry : conversationAgentEntry;
    const targetAgent = targetEntry?.agent ?? conversationAgent;
    const mode = targetEntry?.defaultMode ?? 'diagnose';
    const preferredScope = targetEntry?.defaultScope ?? 'document';
    const instruction = mention.instruction;
    const instructionPart = instruction.length > 0 ? { instruction } : {};
    const request: SummonRequest =
      preferredScope === 'node' && selectedNodeId !== undefined
        ? { agent: targetAgent, mode, scope: 'node', anchorNodeId: selectedNodeId, ...instructionPart }
        : {
            agent: targetAgent,
            mode,
            scope: preferredScope === 'node' || preferredScope === 'selection' ? 'document' : preferredScope,
            ...instructionPart,
          };
    summon(request);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2 font-semibold">
          <BookOpenText className="size-5 text-primary" aria-hidden />
          <span>Novel Agent</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">⌘K 召唤</span>
          <ThemeToggle />
        </div>
      </header>

      {error !== undefined && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-1 text-sm text-destructive">
          {error}
        </div>
      )}

      <FactExtractionPanel
        state={factExtraction.state}
        busy={factExtraction.busy}
        onRetry={retryFactExtraction}
        onAbort={factExtraction.abort}
        onResolveConflict={factExtraction.resolveConflict}
        onRejectConflict={factExtraction.rejectConflict}
        onClear={factExtraction.clear}
      />

      <ExpertWorkbench
        activities={workbenchActivities}
        trace={workbenchTrace}
        objective={workbenchObjective}
        targetAgent={workbenchTargetAgent}
        observation={workbenchObservation}
      />

      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="novel-agent.layout"
        className="min-h-0 flex-1"
      >
        <ResizablePanel defaultSize={18} minSize={12} maxSize={34} className="min-h-0">
          <NavAxis tree={tree} selectedNodeId={selectedNodeId} onSelect={selectChapter} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={56} minSize={30} className="min-h-0">
          <ManuscriptAxis ref={manuscriptRef} content={content} loading={loadingContent} selectedNodeId={selectedNodeId} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={26} minSize={16} maxSize={44} className="min-h-0">
          <DialogueAxis
            turns={turns}
            activeRunId={activeRunId}
            pendingConflict={pendingConflict}
            findingsByRun={findingsByRun}
            activeFinding={activeFinding}
            onAsk={ask}
            askTargetLabel={conversationAgentLabel}
            onAbort={abort}
            onApproveConflict={approveConflict}
            onRejectConflict={rejectConflict}
            onModifyConflict={modifyConflict}
            onSelectFinding={selectFinding}
            onAdoptFinding={handleAdoptFinding}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <ToolboxDrawer
        selectedNodeId={selectedNodeId}
        open={toolboxOpen}
        onOpenChange={setToolboxOpen}
        onSummon={summon}
        onOpenBoard={handleOpenBoard}
        onAction={handleAction}
      />

      <FindingConnector
        runId={activeFinding?.runId}
        index={activeFinding?.index}
        severity={activeIssue?.severity}
      />

      <CommandPalette selectedNodeId={selectedNodeId} onSummon={summon} onOpenBoard={() => setBoardOpen(true)} />
      <ArchitectBoardDrawer open={boardOpen} onOpenChange={setBoardOpen} />
      <StoryBibleDrawer open={bibleOpen} onOpenChange={setBibleOpen} />
      <DashboardDrawer
        open={dashOpen}
        onOpenChange={setDashOpen}
        dashboard={dashboard}
        onSelectChapter={selectChapter}
      />
      <RefactorReviewPanel
        open={refactorOpen}
        onOpenChange={handleRefactorOpenChange}
        selectedNodeId={selectedNodeId}
        content={content}
        loadingContent={loadingContent}
        refactor={refactor}
        prefill={refactorPrefill}
      />
    </div>
  );
}
