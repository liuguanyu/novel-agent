/**
 * 事实抽取控制面板 (fact-extraction-ui)
 *
 * 只展示后端 control-event 摘要并发送命令，不承载事实抽取/入库业务逻辑。
 */

import { Button } from '@/components/ui/button';
import type { ConsistencyIssueDto } from '../../shared/ipc/index.js';
import type { FactExtractionState } from '../hooks/useFactExtraction.js';

interface FactExtractionPanelProps {
  state: FactExtractionState;
  busy: boolean;
  onRetry: () => void;
  onAbort: () => void;
  onResolveConflict: (optionId: string) => void;
  onRejectConflict: () => void;
  onClear: () => void;
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
  onRetry,
  onAbort,
  onResolveConflict,
  onRejectConflict,
  onClear,
}: FactExtractionPanelProps): JSX.Element | null {
  if (state.status === 'idle') return null;

  const progress = state.total !== undefined && state.index !== undefined
    ? `${state.index}/${state.total}`
    : state.currentChapterId ?? '—';

  return (
    <section className="border-b border-border bg-muted/30 px-4 py-2 text-xs" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">事实抽取</span>
        <span className="rounded bg-background px-2 py-0.5 text-muted-foreground">{statusText(state.status)}</span>
        <span className="text-muted-foreground">章节/进度：{progress}</span>
        <span className="text-muted-foreground">
          候选 {state.validCandidates}/{state.candidateObjects} · 入库 {state.autoIngested} · 冲突 {state.conflicts}
        </span>
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

      {(state.status === 'running' || state.status === 'completed') && (
        <div className="mt-1 text-muted-foreground">
          字数：{state.textChars ?? '—'} · 分块：{state.chunks ?? '—'} · 无效：{state.invalidCandidates} · 跳过：{state.skipped}
        </div>
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
