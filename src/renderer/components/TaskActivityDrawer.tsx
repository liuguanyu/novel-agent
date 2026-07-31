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
  task: '任务运行',
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

const ADOPTION_LABEL: Readonly<Record<'adopted' | 'rejected' | 'pending', { readonly text: string; readonly cls: string }>> = {
  adopted: { text: '已采用', cls: 'bg-emerald-500/10 text-emerald-600' },
  rejected: { text: '已拒绝', cls: 'bg-destructive/10 text-destructive' },
  pending: { text: '待作者确认', cls: 'bg-amber-500/10 text-amber-600' },
};

/** 模型交互可审计块（3.5）：展示目标/输入/上下文/约束/输出/结构化结果/验证与采用状态，不展示隐藏推理。 */
function ModelAuditBlock({ audit }: { readonly audit: NonNullable<TaskActivityFeedItem['modelAudit']> }): JSX.Element {
  const adoption = ADOPTION_LABEL[audit.adoption];
  return (
    <div className="mt-1 space-y-1 rounded border border-primary/20 bg-primary/5 p-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium text-primary">模型交互（可审计）</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{audit.agent} · {audit.tier}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${adoption.cls}`}>{adoption.text}</span>
      </div>
      <DetailRow label="目标" value={audit.goal} />
      <DetailRow label="输入" value={audit.inputSummary} />
      <DetailRow label="上下文" value={audit.contextRefs?.join('、')} />
      <DetailRow label="约束" value={audit.constraints?.join('；')} />
      <DetailRow label="输出" value={audit.outputSummary} />
      <DetailRow label="结果" value={audit.structuredResult?.join('；')} />
      <DetailRow label="工具" value={audit.toolResults?.join('；')} />
      <DetailRow label="验证" value={audit.validation} />
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
          <SheetTitle>任务中心</SheetTitle>
          <SheetDescription>查看当前任务、等待作者的事项，以及按“输入 → 执行 → 输出 → 反馈”记录的完整活动历史。</SheetDescription>
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
                  {item.modelAudit !== undefined && <ModelAuditBlock audit={item.modelAudit} />}
                </div>
              </div>
              {item.source !== 'workflow' && item.source !== 'task' && (
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
