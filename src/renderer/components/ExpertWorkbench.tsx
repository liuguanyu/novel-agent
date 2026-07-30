/** 常驻专家工作台：只呈现本轮目标、目标专家与真实有序执行路径。 */

import { useState } from 'react';
import { workflowStageView } from '../hooks/useWorkflowSnapshot.js';
import { getBuiltinWorkflowTemplate } from '../../core/workflow/templates.js';
import type { WorkflowKind } from '../../core/workflow/types.js';
import type { AssetImpactDto, CreativeAssetCandidateDto, WorkflowSnapshotDto } from '../../shared/ipc/index.js';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, CircleDot, Workflow } from 'lucide-react';
import {
  WORKBENCH_GRAPH,
  type WorkbenchActivities,
} from '../../core/shell/workbench-graph.js';
import { WorkbenchGraph } from './WorkbenchGraph.js';
import type {
  WorkbenchTraceObservation,
  WorkbenchTraceStep,
} from '../hooks/useWorkbenchActivities.js';

interface ExpertWorkbenchProps {
  readonly activities: WorkbenchActivities;
  readonly trace: ReadonlyArray<WorkbenchTraceStep>;
  readonly objective: string | undefined;
  readonly targetAgent: string | undefined;
  readonly observation: WorkbenchTraceObservation | undefined;
  readonly workflow?: WorkflowSnapshotDto | null;
  readonly assetCandidates?: ReadonlyArray<CreativeAssetCandidateDto>;
  readonly currentAssets?: Readonly<Record<string, Record<string, unknown>>>;
  readonly assetImpacts?: ReadonlyArray<AssetImpactDto>;
  readonly assetPendingIds?: ReadonlySet<string>;
  readonly assetError?: string | undefined;
  readonly onConfirmAsset?: (candidate: CreativeAssetCandidateDto) => void;
  readonly onRejectAsset?: (candidate: CreativeAssetCandidateDto) => void;
  readonly onResolveImpact?: (impact: AssetImpactDto, intent: 'handle-now' | 'todo' | 'continue') => void;
}

function nodeLabel(id: string): string {
  return WORKBENCH_GRAPH.nodes.find((node) => node.id === id)?.label ?? id;
}

function stageStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'ready': return '待开始';
    case 'running': return '进行中';
    case 'awaiting-confirmation': return '待确认';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'blocked': return '已阻塞';
    case 'skipped': return '已跳过';
    default: return status ?? '待开始';
  }
}

function actorLabel(actor: string | undefined): string {
  switch (actor) {
    case 'author': return '作者';
    case 'expert': return '专家';
    case 'quality-gate': return '质量门';
    case 'system': return '系统';
    default: return actor ?? '未分配';
  }
}

function assetContentRows(content: unknown): ReadonlyArray<readonly [string, string]> {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return [['拟议内容', JSON.stringify(content)]];
  return Object.entries(content as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)] as const);
}

function activitySummary(activities: WorkbenchActivities): string | undefined {
  let running: string | undefined;
  for (const [node, activity] of activities) {
    if (activity.phase === 'awaiting') return `${nodeLabel(node)}待裁决`;
    if (activity.phase === 'running') running = `${nodeLabel(node)}运行中`;
  }
  return running;
}

export function ExpertWorkbench({
  activities,
  trace,
  objective,
  targetAgent,
  observation,
  workflow,
  assetCandidates = [],
  currentAssets = {},
  assetImpacts = [],
  assetPendingIds = new Set<string>(),
  assetError,
  onConfirmAsset,
  onRejectAsset,
  onResolveImpact,
}: ExpertWorkbenchProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const summary = activitySummary(activities);
  const targetLabel = targetAgent === undefined ? undefined : nodeLabel(targetAgent);
  const template = workflow === null || workflow === undefined
    ? undefined
    : getBuiltinWorkflowTemplate(workflow.kind as WorkflowKind, Number(workflow.templateVersion));
  const stages = workflow?.stages.map((rawStage) => {
    const stage = workflowStageView(rawStage);
    const definition = template?.stages.find((item) => item.id === rawStage['templateStageId']);
    return definition === undefined ? stage : { ...stage, name: definition.label, nextStep: definition.transitions[0]?.to };
  }) ?? [];
  const current = stages.find((stage) => stage.id === workflow?.currentStageId);
  const completedStages = stages.filter((stage) => stage.status === 'completed' || stage.status === 'skipped').length;
  const workflowSummary = workflow === null || workflow === undefined
    ? undefined
    : `${workflow.kind} · ${current?.name ?? '等待阶段'} · ${current?.blocking !== undefined ? `阻塞：${current.blocking}` : `下一步：${current?.nextStep ?? '等待推进'}`}${assetCandidates.length + assetImpacts.length > 0 ? ` · 待审 ${assetCandidates.length + assetImpacts.length}` : ''}`;
  return (
    <section className="border-t border-border bg-card/45 px-3 py-2" aria-label="专家工作台">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between gap-3 text-xs ${expanded ? 'mb-2' : ''}`}
      >
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          {expanded ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          <Workflow className="size-3.5 text-primary" aria-hidden />
          专家工作台{workflow !== null && workflow !== undefined && ` · ${workflow.kind}`}
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {summary !== undefined && <CircleDot className="size-3 animate-pulse text-primary" aria-hidden />}
          {workflowSummary ?? summary ??
            (observation === undefined
              ? '等待工作任务'
              : `轨迹 ${observation.count} · ${nodeLabel(observation.node)}${observation.phase === 'enter' ? '进入' : '完成'}`)}
        </span>
      </button>
      {expanded && workflow !== null && workflow !== undefined ? (
        <div className="space-y-2 text-xs">
          <div><span className="font-medium">目标：</span>{workflow.objective}</div>
          <div className="flex items-center gap-2 text-muted-foreground"><span>阶段进度：{completedStages}/{stages.length}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${stages.length === 0 ? 0 : Math.round((completedStages / stages.length) * 100)}%` }} /></span></div>
          <div className="flex flex-wrap gap-1">{stages.map((stage) => <span key={stage.id} title={`${stage.name} · ${stageStatusLabel(stage.status)}`} className={`rounded border px-1.5 py-0.5 ${stage.id === workflow.currentStageId ? 'border-primary bg-primary/10 text-primary' : stage.status === 'completed' ? 'border-emerald-500/30 text-emerald-600' : 'border-border text-muted-foreground'}`}>{stage.name} · {actorLabel(stage.actor)} · {stageStatusLabel(stage.status)}{stage.impactStatus ? ` · 影响：${stage.impactStatus}` : ''}</span>)}</div>
          {current !== undefined && <div className="rounded border border-border bg-muted/20 p-2 text-muted-foreground"><div><span className="font-medium text-foreground">当前阶段：</span>{current.name} · {stageStatusLabel(current.status)}</div><div className="mt-1"><span className="font-medium text-foreground">下一步：</span>{current.nextStep ?? '等待阶段推进'}</div>{current.blocking && <div className="mt-1 text-destructive"><span className="font-medium">阻塞原因：</span>{current.blocking}</div>}{current.allowedActions.length > 0 && <div className="mt-1"><span className="font-medium text-foreground">允许操作：</span>{current.allowedActions.join('、')}</div>}</div>}
          {assetError !== undefined && <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive">资产操作失败：{assetError}</div>}
          {assetCandidates.map((candidate) => (
            <div key={candidate.candidateId} className="rounded border border-amber-500/40 bg-amber-500/5 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">待确认资产变更 · {candidate.assetId || '未确定目标'}</span>
                <span className={`text-[10px] ${candidate.assetId ? 'text-emerald-600' : 'text-destructive'}`}>{candidate.assetId ? '目标已锁定' : '需要目标消歧'}</span>
              </div>
              {!candidate.assetId && <div className="mt-1 rounded bg-destructive/10 px-2 py-1 text-destructive">Main 尚未提供明确资产目标，确认入口已禁用；请重新生成带目标资产的候选。</div>}
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5">基于版本 v{candidate.baseVersion ?? '?'}</span>
                {candidate.changeSetId !== undefined && <span className="rounded bg-muted px-1.5 py-0.5">change set: {candidate.changeSetId}</span>}
                {candidate.workflowRef?.stageId !== undefined && <span className="rounded bg-muted px-1.5 py-0.5">来源阶段: {candidate.workflowRef.stageId}</span>}
              </div>
              {candidate.assetId && currentAssets[candidate.assetId] !== undefined && <div className="mt-2 rounded border border-border bg-background/60 p-2"><div className="mb-1 text-muted-foreground">与当前资产字段对照</div>{assetContentRows(candidate.content).map(([key, proposed]) => { const current = currentAssets[candidate.assetId]?.[key]; const currentText = current === undefined ? '未设置' : typeof current === 'string' ? current : JSON.stringify(current); return <div key={`compare:${key}`} className="grid grid-cols-[7rem_1fr] gap-2"><span className="text-muted-foreground">{key}</span><span><span className="text-muted-foreground line-through">{currentText}</span> → {proposed}</span></div>; })}</div>}
              <div className="mt-2 overflow-hidden rounded border border-border bg-background/60">
                {assetContentRows(candidate.content).map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[7rem_1fr] gap-2 border-b border-border px-2 py-1 last:border-b-0">
                    <span className="text-muted-foreground">{key}</span>
                    <span className="wrap-break-word">{value}</span>
                  </div>
                ))}
              </div>
              {candidate.provenance !== undefined && <details className="mt-1 text-[10px] text-muted-foreground"><summary className="cursor-pointer">查看来源证据</summary><pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap">{JSON.stringify(candidate.provenance, null, 2)}</pre></details>}
              <Button size="xs" disabled={!candidate.assetId || assetPendingIds.has(candidate.candidateId)} onClick={() => onConfirmAsset?.(candidate)}>{assetPendingIds.has(candidate.candidateId) ? '提交中…' : '确认变更'}</Button><Button size="xs" variant="outline" disabled={assetPendingIds.has(candidate.candidateId)} onClick={() => onRejectAsset?.(candidate)}>拒绝</Button>
            </div>
          ))}
          {assetImpacts.map((impact) => (
            <div key={impact.impactId} className={`rounded border p-2 ${impact.status === 'conflicting' ? 'border-destructive/50 bg-destructive/5' : 'border-orange-500/40 bg-orange-500/5'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">资产影响 · {impact.assetId}</span><span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{impact.status === 'conflicting' ? '版本冲突' : impact.status === 'needs-review' ? '需要复核' : impact.status}</span></div>
              <div className="mt-1 text-muted-foreground">{impact.summary ?? '该资产的下游内容可能需要重新确认。'}</div>
              {impact.targetRefs !== undefined && impact.targetRefs.length > 0 && <div className="mt-1 text-[10px] text-muted-foreground">影响目标：{impact.targetRefs.join('、')}</div>}
              <Button size="xs" disabled={assetPendingIds.has(impact.impactId)} onClick={() => onResolveImpact?.(impact, 'handle-now')}>{assetPendingIds.has(impact.impactId) ? '提交中…' : '立即处理'}</Button><Button size="xs" variant="outline" disabled={assetPendingIds.has(impact.impactId)} onClick={() => onResolveImpact?.(impact, 'todo')}>记入待办</Button><Button size="xs" variant="ghost" disabled={assetPendingIds.has(impact.impactId)} onClick={() => onResolveImpact?.(impact, 'continue')}>继续当前阶段</Button>
            </div>
          ))}
          <WorkbenchGraph trace={trace} objective={objective} targetLabel={targetLabel} />
        </div>
      ) : expanded ? <WorkbenchGraph trace={trace} objective={objective} targetLabel={targetLabel} /> : null}
    </section>
  );
}
