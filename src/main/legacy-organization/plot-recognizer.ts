/**
 * 旧稿章节情节识别器。
 *
 * 普通章节一次识别；长章节按自然边界完整分片、顺序接续识别，最后做章节级归并。
 * 任一分片或归并失败都会让整章失败，调用方因此可以保持旧候选不变。
 */

import { z } from 'zod';
import type { CapabilityTier, ModelAdapter } from '../../core/model/index.js';

const PLOT_RECOGNIZER_AGENT_ID = 'architect';
const PLOT_RECOGNIZER_TIER: CapabilityTier = 'cheap-fast';
const TARGET_SEGMENT_CHARS = 24_000;
const MAX_SEGMENT_CHARS = 30_000;
const CONTINUATION_CONTEXT_CHARS = 1_200;
const MIN_PLOTS = 2;
const MAX_PLOTS_PER_SEGMENT = 8;
const MAX_CHAPTER_PLOTS = 48;

export interface PlotCandidate {
  readonly title: string;
  readonly summary: string;
  readonly quote: string;
  readonly characters: ReadonlyArray<string>;
}

export interface PlotRecognitionProgress {
  readonly segment: number;
  readonly totalSegments: number;
}

export interface PlotRecognizerModelResolver {
  createAdapter(agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'>;
}

const rawPlotSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  quote: z.string().trim().default(''),
  characters: z.array(z.string().trim().min(1)).default([]),
}).strict();

const rawOutputSchema = z.object({
  plots: z.array(rawPlotSchema).max(MAX_PLOTS_PER_SEGMENT),
}).strict();

const mergedOutputSchema = z.object({
  plots: z.array(z.object({
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    characters: z.array(z.string().trim().min(1)).default([]),
    sourceCandidateIds: z.array(z.string().trim().min(1)).min(1).max(8),
  }).strict()).max(MAX_CHAPTER_PLOTS),
}).strict();

function stripJsonFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function limitText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

/** 解析并收紧模型结果，保证 UI 和持久化层只收到短候选。 */
export function parsePlotRecognitionOutput(text: string, minimumPlots = MIN_PLOTS): ReadonlyArray<PlotCandidate> {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(text)) as unknown;
  } catch {
    throw new Error('模型没有返回合法的情节 JSON，请重试');
  }

  const parsed = rawOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`模型返回的情节格式不符合要求：${parsed.error.issues[0]?.message ?? '未知格式错误'}`);
  }
  if (parsed.data.plots.length !== 0 && parsed.data.plots.length < minimumPlots) {
    throw new Error(`模型只识别出 ${parsed.data.plots.length} 个情节，未达到可整理的最低数量，请重试`);
  }

  return parsed.data.plots.map((plot) => ({
    title: limitText(plot.title, 40),
    summary: limitText(plot.summary, 120),
    quote: limitText(plot.quote, 160),
    characters: [...new Set(plot.characters.map((name) => limitText(name, 20)))].slice(0, 12),
  }));
}

/**
 * 按段落/换行/句末标点切分，保证正文字符恰好被覆盖一次，不截掉后半章。
 * 接续上下文在 prompt 中单独携带，不重复计入当前分片。
 */
export function splitChapterContent(content: string): ReadonlyArray<string> {
  if (content.length <= MAX_SEGMENT_CHARS) return content.length === 0 ? [] : [content];
  const segments: string[] = [];
  let start = 0;
  while (start < content.length) {
    const remaining = content.length - start;
    if (remaining <= MAX_SEGMENT_CHARS) {
      segments.push(content.slice(start));
      break;
    }
    const preferredEnd = Math.min(start + TARGET_SEGMENT_CHARS, content.length);
    const hardEnd = Math.min(start + MAX_SEGMENT_CHARS, content.length);
    const search = content.slice(preferredEnd, hardEnd);
    const candidates = [search.lastIndexOf('\n\n'), search.lastIndexOf('\n'), search.lastIndexOf('。'), search.lastIndexOf('！'), search.lastIndexOf('？')];
    const boundary = Math.max(...candidates);
    const end = boundary >= 0 ? preferredEnd + boundary + 1 : hardEnd;
    segments.push(content.slice(start, end));
    start = end;
  }
  return segments.filter((segment) => segment.length > 0);
}

export function renderPlotRecognitionPrompt(chapterTitle: string, content: string): string {
  return `你是中文长篇小说的旧稿整理助手。请识别这一章中真正发生的主要故事情节，供作者人工取舍。\n\n` +
    `情节定义：由人物行动、冲突、发现、决定或局势变化构成的完整故事事件。不要按段落均分，不要把环境描写、对话片段或整章复述单独当作情节。\n\n` +
    `硬性要求：\n` +
    `1. 通常识别 2–8 个主要情节，按原文发生顺序排列；如果正文没有可识别的故事事件，返回空数组。\n` +
    `2. title 是不超过 40 字的事件标题；summary 用一句话概括“谁做了什么、带来什么变化”，不超过 120 字。\n` +
    `3. quote 只取能定位该事件的短原文证据，不超过 160 字，绝不能复制大段正文。\n` +
    `4. characters 只列本情节中明确出现的主要人物名。不要分析写作问题，不要评价，不要改写正文。\n` +
    `5. 最终只输出合法 JSON object，不要 Markdown、解释、序号或思考过程。\n\n` +
    `输出格式：{"plots":[{"title":"短标题","summary":"一句话事件摘要","quote":"短原文证据","characters":["人物名"]}]}\n\n` +
    `章节标题：${chapterTitle}\n章节正文：\n${content}`;
}

function renderSegmentPrompt(
  chapterTitle: string,
  segment: string,
  segmentIndex: number,
  totalSegments: number,
  previousTail: string,
  previousPlots: ReadonlyArray<PlotCandidate>,
): string {
  const previous = previousPlots.slice(-6).map((plot) => `- ${plot.title}：${plot.summary}`).join('\n') || '（尚无）';
  return `你在接续识别长章节「${chapterTitle}」的情节。这是第 ${segmentIndex + 1}/${totalSegments} 段。\n` +
    `只提取“当前正文分段”中发生或完成的主要事件；上段末尾仅用于理解接续关系，不要把它单独重复识别。跨段事件可以在当前段形成候选，章节级归并稍后会合并。\n\n` +
    `上一段已识别情节：\n${previous}\n\n上一段末尾上下文（仅供接续）：\n${previousTail || '（第一段，无上文）'}\n\n` +
    `要求：当前分段识别 0–8 个主要情节，按发生顺序；title≤40字，summary≤120字，quote≤160字；characters 只列明确人物；只输出合法 JSON。\n` +
    `输出格式：{"plots":[{"title":"短标题","summary":"一句话事件摘要","quote":"短原文证据","characters":["人物名"]}]}\n\n` +
    `当前正文分段：\n${segment}`;
}

function renderMergePrompt(chapterTitle: string, candidates: ReadonlyArray<{ id: string; plot: PlotCandidate }>): string {
  const lines = candidates.map(({ id, plot }) =>
    `[${id}] 标题：${plot.title}\n摘要：${plot.summary}\n人物：${plot.characters.join('、') || '无'}\n证据：${plot.quote || '无'}`,
  );
  return `你要把长章节「${chapterTitle}」各分段识别出的局部情节，归并成完整的章节情节列表。\n` +
    `合并跨分段的同一事件，删除重叠或同义重复，保留确实不同的主要事件，并严格按原文先后顺序排列。不要因为数量多而丢掉真实主要事件。\n` +
    `每个最终情节必须通过 sourceCandidateIds 引用一个或多个原候选 id；只输出合法 JSON。\n` +
    `输出格式：{"plots":[{"title":"短标题","summary":"一句话摘要","characters":["人物"],"sourceCandidateIds":["s1-p1"]}]}\n\n` +
    `分段候选：\n${lines.join('\n\n')}`;
}

export class PlotRecognizer {
  constructor(private readonly resolver: PlotRecognizerModelResolver) {}

  async recognize(
    chapterTitle: string,
    content: string,
    onProgress?: (progress: PlotRecognitionProgress) => void | Promise<void>,
  ): Promise<ReadonlyArray<PlotCandidate>> {
    if (content.trim().length === 0) return [];
    const segments = splitChapterContent(content);
    const adapter = this.resolver.createAdapter(PLOT_RECOGNIZER_AGENT_ID, PLOT_RECOGNIZER_TIER);

    if (segments.length === 1) {
      await onProgress?.({ segment: 1, totalSegments: 1 });
      const result = await adapter.complete({
        messages: [
          { role: 'system', content: '你只输出合法 JSON。禁止输出分析、解释、Markdown 或整章复述。' },
          { role: 'user', content: renderPlotRecognitionPrompt(chapterTitle, segments[0]!) },
        ],
        options: { temperature: 0, maxTokens: 4096 },
      });
      if (result.finishReason === 'length') throw new Error('情节识别结果被模型截断，请重试');
      return parsePlotRecognitionOutput(result.text);
    }

    const segmentResults: Array<{ segmentIndex: number; plot: PlotCandidate }> = [];
    for (let index = 0; index < segments.length; index++) {
      await onProgress?.({ segment: index + 1, totalSegments: segments.length });
      const previousSegment = index > 0 ? segments[index - 1]! : '';
      const result = await adapter.complete({
        messages: [
          { role: 'system', content: '你只输出合法 JSON。禁止输出分析、解释、Markdown 或整章复述。' },
          {
            role: 'user',
            content: renderSegmentPrompt(
              chapterTitle,
              segments[index]!,
              index,
              segments.length,
              previousSegment.slice(-CONTINUATION_CONTEXT_CHARS),
              segmentResults.map((item) => item.plot),
            ),
          },
        ],
        options: { temperature: 0, maxTokens: 4096 },
      });
      if (result.finishReason === 'length') throw new Error(`第 ${index + 1}/${segments.length} 段情节识别结果被截断，请重试`);
      for (const plot of parsePlotRecognitionOutput(result.text, 0)) segmentResults.push({ segmentIndex: index, plot });
    }

    if (segmentResults.length === 0) return [];
    const indexed = segmentResults.map((item, index) => ({ id: `s${item.segmentIndex + 1}-p${index + 1}`, plot: item.plot }));
    const mergeResult = await adapter.complete({
      messages: [
        { role: 'system', content: '你只输出合法 JSON，不输出解释或 Markdown。' },
        { role: 'user', content: renderMergePrompt(chapterTitle, indexed) },
      ],
      options: { temperature: 0, maxTokens: 8192 },
    });
    if (mergeResult.finishReason === 'length') throw new Error('章节情节归并结果被模型截断，请重试');

    let raw: unknown;
    try {
      raw = JSON.parse(stripJsonFence(mergeResult.text)) as unknown;
    } catch {
      throw new Error('章节情节归并没有返回合法 JSON，请重试');
    }
    const parsed = mergedOutputSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`章节情节归并格式不完整：${parsed.error.issues[0]?.message ?? '未知格式错误'}`);
    const sourceById = new Map(indexed.map((item) => [item.id, item.plot]));
    return parsed.data.plots.map((plot) => {
      const sources = plot.sourceCandidateIds.map((id) => sourceById.get(id)).filter((item): item is PlotCandidate => item !== undefined);
      if (sources.length === 0) throw new Error('章节情节归并引用了不存在的分段候选，请重试');
      return {
        title: limitText(plot.title, 40),
        summary: limitText(plot.summary, 120),
        quote: sources.find((source) => source.quote.length > 0)?.quote ?? '',
        characters: [...new Set([...plot.characters, ...sources.flatMap((source) => source.characters)].map((name) => limitText(name, 20)))].slice(0, 12),
      };
    });
  }
}
