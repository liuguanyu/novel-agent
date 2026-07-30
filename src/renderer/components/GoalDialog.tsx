/**
 * 「设定目标」弹层 (workflow-guided-workbench task 10.2)
 *
 * 从产品栏按需打开：编辑本次整理的 objective 与可重复的作者要求清单
 * （preserve/extract/remove，同类可多条、可增删改、可保存为空清单）。
 * 保存走 `workflow-update-goal` 命令：乐观版本 + operationId 幂等，阶段不变；
 * 版本冲突时提示刷新重试；保存成功提示"下一次诊断按最新目标执行"。
 */

import { useEffect, useState } from 'react';
import { LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AuthorIntentDto, WorkflowSnapshotDto } from '../../shared/ipc/index.js';

interface GoalDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workflow: WorkflowSnapshotDto;
  readonly onSnapshot: (snapshot: WorkflowSnapshotDto) => void;
}

interface IntentDraft {
  readonly id: string;
  readonly kind: AuthorIntentDto['kind'];
  readonly text: string;
}

const INTENT_KIND_LABEL: Readonly<Record<AuthorIntentDto['kind'], string>> = {
  preserve: '保留',
  extract: '提取',
  remove: '去掉或修复',
};

function toDrafts(intents: ReadonlyArray<AuthorIntentDto>): ReadonlyArray<IntentDraft> {
  return intents.map((intent) => ({ id: crypto.randomUUID(), kind: intent.kind, text: intent.text }));
}

function toIntents(drafts: ReadonlyArray<IntentDraft>): ReadonlyArray<AuthorIntentDto> {
  return drafts.flatMap((draft) => {
    const text = draft.text.trim();
    return text.length === 0 ? [] : [{ kind: draft.kind, text }];
  });
}

export function GoalDialog({ open, onOpenChange, workflow, onSnapshot }: GoalDialogProps): JSX.Element {
  const supportsIntents = workflow.kind === 'legacy-book-revision';
  const [objective, setObjective] = useState(workflow.objective);
  const [drafts, setDrafts] = useState<ReadonlyArray<IntentDraft>>(() => toDrafts(workflow.authorIntents));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [savedNotice, setSavedNotice] = useState(false);

  // 每次打开时以最新快照重置草稿，避免陈旧编辑覆盖别处保存的内容。
  useEffect(() => {
    if (!open) return;
    setObjective(workflow.objective);
    setDrafts(toDrafts(workflow.authorIntents));
    setFailure(undefined);
    setSavedNotice(false);
  }, [open]);

  const save = async (): Promise<void> => {
    const trimmedObjective = objective.trim();
    if (busy || trimmedObjective.length === 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const response = await window.novelAgent.sendWorkflowCommand({
        type: 'workflow-update-goal',
        workflowId: workflow.workflowId,
        expectedVersion: workflow.version,
        requestId: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        objective: trimmedObjective,
        ...(supportsIntents ? { authorIntents: toIntents(drafts) } : {}),
      });
      if (response.failure !== undefined) {
        setFailure(
          response.failure.error.message.includes('version conflict')
            ? '目标刚被其他操作更新过，请关闭弹层后重新打开再编辑。'
            : response.failure.error.message,
        );
        return;
      }
      if (response.snapshot !== null) onSnapshot(response.snapshot);
      setSavedNotice(true);
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>设定本次整理目标</DialogTitle>
          <DialogDescription>
            说清楚这次要保留什么、重建什么。历史诊断不会被改写，下一次诊断会按最新目标执行。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/80">整理目标</span>
            <textarea
              className="h-20 w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={objective}
              onChange={(event) => {
                setObjective(event.target.value);
                setSavedNotice(false);
              }}
              placeholder="例如：保留《津门余味》的市井烟火气，重建主线因果与人物动机"
            />
          </label>

          {supportsIntents && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground/80">具体要求（可多条）</span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setDrafts((previous) => [...previous, { id: crypto.randomUUID(), kind: 'preserve', text: '' }]);
                    setSavedNotice(false);
                  }}
                >
                  <Plus className="size-3" />
                  添加一条
                </Button>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {drafts.length === 0 && (
                  <p className="rounded border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
                    当前没有具体要求。可以添加新要求，或直接保存为空。
                  </p>
                )}
                {drafts.map((draft) => (
                  <div key={draft.id} className="flex items-center gap-2">
                    <select
                      className="w-28 shrink-0 rounded border border-border bg-background px-2 py-1.5 text-xs"
                      value={draft.kind}
                      aria-label="要求处理方式"
                      onChange={(event) => {
                        setDrafts((previous) =>
                          previous.map((item) =>
                            item.id === draft.id ? { ...item, kind: event.target.value as AuthorIntentDto['kind'] } : item,
                          ),
                        );
                        setSavedNotice(false);
                      }}
                    >
                      {Object.entries(INTENT_KIND_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs"
                      value={draft.text}
                      placeholder="写明具体人物、情节、章节、线索或问题"
                      onChange={(event) => {
                        setDrafts((previous) =>
                          previous.map((item) => (item.id === draft.id ? { ...item, text: event.target.value } : item)),
                        );
                        setSavedNotice(false);
                      }}
                    />
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="删除这条要求"
                      onClick={() => {
                        setDrafts((previous) => previous.filter((item) => item.id !== draft.id));
                        setSavedNotice(false);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {failure !== undefined && <p className="text-xs text-destructive">{failure}</p>}
          {savedNotice && (
            <p className="text-xs text-amber-600">
              目标已更新。建议重新运行全书诊断，下一次诊断会按最新目标执行。
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button disabled={busy || objective.trim().length === 0} onClick={() => void save()}>
            {busy && <LoaderCircle className="size-3.5 animate-spin" />}
            保存目标
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
