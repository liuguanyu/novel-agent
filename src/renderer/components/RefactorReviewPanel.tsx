/**
 * 局部重构改写审阅面板 (refactor-review-ui)
 *
 * 作者输入/确认「原片段 + 改写片段」→ 计算 diff（后端）→ diff 双栏视图 + 逐 hunk accept/reject 控件
 * → 提交裁决（只上报意图，后端拼回落盘）→ 展示落盘结果/失败。
 *
 * 锚点策略：后端 anchor.from/to 为章节 Markdown 文本（与本面板收到的 content 同源）的字符偏移，
 * 故由「原片段」在 content 中定位得 FragmentAnchorDto，无需 ProseMirror↔Markdown 偏移映射。
 * Renderer 只上报意图：不计算 diff、不写正文。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { DiffHunkDto, FragmentAnchorDto } from '../../shared/ipc/index.js';
import type { RefactorState, UseRefactorResult } from '../hooks/useRefactor.js';
import { resolveIssueChapterTarget } from '../lib/workflow-ui-contracts.js';

interface RefactorReviewPanelProps {
  readonly selectedNodeId: string | undefined;
  /** 当前 content 实际所属章节；必须与问题锚点一致才允许计算 diff。 */
  readonly contentNodeId: string | undefined;
  /** 当前章节正文（与后端锚点同源，用于定位原片段偏移）。 */
  readonly content: string;
  readonly loadingContent: boolean;
  readonly refactor: UseRefactorResult;
  /** 受控开合（工具条驱动）；不传则内部自管并显示自带触发钮。 */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** 由审校发现「采纳并修改」程序化预填；携带事实来源章节，避免文本与当前锚点脱节。 */
  readonly prefill?: {
    readonly nodeId: string;
    readonly original: string;
    readonly suggestion: string;
    readonly rewritten: '';
  } | undefined;
  /** 老书改写将实际带入的整理结果摘要。 */
  readonly legacyContextSummary?: {
    readonly preservedPlots: ReadonlyArray<{
      readonly title: string;
      readonly summary: string;
      readonly authorNote?: string;
    }>;
    readonly preservedQuotes: ReadonlyArray<{
      readonly text: string;
      readonly sourceChapterTitle: string;
      readonly authorNote?: string;
    }>;
    readonly crossChapterIssues: ReadonlyArray<{
      readonly description: string;
      readonly status: 'open' | 'confirmed' | 'resolved' | 'dismissed';
      readonly authorNote?: string;
    }>;
  };
}

function statusText(status: RefactorState['status']): string {
  switch (status) {
    case 'idle':
      return '空闲';
    case 'computing':
      return '计算差异中';
    case 'reviewing':
      return '逐段审阅';
    case 'applying':
      return '拼回落盘中';
    case 'applied':
      return '已落盘';
    case 'failed':
      return '失败';
  }
}

/** 在章节正文中定位原片段，得出片段锚点；失败返回原因文本。 */
function locateAnchor(
  content: string,
  nodeId: string,
  originalFragment: string,
): { anchor: FragmentAnchorDto } | { error: string } {
  if (originalFragment.length === 0) return { error: '原片段为空。' };
  const from = content.indexOf(originalFragment);
  if (from < 0) return { error: '在当前章节正文中未找到原片段（请确认逐字一致）。' };
  const dup = content.indexOf(originalFragment, from + 1);
  if (dup >= 0) return { error: '原片段在正文中出现多次，无法唯一定位（请扩大选取范围）。' };
  return { anchor: { nodeId, from, to: from + originalFragment.length } };
}

function HunkRow({
  hunk,
  decision,
  onDecision,
}: {
  readonly hunk: DiffHunkDto;
  readonly decision: 'accept' | 'reject';
  readonly onDecision: (hunkId: string, decision: 'accept' | 'reject') => void;
}): JSX.Element {
  const accepted = decision === 'accept';
  return (
    <div className={`rounded-md border p-2 text-xs ${accepted ? 'border-border' : 'border-dashed border-muted-foreground/40 opacity-60'}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-muted-foreground">片段 [{hunk.fragmentFrom}, {hunk.fragmentTo})</span>
        <div className="flex gap-1">
          <Button
            type="button"
            size="xs"
            variant={accepted ? 'default' : 'outline'}
            onClick={() => onDecision(hunk.id, 'accept')}
          >
            接受
          </Button>
          <Button
            type="button"
            size="xs"
            variant={!accepted ? 'destructive' : 'outline'}
            onClick={() => onDecision(hunk.id, 'reject')}
          >
            拒绝
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded bg-red-50 p-1.5 text-red-900">
          <div className="mb-0.5 text-[10px] uppercase text-red-500">原文</div>
          <span className="whitespace-pre-wrap break-words">{hunk.original.length > 0 ? hunk.original : '（无）'}</span>
        </div>
        <div className="rounded bg-green-50 p-1.5 text-green-900">
          <div className="mb-0.5 text-[10px] uppercase text-green-600">改写</div>
          <span className="whitespace-pre-wrap break-words">{hunk.rewritten.length > 0 ? hunk.rewritten : '（无）'}</span>
        </div>
      </div>
    </div>
  );
}

export function RefactorReviewPanel({
  selectedNodeId,
  contentNodeId,
  content,
  loadingContent,
  refactor,
  open: openProp,
  onOpenChange,
  prefill,
  legacyContextSummary,
}: RefactorReviewPanelProps): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [original, setOriginal] = useState('');
  const [rewritten, setRewritten] = useState('');
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const { state, busy, computeDiff, setDecision, apply, clear } = refactor;

  // 收到新预填（引用变化）时将其写入原片段 / 改写片段输入态，供作者编辑后再算差异；
  // 按引用判重（而非 open）避免工具条手动重开时用陈旧 prefill 覆盖。
  const appliedPrefillRef = useRef<typeof prefill>(undefined);
  useEffect(() => {
    if (prefill === undefined || prefill === appliedPrefillRef.current) return;
    appliedPrefillRef.current = prefill;
    setOriginal(prefill.original);
    setRewritten(prefill.rewritten);
    setLocalError(undefined);
  }, [prefill]);

  const acceptedCount = useMemo(
    () => state.hunks.filter((h) => (state.decisions[h.id] ?? 'accept') === 'accept').length,
    [state.hunks, state.decisions],
  );

  const chapterTarget = resolveIssueChapterTarget(
    { anchors: prefill === undefined ? [] : [{ kind: 'chapter', id: prefill.nodeId }] },
    selectedNodeId,
  );
  const anchoredNodeId = chapterTarget.enabled ? chapterTarget.targetChapterId : selectedNodeId;
  const anchorReady =
    anchoredNodeId !== undefined &&
    selectedNodeId === anchoredNodeId &&
    contentNodeId === anchoredNodeId &&
    !loadingContent;
  const canCompute = anchorReady && original.length > 0 && rewritten.length > 0 && !busy;

  const onCompute = (): void => {
    if (!anchorReady || anchoredNodeId === undefined) return;
    const located = locateAnchor(content, anchoredNodeId, original);
    if ('error' in located) {
      setLocalError(located.error);
      return;
    }
    setLocalError(undefined);
    computeDiff(located.anchor, rewritten);
  };

  const onReset = (): void => {
    clear();
    setOriginal('');
    setRewritten('');
    setLocalError(undefined);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!controlled && (
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            改写审阅
          </Button>
        </SheetTrigger>
      )}
      <SheetContent side="right" className="w-[40rem] sm:max-w-none">
        <SheetHeader>
          <SheetTitle>改写审阅（局部重构）</SheetTitle>
          <SheetDescription>
            确认原片段与改写片段 → 计算差异 → 逐段接受/拒绝 → 拼回落盘（后端执行，可回滚）。
          </SheetDescription>
          {legacyContextSummary !== undefined && (
            <details className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium text-foreground">
                本次改写将带入：{legacyContextSummary.preservedPlots.length} 个保留情节 · {legacyContextSummary.preservedQuotes.length} 段保留原文 · {legacyContextSummary.crossChapterIssues.filter((issue) => issue.status === 'open' || issue.status === 'confirmed').length} 个待处理贯穿问题
              </summary>
              <div className="mt-2 max-h-52 space-y-3 overflow-y-auto text-left">
                {legacyContextSummary.preservedPlots.length > 0 && (
                  <section>
                    <div className="font-medium text-foreground">必须保留的情节</div>
                    {legacyContextSummary.preservedPlots.map((plot, index) => (
                      <div key={`${plot.title}-${index}`} className="mt-1 text-muted-foreground">
                        <div>• {plot.title}：{plot.summary}</div>
                        {plot.authorNote !== undefined && <div className="ml-3 text-foreground">后续改写要求：{plot.authorNote}</div>}
                      </div>
                    ))}
                  </section>
                )}
                {legacyContextSummary.preservedQuotes.length > 0 && (
                  <section>
                    <div className="font-medium text-foreground">保留原文</div>
                    {legacyContextSummary.preservedQuotes.map((quote, index) => (
                      <div key={`${quote.sourceChapterTitle}-${index}`} className="mt-1 text-muted-foreground">
                        <div>• {quote.sourceChapterTitle}：「{quote.text}」</div>
                        {quote.authorNote !== undefined && <div className="ml-3 text-foreground">作者说明：{quote.authorNote}</div>}
                      </div>
                    ))}
                  </section>
                )}
                {legacyContextSummary.crossChapterIssues.length > 0 && (
                  <section>
                    <div className="font-medium text-foreground">贯穿问题与作者裁决</div>
                    {legacyContextSummary.crossChapterIssues.map((issue, index) => (
                      <div key={`${issue.description}-${index}`} className="mt-1 text-muted-foreground">
                        <div>• [{issue.status}] {issue.description}</div>
                        {issue.authorNote !== undefined && <div className="ml-3 text-foreground">作者裁决：{issue.authorNote}</div>}
                      </div>
                    ))}
                  </section>
                )}
              </div>
            </details>
          )}
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">{statusText(state.status)}</span>
            {anchoredNodeId === undefined && <span className="text-destructive">该问题缺少章节锚点</span>}
            {anchoredNodeId !== undefined && selectedNodeId !== anchoredNodeId && (
              <span className="text-muted-foreground">正在切换到问题所在章节…</span>
            )}
            {anchoredNodeId !== undefined &&
              selectedNodeId === anchoredNodeId &&
              (loadingContent || contentNodeId !== anchoredNodeId) && (
                <span className="text-muted-foreground">正在加载章节正文…</span>
              )}
          </div>

          {(state.status === 'idle' || state.status === 'computing' || state.status === 'failed') && (
            <>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">原片段（须与当前章节正文逐字一致）</span>
                <textarea
                  className="h-24 resize-y rounded-md border border-border bg-background p-2 text-xs"
                  value={original}
                  onChange={(e) => setOriginal(e.target.value)}
                  placeholder="粘贴/输入待改写的原文片段…"
                />
              </label>
              {prefill?.suggestion !== undefined && prefill.suggestion.length > 0 && (
                <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
                  <span className="text-muted-foreground">修改建议：</span>
                  <span className="ml-1 text-foreground">{prefill.suggestion}</span>
                </div>
              )}
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">改写后的正文片段</span>
                <textarea
                  className="h-24 resize-y rounded-md border border-border bg-background p-2 text-xs"
                  value={rewritten}
                  onChange={(e) => setRewritten(e.target.value)}
                  placeholder="根据修改建议输入可直接替换原文的正文…"
                />
              </label>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={!canCompute} onClick={onCompute}>
                  计算差异
                </Button>
                {state.status !== 'idle' && (
                  <Button type="button" size="sm" variant="ghost" onClick={onReset}>
                    重置
                  </Button>
                )}
              </div>
            </>
          )}

          {localError !== undefined && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {localError}
            </div>
          )}

          {(state.status === 'reviewing' || state.status === 'applying') && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>共 {state.hunks.length} 处差异 · 接受 {acceptedCount} 处</span>
                <div className="flex gap-2">
                  <Button type="button" size="xs" disabled={busy} onClick={apply}>
                    拼回落盘
                  </Button>
                  <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={onReset}>
                    放弃
                  </Button>
                </div>
              </div>
              <ScrollArea className="h-[24rem] rounded-md border border-border p-2">
                {state.hunks.length === 0 ? (
                  <div className="text-xs text-muted-foreground">无差异（原片段与改写片段一致）。</div>
                ) : (
                  <div className="space-y-2">
                    {state.hunks.map((hunk) => (
                      <HunkRow
                        key={hunk.id}
                        hunk={hunk}
                        decision={state.decisions[hunk.id] ?? 'accept'}
                        onDecision={setDecision}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          {state.status === 'applied' && (
            <div className="flex flex-col gap-2">
              <div className="rounded-md border border-green-500/40 bg-green-500/10 px-2 py-1.5 text-xs text-green-700">
                已拼回落盘：接受 {state.acceptedHunkIds.length} 处差异。
                {state.checkpointId !== undefined && (
                  <div className="mt-0.5 text-green-800">checkpoint：{state.checkpointId}</div>
                )}
                正文已重载。
              </div>
              <Button type="button" size="sm" variant="outline" onClick={onReset}>
                再改一处
              </Button>
            </div>
          )}

          {state.status === 'failed' && state.error !== undefined && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              {state.error}
              {state.failedHunkIds.length > 0 && (
                <div className="mt-0.5">相关 hunk：{state.failedHunkIds.join(', ')}</div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
