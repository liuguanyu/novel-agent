/**
 * 事实抽取控制面板 (fact-extraction-ui)
 *
 * 只展示后端 control-event 摘要并发送命令，不承载事实抽取/入库业务逻辑。
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ConsistencyIssueDto } from '../../shared/ipc/index.js';
import type { FactExtractionState } from '../hooks/useFactExtraction.js';
import type { ModelTaskAttemptView } from '../hooks/useModelTaskSessions.js';

interface FactExtractionPanelProps {
  state: FactExtractionState;
  busy: boolean;
  currentChapterLabel?: string;
  onRetry: () => void;
  onAbort: () => void;
  onResolveConflict: (optionId: string) => void;
  onRejectConflict: () => void;
  onClear: () => void;
  taskAttempt?: ModelTaskAttemptView;
  onRetryTask?: (attempt: ModelTaskAttemptView) => void;
  onAbortTask?: (attempt: ModelTaskAttemptView) => void;
  onSupplementTask?: (attempt: ModelTaskAttemptView, text: string, scope: 'current-chapter' | 'remaining-chapters' | 'workflow-goal') => void;
}

function statusText(status: FactExtractionState['status']): string {
  switch (status) {
    case 'idle':
      return '空闲';
    case 'running':
      return '抽取中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'interrupted':
      return '等待裁决';
    case 'aborted':
      return '已中断';
  }
}

function IssueCard({ issue, onResolveConflict }: {
  issue: ConsistencyIssueDto;
  onResolveConflict: (optionId: string) => void;
}): JSX.Element {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
      <div className="font-medium">{issue.severity} · {issue.type}</div>
      <div className="mt-1 whitespace-pre-wrap">{issue.description}</div>
      {issue.evidence !== undefined && (
        <blockquote className="mt-1 border-l-2 border-amber-300 pl-2 text-amber-900">
          {issue.evidence.quote}
        </blockquote>
      )}
      {issue.options !== undefined && issue.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {issue.options.map((option) => (
            <Button key={option.id} type="button" size="xs" variant="outline" onClick={() => onResolveConflict(option.id)}>
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FactExtractionPanel({
  state,
  busy,
  currentChapterLabel,
  onRetry,
  onAbort,
  onResolveConflict,
  onRejectConflict,
  onClear,
  taskAttempt,
  onRetryTask,
  onAbortTask,
  onSupplementTask,
}: FactExtractionPanelProps): JSX.Element | null {
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [supplementText, setSupplementText] = useState('');
  const [supplementScope, setSupplementScope] = useState<'current-chapter' | 'remaining-chapters' | 'workflow-goal'>('current-chapter');
  if (state.status === 'idle') return null;

  const progress = state.total !== undefined && state.index !== undefined
    ? `${state.index}/${state.total}`
    : undefined;
  const chapterLabel = currentChapterLabel ?? state.currentChapterId ?? '正在读取章节信息…';

  return (
    <section className="border-b border-border bg-muted/30 px-4 py-2 text-xs" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">事实抽取</span>
        <span className="rounded bg-background px-2 py-0.5 text-muted-foreground">{statusText(state.status)}</span>
        {progress !== undefined && <span className="text-muted-foreground">章节进度：{progress}</span>}
        <span className="min-w-0 max-w-full truncate font-medium text-foreground" title={chapterLabel}>{state.status === 'running' ? '正在处理' : '最后处理'}：{chapterLabel}</span>
        <span className="text-muted-foreground">
          已发现 {state.validCandidates} 条 · 需要裁决 {state.conflicts} 条
        </span>
        {taskAttempt !== undefined && (
          <Button type="button" size="xs" variant="outline" onClick={() => setActivitiesOpen(true)}>
            查看任务记录（{taskAttempt.activities.length}）
          </Button>
        )}
        <span className="flex-1" />
        {busy && (
          <Button type="button" size="xs" variant="destructive" onClick={onAbort}>
            中断抽取
          </Button>
        )}
        {state.status === 'failed' && (
          <Button type="button" size="xs" variant="outline" onClick={onRetry}>
            重试
          </Button>
        )}
        {!busy && (
          <Button type="button" size="xs" variant="ghost" onClick={onClear}>
            关闭
          </Button>
        )}
      </div>

      {taskAttempt !== undefined && taskAttempt.activities.length > 0 && (
        <details className="mt-2 rounded-md border border-border bg-background/60 px-2 py-1" open={activitiesOpen} onToggle={(event) => setActivitiesOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer text-muted-foreground">模型任务活动</summary>
          <ol className="mt-2 space-y-1 border-l border-border pl-3">
            {taskAttempt.activities.map((activity) => (
              <li key={activity.activityId}>
                <div className="font-medium text-foreground">{activity.message}</div>
                <div className="text-muted-foreground">{activity.phase} · {new Date(activity.createdAt).toLocaleTimeString()}</div>
              </li>
            ))}
          </ol>
          {taskAttempt.conflicts.length > 0 && (
            <div className="mt-2 space-y-1 rounded border border-amber-300 bg-amber-50 p-2 text-amber-950">
              <div className="font-medium">结构化冲突候选</div>
              {taskAttempt.conflicts.map((conflict) => (
                <div key={conflict.conflictId} className="border-t border-amber-200 pt-1">
                  <div>候选：{conflict.candidateSummary}</div>
                  <div>已有：{conflict.existingSummary}</div>
                  {conflict.evidenceQuote !== undefined && <blockquote className="border-l-2 border-amber-300 pl-2">“{conflict.evidenceQuote}”</blockquote>}
                </div>
              ))}
            </div>
          )}
          {taskAttempt.error !== undefined && <div className="mt-2 text-destructive">{taskAttempt.error}</div>}
          <div className="mt-3 space-y-2 border-t border-border pt-2">
            <div className="font-medium text-foreground">补充本次任务要求</div>
            <textarea
              className="min-h-16 w-full rounded border border-input bg-background px-2 py-1 text-xs"
              value={supplementText}
              onChange={(event) => setSupplementText(event.target.value)}
              placeholder="例如：重点检查顾长风在本章中的称谓变化"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select className="rounded border border-input bg-background px-2 py-1 text-xs" value={supplementScope} onChange={(event) => setSupplementScope(event.target.value as typeof supplementScope)}>
                <option value="current-chapter">仅当前章节</option>
                <option value="remaining-chapters">后续未处理章节</option>
                <option value="workflow-goal">加入书目整理目标（暂不可用）</option>
              </select>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={supplementText.trim().length === 0 || supplementScope === 'workflow-goal' || onSupplementTask === undefined}
                onClick={() => {
                  if (onSupplementTask !== undefined) onSupplementTask(taskAttempt, supplementText, supplementScope);
                  setSupplementText('');
                }}
              >
                重新核对
              </Button>
              {onAbortTask !== undefined && <Button type="button" size="xs" variant="ghost" onClick={() => onAbortTask(taskAttempt)}>中断任务</Button>}
              {onRetryTask !== undefined && <Button type="button" size="xs" variant="ghost" onClick={() => onRetryTask(taskAttempt)}>新尝试</Button>}
            </div>
          </div>
        </details>
      )}

      {state.error !== undefined && (
        <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
          {state.error}
        </div>
      )}

      {state.issues.length > 0 && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-amber-900">事实冲突需要作者裁决</span>
            <Button type="button" size="xs" variant="destructive" onClick={onRejectConflict}>
              终止本次抽取
            </Button>
          </div>
          {state.issues.map((issue, index) => (
            <IssueCard key={`${issue.type}-${index}`} issue={issue} onResolveConflict={onResolveConflict} />
          ))}
        </div>
      )}
    </section>
  );
}
