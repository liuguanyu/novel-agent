/** 底部工作脉搏：常驻展示最近 2-3 条高价值活动。 */

import { CircleAlert, FileText, Loader2 } from 'lucide-react';
import type { TaskActivityFeedItem } from '../lib/task-activity-feed.js';

interface StatusFooterProps {
  readonly items: ReadonlyArray<TaskActivityFeedItem>;
  readonly needsFactRuling: boolean;
  readonly onOpenActivities: () => void;
  readonly onOpenFactSheet: () => void;
}

function toneDot(item: TaskActivityFeedItem): string {
  if (item.tone === 'error') return 'bg-destructive';
  if (item.tone === 'waiting') return 'bg-amber-500';
  if (item.tone === 'done') return 'bg-emerald-500';
  if (item.tone === 'running') return 'bg-primary';
  return 'bg-muted-foreground/50';
}

function ioSummary(item: TaskActivityFeedItem): string {
  const parts = [
    item.input === undefined ? undefined : `输入：${item.input}`,
    item.output === undefined ? undefined : `输出：${item.output}`,
    item.feedback === undefined ? undefined : `反馈：${item.feedback}`,
  ].filter((part): part is string => part !== undefined);
  return parts.join(' ｜ ');
}

export function StatusFooter({
  items,
  needsFactRuling,
  onOpenActivities,
  onOpenFactSheet,
}: StatusFooterProps): JSX.Element {


  return (
    <footer className="grid h-28 shrink-0 grid-cols-[minmax(0,1fr)_auto] border-t border-border bg-card text-xs text-muted-foreground">
      <button
        type="button"
        onClick={onOpenActivities}
        className="min-w-0 border-r border-border px-4 py-2 text-left transition-colors hover:bg-accent/40"
        title="打开实时任务中心"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="font-semibold text-foreground/90">工作脉搏</span>
          <span className="text-[10px] opacity-60">最近 {items.length} 条 · 点击查看任务中心</span>
        </div>
        <div className="h-16 space-y-1.5 overflow-hidden pr-2" aria-live="polite" aria-atomic="false">
          {items.map((item) => (
            <div key={item.id} className="min-w-0 leading-4">
              <div className="flex min-w-0 items-center gap-2">
                {item.tone === 'running' ? (
                  <Loader2 className="size-3 shrink-0 animate-spin text-primary" aria-hidden />
                ) : (
                  <span className={`size-1.5 shrink-0 rounded-full ${toneDot(item)}`} aria-hidden />
                )}
                <span className="shrink-0 font-medium text-foreground/80">{item.label}</span>
                <span className="truncate text-foreground/90">{item.message}</span>
              </div>
              {ioSummary(item).length > 0 && (
                <div className="ml-5 truncate text-[10px] text-muted-foreground/80">{ioSummary(item)}</div>
              )}
            </div>
          ))}
        </div>
      </button>

      <div className="flex w-56 flex-col justify-between px-3 py-2">
        {needsFactRuling ? (
          <button
            type="button"
            onClick={onOpenFactSheet}
            className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
          >
            <CircleAlert className="size-3.5" aria-hidden />
            有事实冲突等你裁决
          </button>
        ) : (
          <span className="px-2 py-1 text-[10px] opacity-60">实时日志会持续记录在左侧</span>
        )}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onOpenFactSheet}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground"
            title="查看事实核对任务与全书事实库"
          >
            <FileText className="size-3.5" aria-hidden />
            事实底稿
          </button>
          <span className="select-none whitespace-nowrap opacity-70">⌘K 召唤专家</span>
        </div>
      </div>
    </footer>
  );
}
