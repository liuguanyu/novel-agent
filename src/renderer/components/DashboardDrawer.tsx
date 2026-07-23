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
import type { ConsistencyIssueDto } from '../../shared/ipc/index.js';

interface DashboardDrawerProps {
  readonly onSelectChapter?: (nodeId: string) => void;
  /** 受控开合（工具条驱动）；不传则内部自管并显示自带触发钮。 */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** 上提的仪表盘 hook（工具条动作排「全书总检」共用）；不传则内部自建。 */
  readonly dashboard?: UseDashboardResult;
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

function issueGroups(issues: ReadonlyArray<ConsistencyIssueDto>): ReadonlyArray<IssueGroup> {
  const groups: ReadonlyArray<IssueGroup> = [
    { severity: 'critical', issues: issues.filter((issue) => issue.severity === 'critical') },
    { severity: 'warning', issues: issues.filter((issue) => issue.severity === 'warning') },
    { severity: 'info', issues: issues.filter((issue) => issue.severity === 'info') },
  ];
  return groups.filter((group) => group.issues.length > 0);
}

function IssueCard({
  issue,
  onSelectChapter,
}: {
  readonly issue: ConsistencyIssueDto;
  readonly onSelectChapter?: (nodeId: string) => void;
}): JSX.Element {
  const chapterAnchor = issue.anchors.find((anchor) => anchor.kind === 'chapter');
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{severityLabel(issue.severity)} · {issue.type}</span>
        {chapterAnchor !== undefined && onSelectChapter !== undefined && (
          <Button variant="outline" size="sm" onClick={() => onSelectChapter(chapterAnchor.id)}>
            跳章
          </Button>
        )}
      </div>
      <p className="text-foreground">{issue.description}</p>
      {issue.suggestedFix !== undefined && (
        <p className="mt-1 text-muted-foreground">建议：{issue.suggestedFix}</p>
      )}
      {issue.evidence !== undefined && (
        <blockquote className="mt-2 border-l border-border pl-2 text-xs text-muted-foreground">
          {issue.evidence.quote}
        </blockquote>
      )}
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
}: DashboardDrawerProps): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false);
  const internalDashboard = useDashboard();
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const dashboard = dashboardProp ?? internalDashboard;
  const groups = useMemo(
    () => issueGroups(dashboard.state.dashboard?.issues ?? []),
    [dashboard.state.dashboard?.issues],
  );
  const explanation = dashboard.state.dashboard?.scoreExplanation;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!controlled && (
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            质量仪表盘
          </Button>
        </SheetTrigger>
      )}
      <SheetContent side="bottom" className="h-[32rem]">
        <SheetHeader>
          <SheetTitle>质量仪表盘</SheetTitle>
          <SheetDescription>
            基于 Story Bible 结构化骨架运行全书总检，输出健康分与红黄牌问题。
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 py-2">
          <Button size="sm" onClick={dashboard.runGlobalAudit} disabled={dashboard.busy}>
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
                <div className="mt-3 text-xs text-muted-foreground">
                  <div>公式：{explanation.formula}</div>
                  <div>
                    红牌 {explanation.criticalCount} / 黄牌 {explanation.warningCount} / 提示 {explanation.infoCount}
                  </div>
                  <div>扣分：{explanation.penalty}</div>
                </div>
              )}
            </div>

            <ScrollArea className="h-[20rem] rounded-md border border-border p-3">
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
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
