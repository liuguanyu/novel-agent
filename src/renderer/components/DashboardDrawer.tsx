/**
 * 底部质量仪表盘抽屉：触发全书总检并展示健康分、红黄牌与锚点跳章。
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDashboard, type UseDashboardResult } from '../hooks/useDashboard.js';
import type { ConsistencyIssueDto, LegacyRevisionDiagnosisItemDto, WorkflowRefDto, WorkflowSnapshotDto } from '../../shared/ipc/index.js';
import { presentIssueLifecycle, resolveIssueChapterTarget, type IssueLifecycleStatus } from '../lib/workflow-ui-contracts.js';

interface DashboardDrawerProps {
  readonly onSelectChapter?: (nodeId: string) => void;
  /** 受控开合（工具条驱动）；不传则内部自管并显示自带触发钮。 */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** 上提的仪表盘 hook（工具条动作排「全书总检」共用）；不传则内部自建。 */
  readonly dashboard?: UseDashboardResult;
  readonly workflowRef?: WorkflowRefDto;
  readonly workflow?: WorkflowSnapshotDto | null;
}

function severityLabel(severity: ConsistencyIssueDto['severity']): string {
  switch (severity) {
    case 'critical':
      return '红牌';
    case 'warning':
      return '黄牌';
    case 'info':
      return '提示';
  }
}



function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'map':
      return '抽取骨架';
    case 'reduce':
      return '跨片对撞';
    case 'score':
      return '计算评分';
    default:
      return '准备中';
  }
}

interface IssueGroup {
  readonly severity: ConsistencyIssueDto['severity'];
  readonly issues: ReadonlyArray<ConsistencyIssueDto>;
}

type WorkflowStatusFilter = 'all' | IssueLifecycleStatus;

const WORKFLOW_STATUS_LABEL: Record<IssueLifecycleStatus, string> = {
  open: presentIssueLifecycle('open').label,
  fixing: presentIssueLifecycle('fixing').label,
  verifying: presentIssueLifecycle('verifying').label,
  resolved: presentIssueLifecycle('resolved').label,
  dismissed: presentIssueLifecycle('dismissed').label,
};

function issueGroups(issues: ReadonlyArray<ConsistencyIssueDto>): ReadonlyArray<IssueGroup> {
  const groups: ReadonlyArray<IssueGroup> = [
    { severity: 'critical', issues: issues.filter((issue) => issue.severity === 'critical') },
    { severity: 'warning', issues: issues.filter((issue) => issue.severity === 'warning') },
    { severity: 'info', issues: issues.filter((issue) => issue.severity === 'info') },
  ];
  return groups.filter((group) => group.issues.length > 0);
}

function DiagnosisSection({ title, items }: { readonly title: string; readonly items: ReadonlyArray<LegacyRevisionDiagnosisItemDto> }): JSX.Element {
  return <section><h3 className="mb-2 text-sm font-semibold">{title}（{items.length}）</h3>{items.length === 0 ? <p className="text-xs text-muted-foreground">作者尚未提出此类要求。</p> : <div className="space-y-2">{items.map((item, index) => <div key={`${item.intent.kind}:${item.intent.text}:${index}`} className="rounded-md border border-border p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{item.intent.text}</span><span className={`rounded px-1.5 py-0.5 text-[10px] ${item.status === 'pending' ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>{item.status === 'located' ? '已定位' : item.status === 'evidence-found' ? '已找到证据' : '待深化'}</span></div>{item.matches.length > 0 && <div className="mt-2 space-y-1 text-xs text-muted-foreground">{item.matches.map((match) => <div key={`${match.label}:${match.anchorRefs.join(',')}`}><span className="font-medium text-foreground/80">{match.label}</span>{match.details !== undefined && <span> · {match.details.join('；')}</span>}{match.anchorRefs.length > 0 && <div>锚点：{match.anchorRefs.join('、')}</div>}</div>)}</div>}{item.linkedIssueIds.length > 0 && <div className="mt-1 text-xs text-primary">关联问题：{item.linkedIssueIds.join('、')}</div>}</div>)}</div>}</section>;
}

function IssueCard({
  issue,
  onSelectChapter,
  onRunVerification,
}: {
  readonly issue: ConsistencyIssueDto;
  readonly onSelectChapter?: (nodeId: string) => void;
  readonly onRunVerification?: (issue: ConsistencyIssueDto) => void;
}): JSX.Element {
  const chapterTarget = resolveIssueChapterTarget(issue);
  const lifecycle = issue.workflowStatus === undefined
    ? undefined
    : presentIssueLifecycle(issue.workflowStatus, issue.resolutionReason);
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1 font-medium">
          {severityLabel(issue.severity)} · {issue.type}
          {issue.workflowStatus !== undefined && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              {WORKFLOW_STATUS_LABEL[issue.workflowStatus]}
            </span>
          )}
        </span>
        {chapterTarget.enabled && onSelectChapter !== undefined ? (
          <Button variant="outline" size="sm" onClick={() => onSelectChapter(chapterTarget.targetChapterId)}>
            跳章
          </Button>
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">无章节锚点，禁止写入</span>
        )}
      </div>
      <p className="text-foreground">{issue.description}</p>
      <p className="mt-1 text-xs text-primary">{lifecycle?.nextAction ?? '下一步：等待 Main 建立工作流问题记录'}</p>
      {issue.suggestedFix !== undefined && (
        <p className="mt-1 text-muted-foreground">建议：{issue.suggestedFix}</p>
      )}
      {issue.evidence !== undefined && (
        <blockquote className="mt-2 border-l border-border pl-2 text-xs text-muted-foreground">
          {issue.evidence.quote}
        </blockquote>
      )}
      {(issue.checkpointIds?.length ?? 0) > 0 && <p className="mt-2 text-xs text-muted-foreground">Checkpoint：{issue.checkpointIds?.join('、')}</p>}
      {(issue.checkpointIds?.length ?? 0) > 0 && issue.workflowStatus === 'verifying' && <p className="text-xs text-amber-600">正文已落盘，当前等待针对性复检。</p>}
      {(issue.verificationRunIds?.length ?? 0) > 0 && <p className="text-xs text-muted-foreground">复检运行：{issue.verificationRunIds?.join('、')}</p>}
      {issue.resolutionReason !== undefined && <p className="text-xs text-muted-foreground">处理理由：{issue.resolutionReason}</p>}
      {lifecycle?.outcome === 'verifying' && onRunVerification !== undefined && chapterTarget.enabled && (
        <Button className="mt-2" size="sm" onClick={() => onRunVerification(issue)}>运行复检</Button>
      )}
      {lifecycle?.outcome === 'verifying' && !chapterTarget.enabled && <p className="mt-2 text-xs text-destructive">缺少稳定章节锚点，不能启动正文复检或写入。</p>}
      <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground">
        {issue.anchors.map((anchor) => (
          <span key={`${anchor.kind}:${anchor.id}`} className="rounded bg-muted px-1.5 py-0.5">
            {anchor.kind}:{anchor.id}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DashboardDrawer({
  onSelectChapter,
  open: openProp,
  onOpenChange,
  dashboard: dashboardProp,
  workflowRef,
  workflow,
}: DashboardDrawerProps): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatusFilter>('all');
  const internalDashboard = useDashboard();
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const dashboard = dashboardProp ?? internalDashboard;
  const groups = useMemo(() => {
    const issues = dashboard.state.dashboard?.issues ?? [];
    return issueGroups(workflowStatus === 'all' ? issues : issues.filter((issue) => issue.workflowStatus === workflowStatus));
  }, [dashboard.state.dashboard?.issues, workflowStatus]);
  const explanation = dashboard.state.dashboard?.scoreExplanation;
  const auditIssues = dashboard.state.dashboard?.issues ?? [];
  const diagnosis = dashboard.state.dashboard?.legacyDiagnosis;
  const lifecycleCounts = useMemo(() => auditIssues.reduce<Record<string, number>>((counts, issue) => {
    const status = issue.workflowStatus ?? 'untracked';
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {}), [auditIssues]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!controlled && (
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            质量仪表盘
          </Button>
        </SheetTrigger>
      )}
      <SheetContent side="bottom" className="h-128">
        <SheetHeader>
          <SheetTitle>质量仪表盘</SheetTitle>
          <SheetDescription>
            基于 Story Bible 结构化骨架运行全书总检，输出健康分与红黄牌问题。
          </SheetDescription>
        </SheetHeader>

        {workflow !== null && workflow !== undefined && (
          <div className="mx-4 mb-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">工作流：{workflow.kind}</span>
              <span className={workflow.status === 'completed' ? 'text-emerald-600' : workflow.status === 'failed' ? 'text-destructive' : 'text-primary'}>{workflow.status === 'completed' ? '已完成' : workflow.status === 'failed' ? '失败' : workflow.status === 'paused' ? '已暂停' : '进行中'}</span>
            </div>
            <div className="mt-1 text-muted-foreground">目标：{workflow.objective}</div>
            <div className="mt-1 text-muted-foreground">当前阶段：{workflow.currentStageId ?? '无'} · 版本：{workflow.version}</div>
            {workflow.currentStageId?.includes('final-audit') && workflow.status !== 'completed' && (
              <div className="mt-1 text-amber-600">正在执行最终复检；若发现新问题，将回到问题队列。</div>
            )}
            {workflow.currentStageId?.includes('issue-triage') && auditIssues.some((issue) => issue.workflowStatus === 'open') && (
              <div className="mt-1 text-amber-600">检测到待处理问题，工作流已回到问题队列；请先定位、修复并完成复检。</div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 px-4 py-2">
          <Button size="sm" onClick={() => dashboard.runGlobalAudit()} disabled={dashboard.busy}>
            运行全书总检
          </Button>
          {dashboard.busy && (
            <Button size="sm" variant="outline" onClick={dashboard.abort}>
              停止
            </Button>
          )}
          {dashboard.state.status !== 'idle' && !dashboard.busy && (
            <Button size="sm" variant="ghost" onClick={dashboard.clear}>
              清空
            </Button>
          )}
          <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            生命周期
            <select className="rounded border border-border bg-background px-1.5 py-1" value={workflowStatus} onChange={(event) => setWorkflowStatus(event.target.value as WorkflowStatusFilter)}>
              <option value="all">全部</option>
              {Object.entries(WORKFLOW_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <span className="text-xs text-muted-foreground">
            {dashboard.state.status === 'running'
              ? `${phaseLabel(dashboard.state.phase)} · ${dashboard.state.completedItems}/${dashboard.state.totalItems}`
              : `状态：${dashboard.state.status}`}
          </span>
        </div>

        {dashboard.state.error !== undefined && (
          <div className="mx-4 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {dashboard.state.error}
          </div>
        )}

        {dashboard.state.stale && dashboard.state.dashboard !== undefined && !dashboard.busy && (
          <div className="mx-4 mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600">
            事实已变化，体检结果可能过期，建议重新运行全书总检。
          </div>
        )}

        {dashboard.state.dashboard === undefined ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            暂无体检数据。请先完成事实抽取/补库，再运行全书总检。
          </div>
        ) : (
          <div className="grid min-h-0 grid-cols-[220px_1fr] gap-4 px-4 pb-4">
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="text-xs text-muted-foreground">故事健康度</div>
              <div className="mt-1 text-4xl font-semibold">{dashboard.state.dashboard.healthScore}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                Fact Version: {dashboard.state.dashboard.factVersion}
              </div>
              <div className="text-xs text-muted-foreground">
                总检骨架项：{dashboard.state.dashboard.totalItems}
              </div>
              {explanation !== undefined && (
                <div className="text-xs text-muted-foreground">
                  <div>公式：{explanation.formula}</div>
                  <div>
                    红牌 {explanation.criticalCount} / 黄牌 {explanation.warningCount} / 提示 {explanation.infoCount}
                  </div>
                  <div>扣分：{explanation.penalty}</div>
                  <div className="mt-2 border-t border-border pt-2">生命周期：{Object.entries(lifecycleCounts).map(([status, count]) => `${WORKFLOW_STATUS_LABEL[status as Exclude<WorkflowStatusFilter, 'all'>] ?? '未关联'} ${count}`).join(' · ') || '暂无问题'}</div>
                  <div>生成时间：{new Date(dashboard.state.dashboard.generatedAt).toLocaleString()}</div>
                  {dashboard.state.runId !== undefined && <div>审计运行：{dashboard.state.runId}</div>}
                </div>
              )}
            </div>

            <ScrollArea className="h-80 rounded-md border border-border p-3">
              <div className="space-y-5">
                {diagnosis !== undefined && <>
                  <DiagnosisSection title="作者要求保留" items={diagnosis.preservation} />
                  <DiagnosisSection title="人物特征提取" items={diagnosis.characterExtraction} />
                  <DiagnosisSection title="去掉或修复" items={diagnosis.removals} />
                  <div className="border-t border-border" />
                </>}
                {groups.length === 0 ? (
                  <div className="text-sm text-muted-foreground">未发现全局一致性问题。</div>
                ) : (
                  <div className="space-y-4">
                    {groups.map((group) => (
                    <section key={group.severity}>
                      <h3 className="mb-2 text-sm font-semibold">
                        {severityLabel(group.severity)}（{group.issues.length}）
                      </h3>
                      <div className="space-y-2">
                        {group.issues.map((issue, index) => (
                          <IssueCard
                            key={`${issue.type}:${issue.severity}:${index}`}
                            issue={issue}
                            {...(onSelectChapter !== undefined ? { onSelectChapter } : {})}
                            {...(workflowRef !== undefined ? { onRunVerification: (target: ConsistencyIssueDto) => dashboard.runTargetedVerification(target, workflowRef) } : {})}
                          />
                        ))}
                      </div>
                    </section>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
