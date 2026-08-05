/**
 * 面向作者的业务 Workflow Graph (workflow-guided-workbench tasks 10.1 / 10.4)
 *
 * 取代旧的纵向工作流任务大卡：
 * - 未启动：一行启动表单（书目类型 + 目标 + 启动按钮；重建要求在「设定目标」弹层继续维护）
 * - 已启动：横向阶段 Graph（作者语言的阶段标签 + 状态染色）+ 当前任务一句话 + 对应动作按钮
 * 阶段状态来自 workflow snapshot；内部 stage id/actor/version/impact 不进入主视图。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CirclePause,
  LoaderCircle,
  Play,
  RotateCcw,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getBuiltinWorkflowTemplate } from '../../core/workflow/templates.js';
import type { WorkflowKind } from '../../core/workflow/types.js';
import type { ChapterTreeDto, WorkflowSnapshotDto } from '../../shared/ipc/index.js';
import { factStageDestination, legacyStageGuide, locateSourceActionView, type LegacyStageSurface } from '../lib/workbench-view-contracts.js';

interface WorkflowGraphProps {
  readonly projectId: string | undefined;
  readonly tree: ChapterTreeDto | undefined;
  readonly workflow: WorkflowSnapshotDto | null;
  readonly loading: boolean;
  readonly queryFailure: string | undefined;
  readonly onSnapshot: (snapshot: WorkflowSnapshotDto) => void;
  readonly onBackfillFacts?: () => void;
  readonly onRunGlobalAudit?: () => void;
  /** 打开进行中的事实核对任务面板。 */
  readonly onOpenFactSheet?: () => void;
  /** 打开已沉淀的全书事实库。 */
  readonly onOpenStoryBible?: () => void;
  readonly onOpenGoal?: () => void;
  readonly onOpenDashboard?: () => void;
  readonly onOpenIssues?: () => void;
  readonly onOpenRefactor?: () => void;
  readonly onLocateSource?: () => void;
  readonly onSelectLocateSourceIssue?: () => void;
  readonly canLocateSource?: boolean;
  readonly taskBusy: boolean;
}

interface StageSnapshot {
  readonly stageId: string;
  readonly templateStageId: string;
  readonly status: string;
  readonly actor: string;
  readonly blockingReason?: unknown;
}

function stageSnapshot(value: Record<string, unknown>): StageSnapshot {
  return {
    stageId: String(value['stageId'] ?? ''),
    templateStageId: String(value['templateStageId'] ?? ''),
    status: String(value['status'] ?? 'pending'),
    actor: String(value['actor'] ?? 'system'),
    ...(value['blockingReason'] === undefined ? {} : { blockingReason: value['blockingReason'] }),
  };
}

function blockingLabel(reason: unknown): string | undefined {
  if (reason === null || typeof reason !== 'object') return undefined;
  const record = reason as Record<string, unknown>;
  const kind = String(record['kind'] ?? 'unknown');
  if (kind === 'failed-run') return `运行失败${typeof record['message'] === 'string' ? `：${record['message']}` : ''}`;
  if (kind === 'missing-anchor') return '缺少稳定正文锚点';
  if (kind === 'interrupted-run') return `等待人工裁决${typeof record['message'] === 'string' ? `：${record['message']}` : ''}`;
  if (kind === 'quality-gate') return '质量检查发现未解决问题';
  if (kind === 'asset-impact') return '设定变更影响尚未处理';
  if (kind === 'version-conflict') return '工作流版本已变化，请刷新后重试';
  return `阻塞：${kind}`;
}

/** 作者语言的当前任务一句话（沿用既有 guidance 文案的 goal 部分）。 */
export const WORKFLOW_TASK_GOAL: Readonly<Record<string, string>> = {
  'import-book': '确认这次重建要保留什么、解决什么',
  'fact-backfill': '先建立全书事实底稿，不改正文',
  'initial-audit': '诊断全书结构，暂不改正文',
  'issue-triage': '决定哪些保留、哪些重建、哪些局部修补',
  'locate-source': '定位当前问题影响的原文',
  'generate-rewrite': '为当前问题生成局部改写方案',
  'hunk-review': '逐处决定接受或拒绝改动',
  'apply-checkpoint': '应用已接受的修改',
  'targeted-verification': '确认当前问题是否真正修好',
  'close-issue': '归档当前问题的修复结果',
  'final-audit': '对修订后的全书做最终复检',
  // 新书创作模板阶段（与 legacy 阶段 id 不重叠）。
  concept: '确立作品立意与类型定位',
  worldbuilding: '搭建世界观设定基线',
  'character-design': '设计互补的人物阵容与关系',
  'book-outline': '规划全书主线与关键转折',
  'chapter-plan': '把大纲拆解为卷章结构',
  'scene-outline': '把本章目标拆解为分场节拍',
  'draft-writing': '按分场大纲写出本章初稿',
  'fact-extraction': '从定稿章节更新事实底稿',
  'automatic-review': '对本章做连贯性与设定一致性检查',
  'author-review': '由作者审阅并修订本章',
  'chapter-finalization': '定稿本章并决定下一章走向',
  'whole-book-audit': '对全书做整体总检',
};



function stageTone(status: string, isCurrent: boolean): string {
  if (isCurrent) return 'border-primary bg-primary/15 font-medium text-primary ring-1 ring-primary/30';
  if (status === 'completed' || status === 'skipped') return 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (status === 'failed') return 'border-destructive/60 bg-destructive/10 text-destructive';
  if (status === 'blocked') return 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return 'border-border bg-background text-muted-foreground/75';
}

function stageStateLabel(status: string, isCurrent: boolean): string {
  if (isCurrent && status === 'ready') return '当前·待开始';
  if (isCurrent && status === 'running') return '当前·进行中';
  if (isCurrent && status === 'awaiting-confirmation') return '当前·待确认';
  if (status === 'completed') return '已完成';
  if (status === 'skipped') return '已跳过';
  if (status === 'failed') return '失败';
  if (status === 'blocked') return '受阻';
  return '后续';
}

export function WorkflowGraph({
  projectId,
  tree,
  workflow,
  loading,
  queryFailure,
  onSnapshot,
  onBackfillFacts,
  onRunGlobalAudit,
  onOpenFactSheet,
  onOpenStoryBible,
  onOpenGoal,
  onOpenDashboard,
  onOpenIssues,
  onOpenRefactor,
  onLocateSource,
  onSelectLocateSourceIssue,
  canLocateSource = false,
  taskBusy,
}: WorkflowGraphProps): JSX.Element {
  const hasExistingChapters = (tree?.roots.length ?? 0) > 0;
  const [kind, setKind] = useState<WorkflowKind>('new-book-creation');
  const [objective, setObjective] = useState('完成小说创作工作流');
  const initializedForProject = useRef(false);
  const [busy, setBusy] = useState(false);
  const [commandFailure, setCommandFailure] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string>();
  const rawStages = useMemo(() => workflow?.stages.map(stageSnapshot) ?? [], [workflow]);
  const template = workflow === null
    ? undefined
    : getBuiltinWorkflowTemplate(workflow.kind as WorkflowKind, Number(workflow.templateVersion));
  // 持久化数组可能受 issue/chapter 循环影响；主视图始终按业务模板顺序呈现。
  const stages = useMemo(() => {
    if (template === undefined) return rawStages;
    const order = new Map(template.stages.map((item, index) => [item.id, index]));
    return [...rawStages].sort(
      (left, right) => (order.get(left.templateStageId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.templateStageId) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [rawStages, template]);
  const current = stages.find((stage) => stage.stageId === workflow?.currentStageId);
  const definition = template?.stages.find((stage) => stage.id === current?.templateStageId);
  const failure = commandFailure ?? queryFailure;

  useEffect(() => {
    if (workflow !== null || tree === undefined || initializedForProject.current) return;
    initializedForProject.current = true;
    if (!hasExistingChapters) return;
    setKind('legacy-book-revision');
    setObjective(`保留《${tree.title}》的亮点，重建人物特征、故事线与逻辑线，排除结构性风险后再修订正文`);
  }, [hasExistingChapters, tree, workflow]);

  const send = async (
    command: Parameters<typeof window.novelAgent.sendWorkflowCommand>[0],
  ): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setCommandFailure(undefined);
    try {
      const response = await window.novelAgent.sendWorkflowCommand(command);
      if (response.failure !== undefined) {
        setCommandFailure(response.failure.error.message);
        return false;
      }
      if (response.snapshot !== null) onSnapshot(response.snapshot);
      return true;
    } catch (error: unknown) {
      setCommandFailure(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startWorkflow = (): void => {
    if (projectId === undefined || objective.trim().length === 0) return;
    void send({
      type: 'start-workflow',
      projectId,
      kind,
      objective: objective.trim(),
      requestId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
    });
  };

  const action = (type: 'start-stage' | 'confirm-stage' | 'retry-stage' | 'pause' | 'resume'): void => {
    if (workflow === null) return;
    const operationId = crypto.randomUUID();
    void send({
      type: `workflow-${type}`,
      workflowId: workflow.workflowId,
      expectedVersion: workflow.version,
      requestId: crypto.randomUUID(),
      operationId,
      ...(current === undefined ? {} : { stageId: current.stageId }),
      ...(type === 'retry-stage' ? { runId: operationId } : {}),
    });
  };

  if (loading && workflow === null) {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-card/70 px-4 py-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        正在读取项目工作流…
      </div>
    );
  }

  if (workflow === null) {
    return (
      <section className="border-b border-primary/25 bg-primary/5 px-4 py-2" aria-label="启动书目整理">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Workflow className="size-4 text-primary" />
            {hasExistingChapters ? '这是一部已有小说，建议先做“老书重建”' : '尚未开始整理'}
          </span>
          <select
            className="rounded border border-border bg-background px-2 py-1 text-xs"
            value={kind}
            onChange={(event) => setKind(event.target.value as WorkflowKind)}
          >
            <option value="new-book-creation">新书创作</option>
            <option value="legacy-book-revision">老书重建与修订</option>
          </select>
          <input
            className="min-w-64 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="先说清楚这次要保留什么、重建什么"
          />
          <Button size="sm" disabled={busy || projectId === undefined || objective.trim().length === 0} onClick={startWorkflow}>
            {busy ? '启动中…' : kind === 'legacy-book-revision' ? '开始整理这本书' : '开始新书创作'}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">启动后可随时在顶部「设定目标」里补充要保留/提取/修复的具体要求。</p>
        {projectId === undefined && <p className="mt-1 text-xs text-amber-600">正在等待项目身份，暂不能启动。</p>}
        {failure !== undefined && <p className="mt-1 text-xs text-destructive">工作流加载失败：{failure}</p>}
      </section>
    );
  }

  const actionBusy = busy || taskBusy;
  const completedCount = stages.filter((stage) => stage.status === 'completed' || stage.status === 'skipped').length;
  const currentLabel = current === undefined ? '整理完成' : definition?.label ?? WORKFLOW_TASK_GOAL[current.templateStageId] ?? '当前任务';
  const currentIndex = current === undefined ? -1 : stages.findIndex((stage) => stage.stageId === current.stageId);
  const nextStage = currentIndex < 0 ? undefined : stages[currentIndex + 1];
  const nextLabel = nextStage === undefined ? undefined : template?.stages.find((stage) => stage.id === nextStage.templateStageId)?.label;
  const statusLabel = workflow.status === 'active' ? undefined
    : workflow.status === 'paused' ? '已暂停'
    : workflow.status === 'completed' ? '已完成'
    : workflow.status === 'cancelled' ? '已取消'
    : '失败';
  const blocking = current === undefined ? undefined : blockingLabel(current.blockingReason);
  const locateAction = locateSourceActionView(canLocateSource);
  const selectedStage = stages.find((stage) => stage.stageId === selectedStageId);
  const selectedDefinition = selectedStage === undefined ? undefined : template?.stages.find((stage) => stage.id === selectedStage.templateStageId);
  const selectedGuide = selectedStage === undefined ? undefined : legacyStageGuide(selectedStage.templateStageId);
  const openSurface = (surface: LegacyStageSurface, stageStatus: string): void => {
    setSelectedStageId(undefined);
    switch (surface) {
      case 'goal': onOpenGoal?.(); return;
      case 'story-bible':
        if (factStageDestination(stageStatus) === 'fact-task') onOpenFactSheet?.();
        else onOpenStoryBible?.();
        return;
      case 'fact-task': onOpenFactSheet?.(); return;
      case 'dashboard': onOpenDashboard?.(); return;
      case 'issues': onOpenIssues?.(); return;
      case 'refactor': onOpenRefactor?.(); return;
    }
  };

  return (
    <section className="border-b border-border bg-card/60 px-4 py-2" aria-label="书目整理进度">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded px-1 py-1 text-left text-xs transition-colors hover:bg-accent/50"
        aria-expanded={expanded}
      >
        <span className="font-medium text-foreground">已完成 {completedCount}/{stages.length} · 当前：{currentLabel}{nextLabel === undefined ? '' : ` · 下一步：${nextLabel}`}</span>
        <span className="text-muted-foreground">{expanded ? '收起完整流程' : '展开完整流程'}</span>
      </button>
      {expanded && <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6" role="list" aria-label="整理阶段">
        {stages.map((stage, index) => {
          const isCurrent = stage.stageId === workflow.currentStageId;
          const label = template?.stages.find((item) => item.id === stage.templateStageId)?.label ?? stage.templateStageId;
          const done = stage.status === 'completed' || stage.status === 'skipped';
          const guide = workflow.kind === 'legacy-book-revision' ? legacyStageGuide(stage.templateStageId) : undefined;
          const clickable = guide !== undefined;
          return (
            <button
              key={stage.stageId}
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => setSelectedStageId(stage.stageId) : undefined}
              title={clickable ? `${index + 1}. ${label}（点击查看阶段规则）` : `${index + 1}. ${label} · ${stageStateLabel(stage.status, isCurrent)}`}
              className={`flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${stageTone(stage.status, isCurrent)} ${clickable ? 'cursor-pointer hover:border-primary/60' : 'cursor-default'}`}
              aria-current={isCurrent ? 'step' : undefined}
              role="listitem"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-current/30 text-[10px]">
                {done ? <Check className="size-3" aria-hidden /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{label}</span>
                <span className="block text-[10px] opacity-70">{stageStateLabel(stage.status, isCurrent)}</span>
              </span>
              {isCurrent && stage.status === 'running' && <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />}
            </button>
          );
        })}
      </div>}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {statusLabel ?? (current?.status === 'running' ? '任务进行中' : current?.status === 'awaiting-confirmation' ? '等待作者确认' : '准备继续')}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {workflow.status === 'active' && current?.templateStageId === 'locate-source' && current.status === 'ready' && onLocateSource !== undefined && (
              <Button
                size="sm"
                disabled={actionBusy}
                onClick={locateAction.intent === 'locate' ? onLocateSource : onSelectLocateSourceIssue}
                title={locateAction.title}
              >
                <Play className="size-3.5" />
                {locateAction.label}
              </Button>
            )}
          {workflow.status === 'active' && current?.status === 'ready' && current.templateStageId !== 'fact-backfill' && current.templateStageId !== 'locate-source' &&
            !['initial-audit', 'final-audit', 'whole-book-audit'].includes(current.templateStageId) && (
              <Button size="sm" disabled={actionBusy} onClick={() => action('start-stage')}>
                <Play className="size-3.5" />
                开始这项任务
              </Button>
            )}
          {workflow.status === 'active' && current?.templateStageId === 'fact-backfill' &&
            (current.status === 'ready' || current.status === 'running') && onBackfillFacts !== undefined && (
              <Button size="sm" disabled={actionBusy || current.status === 'running'} onClick={onBackfillFacts}>
                {taskBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                {current.status === 'running' ? '正在建立事实底稿' : '建立全书事实底稿'}
              </Button>
            )}
          {workflow.status === 'active' &&
            (current?.templateStageId === 'initial-audit' || current?.templateStageId === 'final-audit' || current?.templateStageId === 'whole-book-audit') &&
            current.status === 'ready' && onRunGlobalAudit !== undefined && (
              <Button size="sm" disabled={actionBusy} onClick={onRunGlobalAudit}>
                {taskBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                开始全书诊断
              </Button>
            )}
          {workflow.status === 'active' && current?.status === 'awaiting-confirmation' && (
            <Button size="sm" disabled={actionBusy} onClick={() => action('confirm-stage')}>
              <CheckCircle2 className="size-3.5" />
              确认并进入下一步
            </Button>
          )}
          {workflow.status === 'active' && current?.status === 'running' && current.actor === 'author' && (
            <Button size="sm" disabled={actionBusy} onClick={() => action('confirm-stage')}>
              <CheckCircle2 className="size-3.5" />
              完成并进入下一步
            </Button>
          )}
          {workflow.status === 'active' && current?.status === 'failed' && (
            <Button size="sm" disabled={actionBusy} onClick={() => action('retry-stage')}>
              <RotateCcw className="size-3.5" />
              重试这项任务
            </Button>
          )}
          {workflow.status === 'active' && (
            <Button size="xs" variant="ghost" disabled={actionBusy} onClick={() => action('pause')} title="暂停整理">
              <CirclePause className="size-3.5" />
            </Button>
          )}
          {workflow.status === 'paused' && (
            <Button size="sm" disabled={actionBusy} onClick={() => action('resume')}>
              <Play className="size-3.5" />
              恢复整理
            </Button>
          )}
        </div>
      </div>

      {blocking !== undefined && (
        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="size-3" />
          {blocking}
        </p>
      )}
      {failure !== undefined && (
        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="size-3" />
          工作流操作失败：{failure}
        </p>
      )}

      <Dialog open={selectedStage !== undefined} onOpenChange={(open) => { if (!open) setSelectedStageId(undefined); }}>
        {selectedStage !== undefined && selectedGuide !== undefined && (
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedDefinition?.label ?? selectedStage.templateStageId}</DialogTitle>
              <DialogDescription>
                当前状态：{stageStateLabel(selectedStage.status, selectedStage.stageId === workflow.currentStageId)} · 执行者：{selectedDefinition?.actor === 'author' ? '作者' : selectedDefinition?.actor === 'expert' ? '专家' : selectedDefinition?.actor === 'quality-gate' ? '质量门' : '系统'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-md border p-3"><div className="mb-1 font-medium">开始标准</div><p className="text-muted-foreground">{selectedGuide.start}</p></div>
              <div className="rounded-md border p-3"><div className="mb-1 font-medium">完成标准</div><p className="text-muted-foreground">{selectedGuide.completion}</p></div>
              <div className="rounded-md border p-3"><div className="mb-1 font-medium">阶段产物</div><p className="text-muted-foreground">{selectedGuide.artifact}</p></div>
              <div className="rounded-md border p-3"><div className="mb-1 font-medium">人工如何介入</div><p className="text-muted-foreground">{selectedGuide.humanRole}</p></div>
              <div className="rounded-md border p-3"><div className="mb-1 font-medium">对事实库的影响</div><p className="text-muted-foreground">{selectedGuide.factImpact}</p></div>
              <div className="rounded-md border p-3"><div className="mb-1 font-medium">对原文的影响</div><p className="text-muted-foreground">{selectedGuide.manuscriptImpact}</p></div>
            </div>
            {selectedGuide.loop !== undefined && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"><span className="font-medium">循环规则：</span>{selectedGuide.loop}</div>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSelectedStageId(undefined)}>关闭</Button>
              <Button type="button" onClick={() => openSurface(selectedGuide.surface, selectedStage.status)}>{selectedGuide.surfaceLabel}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
