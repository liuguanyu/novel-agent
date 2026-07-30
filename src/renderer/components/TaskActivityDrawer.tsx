import { Bot, CheckCircle2, CircleAlert, FileSearch, Loader2, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { TaskActivityFeedItem, TaskActivitySource } from '../lib/task-activity-feed.js';

interface TaskActivityDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly items: ReadonlyArray<TaskActivityFeedItem>;
  readonly onOpenFactSheet: () => void;
  readonly onOpenDashboard: () => void;
  readonly onOpenConversation: () => void;
}

const SOURCE_LABEL: Readonly<Record<TaskActivitySource, string>> = {
  workflow: '工作流程',
  fact: '事实底稿',
  audit: '诊断结果',
  expert: '专家对话',
};

function ActivityIcon({ item }: { readonly item: TaskActivityFeedItem }): JSX.Element {
  if (item.tone === 'running') return <Loader2 className="size-4 animate-spin text-primary" aria-hidden />;
  if (item.tone === 'error' || item.tone === 'waiting') return <CircleAlert className="size-4 text-amber-500" aria-hidden />;
  if (item.tone === 'done') return <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />;
  if (item.source === 'expert') return <Bot className="size-4 text-muted-foreground" aria-hidden />;
  if (item.source === 'audit') return <FileSearch className="size-4 text-muted-foreground" aria-hidden />;
  return <Workflow className="size-4 text-muted-foreground" aria-hidden />;
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string | undefined }): JSX.Element | null {
  if (value === undefined || value.length === 0) return null;
  return (
    <div className="grid grid-cols-[3rem_1fr] gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap text-foreground/85">{value}</span>
    </div>
  );
}

export function TaskActivityDrawer({
  open,
  onOpenChange,
  items,
  onOpenFactSheet,
  onOpenDashboard,
  onOpenConversation,
}: TaskActivityDrawerProps): JSX.Element {
  const openSource = (source: TaskActivitySource): void => {
    if (source === 'fact') onOpenFactSheet();
    if (source === 'audit') onOpenDashboard();
    if (source === 'expert') onOpenConversation();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[72vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>实时任务</SheetTitle>
          <SheetDescription>按“输入 → 处理 → 输出 → 反馈”追踪工作流程、模型任务、全书诊断和专家协作。</SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-4">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-3 rounded-md border border-border bg-card/50 p-3">
              <ActivityIcon item={item} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{item.label}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{SOURCE_LABEL[item.source]}</span>
                </div>
                <div className="mt-0.5 text-sm text-foreground/90">{item.message}</div>
                <div className="mt-2 space-y-1 rounded border border-border/60 bg-background/50 p-2">
                  <DetailRow label="输入" value={item.input} />
                  <DetailRow label="输出" value={item.output} />
                  <DetailRow label="反馈" value={item.feedback} />
                  {item.details !== undefined && item.details.length > 0 && (
                    <div className="grid grid-cols-[3rem_1fr] gap-2 text-xs">
                      <span className="text-muted-foreground">细节</span>
                      <ul className="space-y-0.5 text-foreground/80">
                        {item.details.map((detail) => <li key={detail}>· {detail}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              {item.source !== 'workflow' && (
                <Button size="xs" variant="outline" onClick={() => openSource(item.source)}>
                  打开{SOURCE_LABEL[item.source]}
                </Button>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
