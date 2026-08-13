/** 针对单个旧稿情节的上下文参谋。只产出建议，不直接修改任何作者数据。 */

import { z } from 'zod';
import type { CapabilityTier, ModelAdapter } from '../../core/model/index.js';

const ADVISOR_AGENT_ID = 'architect';
const ADVISOR_TIER: CapabilityTier = 'cheap-fast';
const MAX_CONTEXT_CHARS = 50_000;
// 参谋要求返回结构化建议；2048 对包含整章正文和多轮讨论的请求过于紧张，
// 很容易在 JSON 闭合前触发 provider 的 length finish_reason。
const ADVISOR_MAX_OUTPUT_TOKENS = 8_192;

export interface PlotAdvisorModelResolver {
  createAdapter(agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'>;
}

export type PlotAdvisorMode = 'auto' | 'timeline' | 'historical-context' | 'plot-logic' | 'character' | 'panel';

export interface PlotAdvisorInput {
  readonly mode: PlotAdvisorMode;
  readonly chapterTitle: string;
  readonly chapterContent: string;
  readonly plotTitle: string;
  readonly plotSummary: string;
  readonly evidenceQuote: string | undefined;
  readonly question: string;
  readonly conversation: ReadonlyArray<{ role: 'author' | 'advisor'; content: string }>;
}

export interface PlotAdvisorResult {
  readonly advice: string;
  readonly options: ReadonlyArray<string>;
}

const advisorOutputSchema = z.object({
  advice: z.string().trim().min(1).max(2_000),
  options: z.array(z.string().trim().min(1).max(300)).max(5).default([]),
}).strict();

function parseOutput(text: string): PlotAdvisorResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()) as unknown;
  } catch {
    throw new Error('参谋没有返回合法建议，请重试');
  }
  const parsed = advisorOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error('参谋返回的建议格式不完整，请重试');
  return parsed.data;
}

export function renderPlotAdvisorPrompt(input: PlotAdvisorInput): string {
  const content = input.chapterContent.length > MAX_CONTEXT_CHARS
    ? `${input.chapterContent.slice(0, MAX_CONTEXT_CHARS)}\n[章节正文过长，后文省略]`
    : input.chapterContent;
  const modeInstructions: Record<PlotAdvisorMode, string> = {
    auto: '先判断问题属于时间线、时代背景、情节逻辑还是人物合理性；必要时综合核查。',
    timeline: '重点核查绝对年份、相对时间、事件先后、人物年龄和章节间时间关系。',
    'historical-context': '重点核查时代背景、历史事件、地点与人物当时是否可能知道相关事实；不确定时明确标记需要外部史实确认。',
    'plot-logic': '重点核查因果、信息分配、物品关系、人物行动动机和情节闭合。',
    character: '重点核查人物身份、知识范围、动机、语言和反应是否合理。',
    panel: '联合核查时间线、时代背景、情节逻辑和人物合理性，最后给出一份综合结论。',
  };
  const modeInstruction = modeInstructions[input.mode];
  return `你是小说作者的“情节参谋”，帮助作者严谨整理旧稿，不替作者做最终决定。\n\n` +
    `本次核查方式：${modeInstruction}\n\n` +
    `请基于完整上下文主动审阅当前情节。即使作者问题为空，也要自行寻找值得确认的风险；如果没有发现明确问题，要直说“暂未发现明确风险”，不要为了凑问题而臆测。检查因果、人物动机、信息安全性、时间顺序和读者是否能理解。指出风险时给出可执行的整理方案。不要改写整章，不要分析作者为什么写崩。\n` +
    `如果缺少决定解释成立与否的关键信息，不要急着裁决；先在建议末尾明确提出一个最需要作者回答的问题。\n\n` +
    `请只输出合法 JSON：{"advice":"给作者的具体建议","options":["可采纳方案1","可采纳方案2","建议作者补充确认的问题"]}。建议应简洁。options 的前几项必须是作者可以直接采纳的整理方向；如果仍需继续讨论，请把最后一项写成需要作者补充确认的问题或意图澄清，例如“如果你的本意是……，请补充……”。不要把追问放在前几项。若没有可采纳方案也没有追问，则返回空数组。\n\n` +
    `章节：${input.chapterTitle}\n` +
    `章节正文：\n${content}\n\n` +
    `当前情节标题：${input.plotTitle}\n` +
    `当前情节摘要：${input.plotSummary}\n` +
    `识别证据：${input.evidenceQuote ?? '无'}\n\n` +
    (input.conversation.length > 0
      ? `此前讨论（按时间顺序；作者会补充真实意图，参谋需要基于这些内容继续推理）：\n${input.conversation.slice(-12).map((message) => `${message.role === 'author' ? '作者' : '参谋'}：${message.content.slice(0, 1_000)}`).join('\n')}\n\n`
      : '') +
    `作者本轮补充/问题（可为空；为空表示请参谋主动检查）：${input.question.trim() || '请主动找出当前情节中可能需要作者确认的问题。'}\n` +
    `如果作者在追问中说明了真实意图，请优先判断这种意图是否成立、需要哪些铺垫，而不是继续把旧解释当唯一答案。`;
}

export class PlotAdvisor {
  constructor(private readonly resolver: PlotAdvisorModelResolver) {}

  async ask(input: PlotAdvisorInput): Promise<PlotAdvisorResult> {
    const adapter = this.resolver.createAdapter(ADVISOR_AGENT_ID, ADVISOR_TIER);
    const result = await adapter.complete({
      messages: [
        { role: 'system', content: '你只输出合法 JSON，不输出 Markdown、分析过程或整章改写。' },
        { role: 'user', content: renderPlotAdvisorPrompt(input) },
      ],
      options: { temperature: 0.2, maxTokens: ADVISOR_MAX_OUTPUT_TOKENS },
    });
    if (result.finishReason === 'length') throw new Error('参谋建议被截断，请重试');
    return parseOutput(result.text);
  }
}
