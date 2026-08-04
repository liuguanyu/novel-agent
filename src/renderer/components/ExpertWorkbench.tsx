/** 常驻专家工作台：只呈现本轮目标、目标专家与真实有序执行路径。 */

import { useState } from 'react';
import {
  activitySummary,
  actorLabel,
  buildWorkflowCollapsedSummary,
  buildWorkflowView,
  impactStatusLabel,
  nodeLabel,
  observationSummary,
  stageStatusLabel,
  workflowKindLabel,
} from '../lib/workbench-view-contracts.js';
import type { AssetImpactDto, CreativeAssetCandidateDto, WorkflowSnapshotDto } from '../../shared/ipc/index.js';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, CircleDot, Workflow } from 'lucide-react';
import type { WorkbenchActivities } from '../../core/shell/workbench-graph.js';
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

function assetContentRows(content: unknown): ReadonlyArray<readonly [string, string]> {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return [['拟议内容', JSON.stringify(content)]];
  return Object.entries(content as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)] as const);
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
  const workflowView = workflow === null || workflow === undefined ? undefined : buildWorkflowView(workflow);
  const stages = workflowView?.stages ?? [];
  const current = workflowView?.current;
  const completedStages = workflowView?.completedCount ?? 0;
  const workflowSummary = workflow === null || workflow === undefined
    ? undefined
    : buildWorkflowCollapsedSummary(workflow, current, assetCandidates.length + assetImpacts.length);
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
          专家工作台{workflow !== null && workflow !== undefined && ` · ${workflowKindLabel(workflow.kind)}`}
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {summary !== undefined && <CircleDot className="size-3 animate-pulse text-primary" aria-hidden />}
          {workflowSummary ?? summary ?? observationSummary(observation)}
        </span>
      </button>
      {expanded && workflow !== null && workflow !== undefined ? (
        <div className="space-y-2 text-xs">
          <div><span className="font-medium">目标：</span>{workflow.objective}</div>
          <div className="flex items-center gap-2 text-muted-foreground"><span>阶段进度：{completedStages}/{stages.length}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${stages.length === 0 ? 0 : Math.round((completedStages / stages.length) * 100)}%` }} /></span></div>
          <div className="flex flex-wrap gap-1">{stages.map((stage) => <span key={stage.id} title={`${stage.name} · ${stageStatusLabel(stage.status)}`} className={`rounded border px-1.5 py-0.5 ${stage.id === workflow.currentStageId ? 'border-primary bg-primary/10 text-primary' : stage.status === 'completed' ? 'border-emerald-500/30 text-emerald-600' : 'border-border text-muted-foreground'}`}>{stage.name} · {actorLabel(stage.actor)} · {stageStatusLabel(stage.status)}{impactStatusLabel(stage.impactStatus) !== undefined ? ` · 影响：${impactStatusLabel(stage.impactStatus)}` : ''}</span>)}</div>
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
