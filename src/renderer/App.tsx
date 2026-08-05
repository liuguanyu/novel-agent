/**
 * 应用外壳 (walking-skeleton tasks 5.3, 6.x)
 *
 * 按 core/shell/layout.ts 的三轴布局组织：左导航轴 / 中正文轴 / 右对话轴 + 顶栏（仪表盘抽屉入口）
 * + Cmd+K 命令面板覆盖层。Renderer 无业务逻辑：章节树/正文经桥取真实数据，对话调真实 LLM 流式，
 * 全部业务经 IPC 委派后端。视觉后置（task 7.5）：仅骨架级样式。
 */

import { NavAxis, type NavContextId, type NavListEntry } from './components/NavAxis.js';
import { ManuscriptAxis, type ManuscriptAxisHandle } from './components/ManuscriptAxis.js';
import { DialogueAxis } from './components/DialogueAxis.js';
import { CommandPalette } from './components/CommandPalette.js';
import { DashboardDrawer } from './components/DashboardDrawer.js';
import { ArchitectBoardDrawer } from './components/ArchitectBoardDrawer.js';
import { StoryBibleDrawer } from './components/StoryBibleDrawer.js';
import { RefactorReviewPanel } from './components/RefactorReviewPanel.js';
import { FindingConnector } from './components/FindingConnector.js';
import { ExpertWorkbench } from './components/ExpertWorkbench.js';
import { WorkflowGraph } from './components/WorkflowGraph.js';
import { GoalDialog } from './components/GoalDialog.js';
import { FactSheetDrawer } from './components/FactSheetDrawer.js';
import { StatusFooter } from './components/StatusFooter.js';
import { TaskActivityDrawer } from './components/TaskActivityDrawer.js';
import { CurrentTaskCard } from './components/CurrentTaskCard.js';
import { ToolboxDrawer } from './components/ToolboxDrawer.js';
import { ReadingMode } from './components/ReadingMode.js';
import { ConversationMode } from './components/ConversationMode.js';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from './components/ui/resizable.js';
import { useChapters } from './hooks/useChapters.js';
import { useDialogue, type SummonRequest } from './hooks/useDialogue.js';
import { useReviewFindings } from './hooks/useReviewFindings.js';
import { useStoryBible } from './hooks/useStoryBible.js';
import { useFactExtraction } from './hooks/useFactExtraction.js';
import { useModelTaskSessions } from './hooks/useModelTaskSessions.js';
import { useRefactor } from './hooks/useRefactor.js';
import { useDashboard } from './hooks/useDashboard.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, BookOpen, MessagesSquare, Target } from 'lucide-react';
import { ThemeToggle } from './components/ThemeToggle.js';
import { buildTaskActivityFeed } from './lib/task-activity-feed.js';
import { manuscriptEmptyCopy, assistantCopy } from './lib/task-ui-copy.js';
import {
  DEFAULT_DIAGNOSE_AGENT,
  resolveAgentEntry,
  resolveAgentMention,
} from '../core/shell/agent-catalog.js';
import type { ToolboxBoardId, ToolboxActionId } from '../core/shell/toolbox-catalog.js';
import type { ChapterTreeNodeDto, ConsistencyIssueDto, RunId } from '../shared/ipc/index.js';
import { useWorkbenchActivities } from './hooks/useWorkbenchActivities.js';
import { useWorkflowSnapshot } from './hooks/useWorkflowSnapshot.js';
import { useAssetReview } from './hooks/useAssetReview.js';
import { useTaskActivityStream } from './hooks/useTaskActivityStream.js';
import { useTaskUiEffects } from './hooks/useTaskUiEffects.js';
import { buildIssueRefactorIntent, resolveIssueChapterTarget } from './lib/workflow-ui-contracts.js';
import {
  preferredNavContext,
  resolveViewModeSurfaces,
  type AppViewMode,
} from './lib/workbench-view-contracts.js';

function findChapterPath(
  nodes: ReadonlyArray<ChapterTreeNodeDto>,
  chapterId: string,
  parents: ReadonlyArray<string> = [],
): string | undefined {
  for (const node of nodes) {
    const path = [...parents, node.title];
    if (node.id === chapterId) return path.filter((part) => part.trim().length > 0).join(' / ');
    const nested = findChapterPath(node.children, chapterId, path);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * 全局显示模式（task 10.7）：单一判别状态，三模式互斥；
 * 可见面矩阵由 lib/workbench-view-contracts 的 resolveViewModeSurfaces 统一给出（与冲烟同源）。
 * 工作台内容在非 workbench 模式下仅隐藏不卸载，保留阅读位置、高亮与栏宽；
 * 后台任务全部在 Main 进程，模式切换天然不中断运行。
 */
type ViewMode = AppViewMode;

export function App(): JSX.Element {
  const {
    projectId: workspaceProjectId,
    tree,
    selectedNodeId,
    contentNodeId,
    content,
    loadingContent,
    error,
    selectChapter,
  } = useChapters();
  const { findingsByRun, activeFinding, selectFinding, clearFinding } = useReviewFindings();
  const factExtraction = useFactExtraction();
  const modelTasks = useModelTaskSessions();
  const taskStream = useTaskActivityStream(workspaceProjectId);
  const currentModelTask = modelTasks.activeAttempt?.kind === 'fact-extraction' ? modelTasks.activeAttempt : undefined;
  // 底部实时进展始终跟随最新事实任务，不受任务面板里历史 attempt 选择影响。
  const latestFactModelTask = useMemo(() => {
    for (let index = modelTasks.attempts.length - 1; index >= 0; index -= 1) {
      const attempt = modelTasks.attempts[index];
      if (
        attempt?.kind === 'fact-extraction' &&
        (attempt.status === 'queued' || attempt.status === 'running' || attempt.status === 'awaiting-author')
      ) {
        return attempt;
      }
    }
    if (factExtraction.state.runId === undefined) return undefined;
    for (let index = modelTasks.attempts.length - 1; index >= 0; index -= 1) {
      const attempt = modelTasks.attempts[index];
      if (attempt?.kind === 'fact-extraction' && attempt.runId === factExtraction.state.runId) return attempt;
    }
    return undefined;
  }, [factExtraction.state.runId, modelTasks.attempts]);
  const currentExtractionChapterLabel = useMemo(() => {
    const chapterId = factExtraction.state.currentChapterId;
    if (chapterId === undefined || tree === undefined) return undefined;
    return findChapterPath(tree.roots, chapterId);
  }, [factExtraction.state.currentChapterId, tree]);
  const modelTaskChapterLabel = useMemo(() => {
    const chapterId = latestFactModelTask?.chapterId;
    if (chapterId === undefined || tree === undefined) return undefined;
    return findChapterPath(tree.roots, chapterId);
  }, [latestFactModelTask?.chapterId, tree]);
  const dashboard = useDashboard();
  // 当前项目身份来自 Main 的工作区 manifest；查询失败时保留 standalone 工作台。
  const workflowState = useWorkflowSnapshot(workspaceProjectId);
  const workflowRef = workflowState.snapshot?.currentStageId === null || workflowState.snapshot === null
    ? undefined
    : { workflowId: workflowState.snapshot.workflowId, stageId: workflowState.snapshot.currentStageId };
  const assetReview = useAssetReview(workflowState.snapshot);
  const { turns, activeRunId, pendingConflict, summon, abort, approveConflict, rejectConflict, modifyConflict } =
    useDialogue(workflowRef);
  const manuscriptRef = useRef<ManuscriptAxisHandle>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [refactorOpen, setRefactorOpen] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('workbench');
  const [goalOpen, setGoalOpen] = useState(false);
  const [factSheetOpen, setFactSheetOpen] = useState(false);
  const [taskActivityOpen, setTaskActivityOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 左栏上下文切换（章节/问题/人物/故事线/产物）；人物与故事线按需拉取事实库投影。
  const [navContext, setNavContext] = useState<NavContextId>('chapters');
  const currentWorkflowStage = workflowState.snapshot?.stages.find(
    (stage) => stage['stageId'] === workflowState.snapshot?.currentStageId,
  );
  const currentTemplateStageId = typeof currentWorkflowStage?.['templateStageId'] === 'string'
    ? currentWorkflowStage['templateStageId']
    : undefined;
  // 定位原文必须先选问题：首次进入该阶段时主动切到问题 tab，后续仍允许作者自由切换。
  useEffect(() => {
    const preferred = preferredNavContext(currentTemplateStageId);
    if (preferred !== undefined) setNavContext(preferred);
  }, [currentTemplateStageId, workflowState.snapshot?.currentStageId]);
  const navStoryBible = useStoryBible(navContext === 'characters' || navContext === 'storylines');

  // 当前选中章节路径（读书/对话模式的上下文面包屑）。
  const selectedChapterPath = useMemo(() => {
    if (selectedNodeId === undefined || tree === undefined) return undefined;
    return findChapterPath(tree.roots, selectedNodeId);
  }, [selectedNodeId, tree]);

  // 非工作台模式下 Esc 返回（尊重已被消费的 Esc，如 @提及菜单关闭）。
  useEffect(() => {
    if (viewMode === 'workbench') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setViewMode('workbench');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode]);

  // 成功摘要短暂保留，随后让底部任务状态自动退出；冲突与失败必须等待作者处理。
  useEffect(() => {
    if (factExtraction.state.status !== 'completed') return;
    const timeoutId = window.setTimeout(factExtraction.clear, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [factExtraction.state.status, factExtraction.clear]);

  // 事实核对需要作者裁决时主动展开底稿，避免关键决策藏在后台。
  useEffect(() => {
    if (factExtraction.state.status === 'interrupted') setFactSheetOpen(true);
  }, [factExtraction.state.status]);

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
    { readonly nodeId: string; readonly original: string; readonly suggestion: string; readonly rewritten: '' } | undefined
  >(undefined);
  const [refactorIssueId, setRefactorIssueId] = useState<string | undefined>(undefined);
  const [pendingIssueLocation, setPendingIssueLocation] = useState<
    { readonly nodeId: string; readonly quote: string | undefined } | undefined
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

  // 切换章节时清除旧问题选中与高亮（避免跨章错位连线）。
  useEffect(() => {
    clearFinding();
    manuscriptRef.current?.clearHighlight();
  }, [selectedNodeId, clearFinding]);

  // 跨章节定位必须等待目标章节正文完成加载，再尝试证据引文高亮。
  useEffect(() => {
    if (
      pendingIssueLocation === undefined ||
      selectedNodeId !== pendingIssueLocation.nodeId ||
      contentNodeId !== pendingIssueLocation.nodeId ||
      loadingContent
    ) {
      return;
    }
    const quote = pendingIssueLocation.quote;
    if (quote !== undefined && quote.length > 0) {
      manuscriptRef.current?.highlightQuote(quote);
    }
    setPendingIssueLocation(undefined);
  }, [content, contentNodeId, loadingContent, pendingIssueLocation, selectedNodeId]);

  // 改写拼回落盘成功后重载当前章节正文，呈现磁盘变更。
  const onRefactorApplied = useCallback(
    (nodeId: string): void => {
      selectChapter(nodeId);
    },
    [selectChapter],
  );
  const refactor = useRefactor(onRefactorApplied, workflowRef, refactorIssueId, workflowState.snapshot?.version);

  const taskUiExecutors = useMemo(() => ({
    selectChapter,
    highlightQuote: async (chapterId: string, quote: string): Promise<void> => {
      await selectChapter(chapterId);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        if (manuscriptRef.current?.highlightQuote(quote) === true) return;
      }
      throw new Error('目标章节已打开，但诊断引文未能在当前正文中高亮');
    },
    // Diff 效果：先切到差异所属章节（正文读取失败则抛出，回执为失败），再打开改写审阅面板（Diff 双栏 + 逐 hunk）。
    showDiff: async (nodeId: string, _diffId: string): Promise<void> => {
      await selectChapter(nodeId);
      setRefactorOpen(true);
    },
    // Hunk 审核效果：改写审阅面板即逐处 accept/reject 的落点。
    showHunkReview: async (_refactorRunId: string): Promise<void> => { setRefactorOpen(true); },
    // checkpoint 效果：检查点在改写审阅面板的落盘态呈现（含可回滚 checkpoint id），而非任务中心。
    showCheckpoint: async (_checkpointId: string): Promise<void> => { setRefactorOpen(true); },
    openFactSheet: async (): Promise<void> => { setFactSheetOpen(true); },
    openDashboard: async (): Promise<void> => { setDashOpen(true); },
  }), [selectChapter]);
  useTaskUiEffects(taskStream.activities, taskUiExecutors);

  // 问题定位按稳定章节锚点跳转；有证据引文时，等待正文加载后再精确高亮。
  const handleLocateIssue = useCallback((issue: ConsistencyIssueDto): void => {
    const target = resolveIssueChapterTarget(issue, selectedNodeId);
    if (!target.enabled) return;
    const quote = issue.evidence?.quote;
    setPendingIssueLocation({
      nodeId: target.targetChapterId,
      ...(quote !== undefined && quote.length > 0 ? { quote } : { quote: undefined }),
    });
    selectChapter(target.targetChapterId);
  }, [selectChapter, selectedNodeId]);

  // 采纳问题：仅预填证据引文；suggestedFix 作为只读建议，实际改写正文保持为空。
  const handleRefactorOpenChange = useCallback((open: boolean): void => {
    setRefactorOpen(open);
    if (!open) {
      setRefactorPrefill(undefined);
      setRefactorIssueId(undefined);
    }
  }, []);

  const handleAdoptIssue = useCallback((issue: ConsistencyIssueDto): void => {
    const intent = buildIssueRefactorIntent(issue, selectedNodeId);
    if (!intent.enabled) return;
    setRefactorPrefill(intent.prefill);
    setRefactorIssueId(intent.issueId);

    setPendingIssueLocation({ nodeId: intent.targetChapterId, quote: intent.prefill.original });
    selectChapter(intent.targetChapterId);
    setRefactorOpen(true);
  }, [selectChapter, selectedNodeId]);

  /** 4.3 定位完成后的「进入局部改写」下一步入口：用已定位的章节/原文/问题预填改写面板。 */
  const enterRefactorFromLocatedSource = useCallback(
    (params: { readonly chapterId: string; readonly quote: string; readonly issueId?: string }): void => {
      if (params.quote.length === 0) return;
      setRefactorPrefill({ nodeId: params.chapterId, original: params.quote, suggestion: '', rewritten: '' });
      setRefactorIssueId(params.issueId);
      setPendingIssueLocation({ nodeId: params.chapterId, quote: params.quote });
      selectChapter(params.chapterId);
      setRefactorOpen(true);
    },
    [selectChapter],
  );

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
          setFactSheetOpen(true);
          if (selectedNodeId !== undefined) factExtraction.extractCurrentChapter(selectedNodeId);
          return;
        case 'fact-backfill-all':
          setFactSheetOpen(true);
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

  // 读书模式的极简后台状态：只区分「在忙」与「等你裁决」，不暴露技术细节。
  const backgroundBusy =
    factExtraction.busy || dashboard.busy || refactor.busy || activeRunId !== undefined;
  const backgroundNeedsAttention =
    pendingConflict !== undefined ||
    factExtraction.state.status === 'interrupted' ||
    assetReview.pendingIds.size > 0;
  const liveTaskActivityItems = useMemo(
    () =>
      buildTaskActivityFeed({
        workflow: workflowState.snapshot,
        modelTask: latestFactModelTask,
        modelTaskChapterLabel,
        dashboard: dashboard.state,
        trace: workbenchTrace,
        taskEvents: taskStream.events,
      }),
    [dashboard.state, latestFactModelTask, modelTaskChapterLabel, taskStream.events, workbenchTrace, workflowState.snapshot],
  );
  const [taskActivityItems, setTaskActivityItems] = useState(liveTaskActivityItems);
  useEffect(() => {
    setTaskActivityItems((previous) => {
      const incomingHasActivity = liveTaskActivityItems.some((item) => item.id !== 'idle');
      const base = incomingHasActivity ? previous.filter((item) => item.id !== 'idle') : previous;
      const knownIds = new Set(base.map((item) => item.id));
      const additions = liveTaskActivityItems.filter((item) => !knownIds.has(item.id));
      if (additions.length === 0) return base;
      return [...base, ...additions].slice(-100);
    });
  }, [liveTaskActivityItems]);
  const footerTaskActivityItems = useMemo(() => {
    const attention = taskActivityItems.filter((item) => item.tone === 'error' || item.tone === 'waiting');
    const latest = taskActivityItems.slice(-3);
    const selected = [...attention.slice(-2), ...latest];
    const unique = selected.filter((item, index) => selected.findIndex((candidate) => candidate.id === item.id) === index);
    return unique.slice(-3);
  }, [taskActivityItems]);

  const handleSelectFinding = useCallback((runId: string, index: number): void => {
    selectFinding(runId, index);
    const issueId = findingsByRun.get(runId)?.issues[index]?.issueId;
    const snapshot = workflowState.snapshot;
    if (issueId === undefined || snapshot === null || workflowRef === undefined) return;
    const requestId = crypto.randomUUID();
    void window.novelAgent.sendWorkflowCommand({
      type: 'workflow-select-issue',
      requestId,
      operationId: requestId,
      expectedVersion: snapshot.version,
      workflowId: snapshot.workflowId,
      stageId: workflowRef.stageId,
      issueId,
      workflowRef: { ...workflowRef, issueId },
    }).then((response) => {
      if (response.snapshot !== null) workflowState.acceptSnapshot(response.snapshot);
    });
  }, [findingsByRun, selectFinding, workflowRef, workflowState]);

  // ── 左栏多上下文清单（3.3）：全部由后端投影 DTO 派生 + 绑定既有回调，Renderer 不查询 DB/LLM/fs。──
  // 问题：审校结果按 run 展平；点击复用 handleSelectFinding（选中 + 若属工作流则 select-issue）并定位章节。
  const navIssueEntries = useMemo((): ReadonlyArray<NavListEntry> => {
    const entries: NavListEntry[] = [];
    for (const [runId, finding] of findingsByRun) {
      finding.issues.forEach((issue, index) => {
        const active = activeFinding?.runId === runId && activeFinding.index === index;
        entries.push({
          id: `${runId}:${index}`,
          title: issue.description,
          subtitle: issue.type,
          badge: issue.severity === 'critical' ? '红牌' : issue.severity === 'warning' ? '黄牌' : '提示',
          badgeTone: issue.severity === 'critical' ? 'critical' : issue.severity === 'warning' ? 'warning' : 'info',
          active,
          onClick: () => {
            handleSelectFinding(runId, index);
            handleLocateIssue(issue);
          },
        });
      });
    }
    return entries;
  }, [findingsByRun, activeFinding, handleSelectFinding, handleLocateIssue]);

  // 人物：事实库中 type==='person' 的实体；点击打开事实库抽屉查阅。
  const navCharacterEntries = useMemo((): ReadonlyArray<NavListEntry> => {
    const entities = navStoryBible.bible?.entities ?? [];
    return entities
      .filter((entity) => entity.type === 'person')
      .map((entity) => ({
        id: entity.id,
        title: entity.canonicalName,
        ...(entity.aliases.length > 0 ? { subtitle: `别名：${entity.aliases.join('、')}` } : {}),
        badge: entity.status === 'conflicting' ? '冲突' : entity.status === 'inferred' ? '推断' : '已确认',
        badgeTone: entity.status === 'conflicting' ? 'warning' : entity.status === 'inferred' ? 'muted' : 'info',
        onClick: () => setBibleOpen(true),
      }));
  }, [navStoryBible.bible]);

  // 故事线：事实库中的伏笔（plot hook）；点击优先跳其埋设章节，否则打开事实库抽屉。
  const navStorylineEntries = useMemo((): ReadonlyArray<NavListEntry> => {
    const hooks = navStoryBible.bible?.plotHooks ?? [];
    const stateLabel: Readonly<Record<string, string>> = {
      planted: '已埋设', pending: '待回收', paid_off: '已回收', abandoned: '已弃用',
    };
    return hooks.map((hook) => {
      const plantedChapter = hook.plantedAt.kind === 'chapter' ? hook.plantedAt.id : undefined;
      return {
        id: hook.id,
        title: hook.description,
        ...(hook.status === 'conflicting' ? { subtitle: '存在冲突，待裁决' } : {}),
        badge: stateLabel[hook.state] ?? hook.state,
        badgeTone: hook.state === 'abandoned' ? 'muted' : hook.state === 'paid_off' ? 'info' : 'warning',
        onClick: () => {
          if (plantedChapter !== undefined) selectChapter(plantedChapter);
          else setBibleOpen(true);
        },
      };
    });
  }, [navStoryBible.bible, selectChapter]);

  // 任务产物：任务活动流里带产物引用的活动；点击跳章节产物（chapter: 前缀）或打开任务中心。
  const navArtifactEntries = useMemo((): ReadonlyArray<NavListEntry> => {
    const entries: NavListEntry[] = [];
    const seen = new Set<string>();
    const kindLabel: Readonly<Record<string, string>> = {
      'source-location': '原文定位', 'source-location-candidates': '定位候选', diff: '改写差异',
      checkpoint: '检查点', 'fact-sheet': '事实底稿', diagnosis: '诊断', draft: '草稿',
    };
    for (const activity of taskStream.activities) {
      if (activity.type !== 'task-activity') continue;
      for (const artifact of activity.artifactRefs ?? []) {
        if (seen.has(artifact.ref)) continue;
        seen.add(artifact.ref);
        const chapterId = artifact.ref.startsWith('chapter:')
          ? artifact.ref.slice('chapter:'.length).split(':')[0]
          : undefined;
        entries.push({
          id: artifact.ref,
          title: artifact.label,
          badge: kindLabel[artifact.kind] ?? artifact.kind,
          badgeTone: 'muted',
          onClick: () => {
            if (chapterId !== undefined && chapterId.length > 0) selectChapter(chapterId);
            else setTaskActivityOpen(true);
          },
        });
      }
    }
    return entries;
  }, [taskStream.activities, selectChapter]);

  const chooseSourceLocation = useCallback((taskRunId: string, candidateId: string): void => {
    window.novelAgent.sendCommand({
      type: 'choose-source-location',
      runId: crypto.randomUUID(),
      operationId: `choose-source-location:${taskRunId}:${candidateId}`,
      taskRunId,
      candidateId,
    });
  }, []);

  const controlTask = useCallback((taskRunId: string, action: 'pause' | 'resume' | 'cancel'): void => {
    window.novelAgent.sendCommand({
      type: 'control-task-run',
      runId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      taskRunId,
      action,
    });
  }, []);

  // 3.4：作者向当前活动任务补充约束。runId 从该任务最新一条事件的 executionRunId 派生（Main 仅按 operationId 幂等、不校验 runId）。
  const supplementRunId = useMemo((): string | undefined => {
    const active = taskStream.activeTaskRunId;
    if (active === undefined) return undefined;
    for (let i = taskStream.events.length - 1; i >= 0; i -= 1) {
      const event = taskStream.events[i];
      if (event !== undefined && event.taskRunId === active) return event.runId;
    }
    return undefined;
  }, [taskStream.activeTaskRunId, taskStream.events]);

  const supplementTask = useCallback((constraint: string): void => {
    const taskRunId = taskStream.activeTaskRunId;
    if (taskRunId === undefined) return;
    window.novelAgent.sendCommand({
      type: 'supplement-task-input',
      runId: (supplementRunId ?? crypto.randomUUID()) as RunId,
      operationId: `supplement-task-input:${taskRunId}:${crypto.randomUUID()}`,
      taskRunId,
      constraint,
    });
  }, [supplementRunId, taskStream.activeTaskRunId]);

  const locateSourceIssueId = workflowState.snapshot?.selectedIssueId ?? activeIssue?.issueId;
  const runLocateSource = useCallback((): void => {
    if (workflowRef === undefined || locateSourceIssueId === undefined) return;
    window.novelAgent.sendCommand({
      type: 'locate-source',
      runId: crypto.randomUUID(),
      workflowRef: { ...workflowRef, issueId: locateSourceIssueId },
    });
  }, [locateSourceIssueId, workflowRef]);

  // 任务化 UI 文案（信息架构收敛，§7.5/§7.6）：中栏空状态与右栏助手角色随当前阶段切换。
  const manuscriptEmpty = manuscriptEmptyCopy(workflowState.snapshot);
  const assistant = assistantCopy(workflowState.snapshot);

  // 对话轴单实例：工作台右栏与对话专注模式共用同一棵组件树（保留草稿/滚动状态）。
  const dialogueAxis = (
    <DialogueAxis
      turns={turns}
      activeRunId={activeRunId}
      pendingConflict={pendingConflict}
      findingsByRun={findingsByRun}
      activeFinding={activeFinding}
      onAsk={ask}
      askTargetLabel={conversationAgentLabel}
      assistantTitle={assistant.title}
      assistantEmptyHint={assistant.emptyHint}
      onAbort={abort}
      onApproveConflict={approveConflict}
      onRejectConflict={rejectConflict}
      onModifyConflict={modifyConflict}
      onLocateConflict={handleLocateIssue}
      onAdoptConflict={handleAdoptIssue}
      onSelectFinding={handleSelectFinding}
      onAdoptFinding={handleAdoptIssue}
      onSummonExpert={() => setPaletteOpen(true)}
      canSupplementTask={taskStream.activeTaskRunId !== undefined}
      onSupplementTask={supplementTask}
    />
  );

  const bookTitle = tree?.title.trim();
  // 三模式可见面矩阵（task 10.7/10.10）：与 orchestration 冲烟同源，互斥关系不在 JSX 里散落判断。
  const surfaces = resolveViewModeSurfaces(viewMode);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {surfaces.header && (
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex shrink-0 items-center gap-2 font-semibold">
              <BookOpenText className="size-5 text-primary" aria-hidden />
              <span>Novel Agent</span>
            </div>
            {/* 书架 / 当前书目面包屑（task 10.1）。 */}
            {bookTitle !== undefined && bookTitle.length > 0 && (
              <nav className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground" aria-label="书目">
                <span className="opacity-50">/</span>
                <span className="truncate">《{bookTitle}》</span>
                <span className="opacity-50">/</span>
                <span className="shrink-0 text-foreground">书目整理</span>
              </nav>
            )}
          </div>
          <div className="flex items-center gap-1">
            {workflowState.snapshot !== null && (
              <button
                type="button"
                onClick={() => setGoalOpen(true)}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                title="编辑本次整理目标与具体要求"
              >
                <Target className="size-3.5" aria-hidden />
                设定目标
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode('reading')}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="全屏阅读当前书稿（Esc 返回）"
            >
              <BookOpen className="size-3.5" aria-hidden />
              读书
            </button>
            <button
              type="button"
              onClick={() => setViewMode('conversation')}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="全屏与专家对话（Esc 返回）"
            >
              <MessagesSquare className="size-3.5" aria-hidden />
              专注对话
            </button>
            <ThemeToggle />
          </div>
        </header>
      )}

      {error !== undefined && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-1 text-sm text-destructive">
          {error}
        </div>
      )}

      {surfaces.readingSurface && (
        <div className="min-h-0 flex-1">
          <ReadingMode
            tree={tree}
            selectedNodeId={selectedNodeId}
            chapterPath={selectedChapterPath}
            content={content}
            loading={loadingContent}
            backgroundBusy={backgroundBusy}
            backgroundNeedsAttention={backgroundNeedsAttention}
            onSelectChapter={selectChapter}
            onExit={() => setViewMode('workbench')}
          />
        </div>
      )}

      {surfaces.conversationSurface && (
        <div className="min-h-0 flex-1">
          <ConversationMode
            expertLabel={conversationAgentLabel}
            chapterPath={selectedChapterPath}
            onExit={() => setViewMode('workbench')}
          >
            {dialogueAxis}
          </ConversationMode>
        </div>
      )}

      {/* 工作台主体：非 workbench 模式仅隐藏不卸载，保留滚动位置/高亮/栏宽与后台订阅。 */}
      <div className={surfaces.workbenchBodyVisible ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <WorkflowGraph
          projectId={workspaceProjectId}
          tree={tree}
          workflow={workflowState.snapshot}
          loading={workflowState.loading}
          queryFailure={workflowState.failure}
          onSnapshot={workflowState.acceptSnapshot}
          taskBusy={factExtraction.busy || dashboard.busy}
          onBackfillFacts={() => {
            if (workflowRef !== undefined) {
              setFactSheetOpen(true);
              factExtraction.backfillAll(workflowRef);
            }
          }}
          onRunGlobalAudit={() => {
            if (workflowRef === undefined) return;
            setDashOpen(true);
            dashboard.runGlobalAudit(workflowRef);
          }}
          onOpenFactSheet={() => setFactSheetOpen(true)}
          onOpenStoryBible={() => setBibleOpen(true)}
          onOpenGoal={() => setGoalOpen(true)}
          onOpenDashboard={() => setDashOpen(true)}
          onOpenIssues={() => setNavContext('issues')}
          onOpenRefactor={() => setRefactorOpen(true)}
          onLocateSource={runLocateSource}
          onSelectLocateSourceIssue={() => setNavContext('issues')}
          canLocateSource={locateSourceIssueId !== undefined}
        />

        <CurrentTaskCard
          workflow={workflowState.snapshot}
          events={taskStream.events}
          {...(activeIssue === undefined ? {} : { activeIssue })}
          onOpenTaskCenter={() => setTaskActivityOpen(true)}
          onChooseSourceLocation={chooseSourceLocation}
          onControlTask={controlTask}
          onEnterRefactor={enterRefactorFromLocatedSource}
        />

        <ExpertWorkbench
          activities={workbenchActivities}
          trace={workbenchTrace}
          objective={workbenchObjective}
          targetAgent={workbenchTargetAgent}
          observation={workbenchObservation}
          workflow={workflowState.snapshot}
          assetCandidates={assetReview.candidates}
          currentAssets={assetReview.currentAssets}
          assetImpacts={assetReview.impacts}
          assetPendingIds={assetReview.pendingIds}
          assetError={assetReview.error}
          onConfirmAsset={assetReview.confirmCandidate}
          onRejectAsset={assetReview.rejectCandidate}
          onResolveImpact={assetReview.resolveImpact}
        />

        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="novel-agent.layout"
          className="min-h-0 flex-1"
        >
          <ResizablePanel defaultSize={18} minSize={12} maxSize={34} className="min-h-0">
            <NavAxis
              tree={tree}
              selectedNodeId={selectedNodeId}
              onSelect={selectChapter}
              activeContext={navContext}
              onContextChange={setNavContext}
              issues={navIssueEntries}
              characters={navCharacterEntries}
              storylines={navStorylineEntries}
              artifacts={navArtifactEntries}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={56} minSize={30} className="min-h-0">
            <ManuscriptAxis ref={manuscriptRef} content={content} loading={loadingContent} selectedNodeId={selectedNodeId} emptyState={manuscriptEmpty} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={26} minSize={16} maxSize={44} className="min-h-0">
            {surfaces.dialogueAxisInPanel ? dialogueAxis : null}
          </ResizablePanel>
        </ResizablePanelGroup>

        <StatusFooter
          items={footerTaskActivityItems}
          needsFactRuling={
            factExtraction.state.status === 'interrupted' || latestFactModelTask?.status === 'awaiting-author'
          }
          onOpenActivities={() => setTaskActivityOpen(true)}
          onOpenFactSheet={() => setFactSheetOpen(true)}
        />
      </div>

      <ToolboxDrawer
        selectedNodeId={selectedNodeId}
        open={toolboxOpen}
        onOpenChange={setToolboxOpen}
        onSummon={summon}
        onOpenBoard={handleOpenBoard}
        onAction={handleAction}
      />

      {/* Hero 连线为全屏工作台专属（task 10.10）：其他模式下卸载，停止坐标计算；
          返回后仅当选中问题与锚点仍存在时自然恢复。 */}
      {surfaces.findingConnector && (
        <FindingConnector
          runId={activeFinding?.runId}
          index={activeFinding?.index}
          severity={activeIssue?.severity}
        />
      )}

      <CommandPalette
        selectedNodeId={selectedNodeId}
        onSummon={summon}
        onOpenBoard={() => setBoardOpen(true)}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
      {workflowState.snapshot !== null && (
        <GoalDialog
          open={goalOpen}
          onOpenChange={setGoalOpen}
          workflow={workflowState.snapshot}
          onSnapshot={workflowState.acceptSnapshot}
        />
      )}
      <TaskActivityDrawer
        open={taskActivityOpen}
        onOpenChange={setTaskActivityOpen}
        items={taskActivityItems}
        onOpenFactSheet={() => {
          setTaskActivityOpen(false);
          setFactSheetOpen(true);
        }}
        onOpenDashboard={() => {
          setTaskActivityOpen(false);
          setDashOpen(true);
        }}
        onOpenConversation={() => {
          setTaskActivityOpen(false);
          setViewMode('conversation');
        }}
      />
      <FactSheetDrawer
        open={factSheetOpen}
        onOpenChange={setFactSheetOpen}
        onOpenBible={() => {
          setFactSheetOpen(false);
          setBibleOpen(true);
        }}
        panelProps={{
          state: factExtraction.state,
          busy: factExtraction.busy,
          ...(currentExtractionChapterLabel === undefined
            ? {}
            : { currentChapterLabel: currentExtractionChapterLabel }),
          onRetry: retryFactExtraction,
          onAbort: factExtraction.abort,
          onResolveConflict: factExtraction.resolveConflict,
          onRejectConflict: factExtraction.rejectConflict,
          onClear: factExtraction.clear,
          ...(currentModelTask === undefined
            ? {}
            : {
                taskAttempt: currentModelTask,
                onRetryTask: modelTasks.retry,
                onAbortTask: modelTasks.abort,
                onSupplementTask: modelTasks.supplement,
              }),
        }}
      />
      <ArchitectBoardDrawer open={boardOpen} onOpenChange={setBoardOpen} />
      <StoryBibleDrawer open={bibleOpen} onOpenChange={setBibleOpen} />
      <DashboardDrawer
        open={dashOpen}
        onOpenChange={setDashOpen}
        dashboard={dashboard}
        onSelectChapter={selectChapter}
        workflow={workflowState.snapshot}
        {...(workflowRef !== undefined ? { workflowRef } : {})}
      />
      <RefactorReviewPanel
        open={refactorOpen}
        onOpenChange={handleRefactorOpenChange}
        selectedNodeId={selectedNodeId}
        contentNodeId={contentNodeId}
        content={content}
        loadingContent={loadingContent}
        refactor={refactor}
        prefill={refactorPrefill}
      />
    </div>
  );
}
