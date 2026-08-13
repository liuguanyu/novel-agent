/** 老书整理 — 保留内容底部抽屉。 */

import { useState } from 'react';
import { Bookmark, BookOpen, PinOff, Quote } from 'lucide-react';
import type { PreservationManifestDto } from '../../shared/ipc/index.js';
import { Button } from './ui/button.js';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet.js';
import { ScrollArea } from './ui/scroll-area.js';

interface PreservationDrawerProps {
  readonly manifest: PreservationManifestDto | undefined;
  readonly onSelectChapter: (nodeId: string) => Promise<void>;
  readonly onOpenPlot: (outlineNodeId: string) => void;
  readonly onUnpreservePlot: (plotId: string) => void;
  readonly onUnpreserveQuote: (quoteId: string) => void;
}

export function PreservationDrawer({
  manifest,
  onSelectChapter,
  onOpenPlot,
  onUnpreservePlot,
  onUnpreserveQuote,
}: PreservationDrawerProps): JSX.Element {
  const plots = manifest?.plots ?? [];
  const quotes = manifest?.quotes ?? [];
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex w-full shrink-0 items-center justify-between border-t border-border bg-card px-4 py-2 text-xs transition-colors hover:bg-muted/60"
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            <Bookmark className="size-3.5 text-amber-500" aria-hidden />
            已保留 {plots.length} 个情节 · {quotes.length} 处原文
          </span>
          <span className="text-muted-foreground">查看保留清单</span>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[72vh] gap-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>保留内容</SheetTitle>
          <SheetDescription>这些情节和文字会作为后续整理的明确约束，原稿本身不会被修改。</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto grid max-w-5xl gap-6 p-5 md:grid-cols-2">
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Bookmark className="size-4 text-amber-500" aria-hidden />
                保留情节 ({plots.length})
              </h3>
              {plots.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  还没有保留情节。
                </p>
              ) : (
                <div className="space-y-2">
                  {plots.map((plot) => (
                    <article key={plot.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <button type="button" className="text-left text-sm font-medium hover:text-primary hover:underline" onClick={() => { setOpen(false); onOpenPlot(plot.outlineNodeId); }}>{plot.title}</button>
                          {plot.authorNote !== undefined && plot.authorNote.length > 0 && (
                            <div className="mt-2 rounded bg-muted/50 px-2 py-1.5">
                              <p className="text-[10px] font-medium text-muted-foreground">后续改写要求</p>
                              <p className="mt-0.5 text-xs leading-relaxed">{plot.authorNote}</p>
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => onUnpreservePlot(plot.id)}
                        >
                          <PinOff className="size-3.5" aria-hidden />
                          取消
                        </Button>
                      </div>
                      {plot.sourceNodeIds.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {plot.sourceNodeIds.map((nodeId, index) => (
                            <Button
                              key={nodeId}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => void onSelectChapter(nodeId)}
                            >
                              <BookOpen className="size-3" aria-hidden />
                              查看来源 {index + 1}
                            </Button>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Quote className="size-4 text-primary" aria-hidden />
                保留原文 ({quotes.length})
              </h3>
              {quotes.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  还没有保留原文。可在正文中框选文字后标记。
                </p>
              ) : (
                <div className="space-y-2">
                  {quotes.map((quote) => (
                    <article key={quote.id} className="rounded-lg border border-border bg-card p-3">
                      <blockquote className="text-sm leading-relaxed">“{quote.text}”</blockquote>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 truncate text-left text-xs text-primary hover:underline"
                          onClick={() => void onSelectChapter(quote.sourceNodeId)}
                        >
                          {quote.sourceChapterTitle || '查看原稿来源'}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => onUnpreserveQuote(quote.id)}
                        >
                          <PinOff className="size-3.5" aria-hidden />
                          取消
                        </Button>
                      </div>
                      {quote.authorNote !== undefined && quote.authorNote.length > 0 && (
                        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                          {quote.authorNote}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
