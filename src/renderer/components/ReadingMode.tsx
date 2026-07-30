/**
 * 读书模式 (workflow-guided-workbench task 10.8)
 *
 * 三栏工作台之外的全屏人类阅读视图：只保留书名/章节上下文、正文（阅读排版）、
 * 上一章/下一章与返回工作台。后台任务不受影响，右下角以极简徽标提示进展；
 * 出现需要作者裁决的冲突时非破坏性提示，绝不强制把作者踢回工作台。
 */

import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, CircleAlert } from 'lucide-react';
import { Button } from './ui/button.js';
import type { ChapterTreeDto, ChapterTreeNodeDto } from '../../shared/ipc/index.js';

interface ReadingModeProps {
  tree: ChapterTreeDto | undefined;
  selectedNodeId: string | undefined;
  /** 当前章节路径（如「第一卷 / 第三章 灶王爷」），由外壳按树计算。 */
  chapterPath: string | undefined;
  content: string;
  loading: boolean;
  /** 后台是否有任务在跑（事实核对/审计/专家等），仅用于极简徽标。 */
  backgroundBusy: boolean;
  /** 后台是否有等待作者裁决的事项；提示但不强制退出阅读。 */
  backgroundNeedsAttention: boolean;
  onSelectChapter: (nodeId: string) => void;
  onExit: () => void;
}

/** 深度优先收集全部章节叶（阅读顺序即树序），供上一章/下一章遍历。 */
function flattenChapters(
  nodes: ReadonlyArray<ChapterTreeNodeDto>,
  out: ChapterTreeNodeDto[] = [],
): ChapterTreeNodeDto[] {
  for (const node of nodes) {
    if (node.kind === 'chapter') out.push(node);
    flattenChapters(node.children, out);
  }
  return out;
}

export function ReadingMode({
  tree,
  selectedNodeId,
  chapterPath,
  content,
  loading,
  backgroundBusy,
  backgroundNeedsAttention,
  onSelectChapter,
  onExit,
}: ReadingModeProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  const chapters = useMemo(() => (tree === undefined ? [] : flattenChapters(tree.roots)), [tree]);
  const currentIndex = useMemo(
    () => chapters.findIndex((chapter) => chapter.id === selectedNodeId),
    [chapters, selectedNodeId],
  );
  const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : undefined;
  const nextChapter =
    currentIndex >= 0 && currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : undefined;

  // 换章后回到篇首，符合线性阅读预期；同章内滚动位置由浏览器保留。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selectedNodeId]);

  // 左右方向键翻章（避开输入场景：阅读视图内无文本输入）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowLeft' && prevChapter !== undefined) {
        onSelectChapter(prevChapter.id);
      } else if (event.key === 'ArrowRight' && nextChapter !== undefined) {
        onSelectChapter(nextChapter.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [prevChapter, nextChapter, onSelectChapter]);

  const paragraphs = useMemo(
    () =>
      content
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0),
    [content],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          <ArrowLeft className="size-4" aria-hidden />
          返回工作台
        </Button>
        <div className="min-w-0 text-center text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{tree?.title ?? '加载中…'}</span>
          {chapterPath !== undefined && <span className="mx-2 opacity-60">·</span>}
          {chapterPath !== undefined && <span className="truncate">{chapterPath}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={prevChapter === undefined}
            onClick={() => prevChapter !== undefined && onSelectChapter(prevChapter.id)}
            title={prevChapter?.title}
          >
            <ChevronLeft className="size-4" aria-hidden />
            上一章
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={nextChapter === undefined}
            onClick={() => nextChapter !== undefined && onSelectChapter(nextChapter.id)}
            title={nextChapter?.title}
          >
            下一章
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-[38rem] px-6 py-12">
          {selectedNodeId === undefined ? (
            <p className="text-center text-muted-foreground">从工作台选择一章后进入阅读。</p>
          ) : loading ? (
            <p className="text-center text-muted-foreground">加载正文中…</p>
          ) : (
            <>
              <h1 className="mb-10 text-center text-xl font-semibold tracking-wide">
                {chapters[currentIndex]?.title ?? ''}
              </h1>
              {paragraphs.map((paragraph, index) => (
                <p
                  key={index}
                  className="mb-6 whitespace-pre-wrap text-[1.0625rem] leading-[1.9] tracking-[0.01em]"
                >
                  {paragraph}
                </p>
              ))}
              <div className="mt-14 flex items-center justify-between border-t border-border pt-6 text-sm">
                {prevChapter !== undefined ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => onSelectChapter(prevChapter.id)}
                  >
                    ← {prevChapter.title}
                  </button>
                ) : (
                  <span />
                )}
                {nextChapter !== undefined ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => onSelectChapter(nextChapter.id)}
                  >
                    {nextChapter.title} →
                  </button>
                ) : (
                  <span />
                )}
              </div>
            </>
          )}
        </article>
      </div>

      {(backgroundBusy || backgroundNeedsAttention) && (
        <div className="pointer-events-none absolute bottom-4 right-4">
          {backgroundNeedsAttention ? (
            <button
              type="button"
              onClick={onExit}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow-sm hover:bg-amber-100"
            >
              <CircleAlert className="size-3.5" aria-hidden />
              有事项等你裁决 · 回工作台处理
            </button>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              后台整理进行中
            </span>
          )}
        </div>
      )}
    </div>
  );
}
