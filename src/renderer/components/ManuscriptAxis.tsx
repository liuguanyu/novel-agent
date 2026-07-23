/**
 * 中正文轴 (walking-skeleton task 6.1；review-findings-ui 定位高亮扩展)
 *
 * 用 TipTap 显示选中章的真实正文（Markdown 原文按段落装入编辑器）。只读呈现结构，
 * 并接入自定义 ProseMirror Decoration 插件：据审校证据引文在文档内定位、滚动到位并高亮，
 * 供「点击审校卡片 → 定位原文 → 连线」链路承载。经 ref 暴露 highlightQuote/clearHighlight。
 */

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { forwardRef, useEffect, useImperativeHandle } from 'react';

/** 高亮定位区间（ProseMirror 位置）。 */
interface HighlightRange {
  readonly from: number;
  readonly to: number;
}

/** 命令式暴露给外壳的正文轴 API。 */
export interface ManuscriptAxisHandle {
  /** 据证据引文在正文中定位、滚动到位并高亮；定位失败返回 false（不施加错位高亮）。 */
  highlightQuote(quote: string): boolean;
  /** 清除当前高亮。 */
  clearHighlight(): void;
}

interface ManuscriptAxisProps {
  content: string;
  loading: boolean;
  selectedNodeId: string | undefined;
}

const reviewHighlightKey = new PluginKey<DecorationSet>('review-highlight');

/** 设置/清除高亮区间的元信息载荷。 */
interface HighlightMeta {
  readonly range: HighlightRange | null;
}

/** 自定义高亮插件：以 Decoration.inline 承载单个证据引文高亮，随文档 mapping 修正不漂移。 */
function reviewHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: reviewHighlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old): DecorationSet {
        const meta = tr.getMeta(reviewHighlightKey) as HighlightMeta | undefined;
        if (meta !== undefined) {
          if (meta.range === null) return DecorationSet.empty;
          const deco = Decoration.inline(meta.range.from, meta.range.to, {
            class: 'review-highlight',
            'data-review-highlight': 'true',
          });
          return DecorationSet.create(tr.doc, [deco]);
        }
        // 无高亮元信息时随文档变化 mapping 修正既有区间（防漂移）。
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state): DecorationSet | undefined {
        return reviewHighlightKey.getState(state);
      },
    },
  });
}

/**
 * 在文档内定位引文文本，返回 ProseMirror 区间；跨文本节点（同段内）亦可定位，无法定位返回 null。
 * 遍历文本节点建「全局字符串索引 → PM 位置」映射，对候选引文做 indexOf 后映射回区间。
 * 候选策略（依次尝试，首个命中即高亮）：
 *  1. 完整引文精确匹配；
 *  2. 若失败（常因引文含省略号拼接两段不相邻原文），按省略号/换行拆段，取最长可定位片段。
 */
function locateQuote(doc: PMNode, quote: string): HighlightRange | null {
  const trimmed = quote.trim();
  if (trimmed.length === 0) return null;
  let full = '';
  const positions: number[] = []; // positions[i] = 第 i 个字符的 PM 位置
  doc.descendants((node, pos) => {
    if (node.isText && node.text !== null && node.text !== undefined) {
      for (let i = 0; i < node.text.length; i++) {
        full += node.text[i];
        positions.push(pos + i);
      }
    }
    return true;
  });

  const toRange = (idx: number, len: number): HighlightRange | null => {
    const fromPos = positions[idx];
    const lastPos = positions[idx + len - 1];
    if (fromPos === undefined || lastPos === undefined) return null;
    return { from: fromPos, to: lastPos + 1 };
  };

  // 候选 1：完整引文精确匹配。
  const exact = full.indexOf(trimmed);
  if (exact !== -1) return toRange(exact, trimmed.length);

  // 候选 2：按省略号（…… / ... / \u2026）与换行拆段，长度降序逐个定位（优先最具体的长片段）。
  const segments = trimmed
    .split(/[\u2026]+|\.{3,}|[\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length);
  for (const seg of segments) {
    const idx = full.indexOf(seg);
    if (idx !== -1) return toRange(idx, seg.length);
  }
  return null;
}

/** 把 Markdown 原文按段落转为 TipTap/ProseMirror 的段落 HTML（骨架级，不做完整 md 解析）。 */
function toParagraphHtml(markdown: string): string {
  if (markdown.length === 0) return '<p></p>';
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const ManuscriptAxis = forwardRef<ManuscriptAxisHandle, ManuscriptAxisProps>(
  function ManuscriptAxis({ content, loading, selectedNodeId }, ref): JSX.Element {
    const editor = useEditor({
      extensions: [StarterKit],
      editable: false,
      content: '<p></p>',
      editorProps: {},
    });

    // 注册高亮插件（编辑器就绪后一次）。
    useEffect(() => {
      if (editor === null) return;
      editor.registerPlugin(reviewHighlightPlugin());
      return () => {
        editor.unregisterPlugin(reviewHighlightKey);
      };
    }, [editor]);

    useEffect(() => {
      if (editor === null) return;
      editor.commands.setContent(toParagraphHtml(content));
    }, [editor, content]);

    useImperativeHandle(
      ref,
      (): ManuscriptAxisHandle => ({
        highlightQuote(quote: string): boolean {
          if (editor === null) return false;
          const range = locateQuote(editor.state.doc, quote);
          const meta: HighlightMeta = { range };
          const tr = editor.state.tr.setMeta(reviewHighlightKey, meta);
          editor.view.dispatch(tr);
          if (range === null) return false;
          // 滚动到高亮处：定位高亮 DOM 并居中滚入可视区。
          requestAnimationFrame(() => {
            const el = editor.view.dom.querySelector('[data-review-highlight="true"]');
            if (el !== null) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          return true;
        },
        clearHighlight(): void {
          if (editor === null) return;
          const meta: HighlightMeta = { range: null };
          editor.view.dispatch(editor.state.tr.setMeta(reviewHighlightKey, meta));
        },
      }),
      [editor],
    );

    return (
      <main className="flex h-full flex-col overflow-hidden bg-background">
        <div className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
          {selectedNodeId === undefined ? '未选择章节' : loading ? '加载正文中…' : '正文'}
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <EditorContent
            editor={editor}
            className="reading-prose mx-auto max-w-[42rem] text-foreground"
          />
        </div>
      </main>
    );
  },
);
