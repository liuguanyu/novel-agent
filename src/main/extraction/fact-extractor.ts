/**
 * 事实抽取器 (story-bible-extraction I4 tasks 1.2–1.4)
 *
 * Main-only 边界：接收章节正文，组装中文事实抽取 prompt，调用 ModelResolver 的
 * `fact-extractor` agent，然后把非可信模型文本交给 schema/parser 防守层。
 */

import type { CapabilityTier, ModelAdapter, ModelResult } from '../../core/model/index.js';
import type { ExtractionInput, ExtractionOutput } from '../../core/story-bible/index.js';
import { appendOrchestrationLog } from '../local-log.js';
import { parseExtractionOutput, type ExtractionParseDiagnostics } from './fact-extraction-schema.js';

const FACT_EXTRACTOR_AGENT_ID = 'fact-extractor';
const FACT_EXTRACTOR_TIER: CapabilityTier = 'cheap-fast';

export interface FactExtractorModelResolver {
  createAdapter(agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'>;
}

export interface FactExtractionRunOptions {
  readonly signal?: AbortSignal;
  readonly logger?: (message: string) => void;
  /** 作者受控补充要求；只作为本次模型任务的额外约束，不修改已确认事实。 */
  readonly supplement?: string;
}

export interface FactExtractionResult {
  readonly output: ExtractionOutput;
  readonly diagnostics: ExtractionParseDiagnostics & {
    readonly rawChars: number;
    readonly finishReason: ModelResult['finishReason'];
  };
  /** 仅供调试/日志链路使用；调用方不得绕过 parser 直接消费 rawText。 */
  readonly rawText: string;
}

function compactForLog(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function logExtraction(input: ExtractionInput, result: FactExtractionResult, logger?: (message: string) => void): void {
  const message =
    `[fact-extraction] chapterId=${input.location.id as string} ` +
    `textChars=${input.text.length} rawChars=${result.diagnostics.rawChars} ` +
    `parse=${result.diagnostics.source} candidates=${result.diagnostics.validCandidates} ` +
    `invalid=${result.diagnostics.invalidCandidates} finish=${result.diagnostics.finishReason}`;
  appendOrchestrationLog(message);
  logger?.(message);
}

/** 渲染事实抽取 prompt。单独导出，便于 smoke/后续 prompt 迭代。 */
export function renderFactExtractionPrompt(input: ExtractionInput): string {
  return `你是中文长篇小说的事实抽取器。请从给定章节正文中抽取可进入 Story Bible 的候选事实。\n\n` +
    `硬性输出要求：\n` +
    `1. 最终只输出一个合法 JSON object，不要 Markdown、解释、序号、think、注释或尾随文本。\n` +
    `2. JSON 顶层必须是 {"candidates":[...]}。如果没有可抽取事实，输出 {"candidates":[]}。\n` +
    `3. 每个候选必须包含 kind、suggestedAnchor、confidence、payload。\n` +
    `4. suggestedAnchor 必须原样使用：{"id":"${input.location.id as string}","kind":"${input.location.kind}"}。\n` +
    `5. confidence 为 0 到 1 的数字。payload 必须含 quote，quote 是正文中的短引文，便于人工回溯。\n\n` +
    `候选 kind 与 payload 最小字段：\n` +
    `- entity: {"entityType":"person|place|organization|object|other","canonicalName":"...","aliases":["..."],"attributes":[{"key":"...","value":"...","quote":"..."}],"quote":"..."}\n` +
    `- alias: {"entityName":"...","alias":"...","quote":"..."}\n` +
    `- attribute: {"entityName":"...","key":"...","value":"...","quote":"..."}\n` +
    `- timeline-event: {"description":"...","relatedNames":["..."],"tick":1,"label":"...","quote":"..."}\n` +
    `- relation: {"fromName":"...","toName":"...","kind":"...","directionality":"directed|undirected","quote":"..."}\n` +
    `- plot-hook: {"description":"...","state":"planted|pending|paid_off|abandoned","quote":"..."}\n\n` +
    `抽取原则：\n` +
    `- 只抽取正文明确出现或强烈暗示、后续连续性有价值的事实；不要总结文学风格。\n` +
    `- 人物、别名、关键能力/身份/物件状态、时间线事件、关系变化、伏笔都可以抽。\n` +
    `- 不确定目标实体时优先产 entity；不要凭空补不存在的名字。\n` +
    `- 所有事实必须能由 quote 支撑。\n\n` +
    `章节锚点：${input.location.kind}:${input.location.id as string}\n` +
    `章节正文：\n${input.text}`;
}

export class FactExtractor {
  constructor(private readonly resolver: FactExtractorModelResolver) {}

  async extract(input: ExtractionInput, options: FactExtractionRunOptions = {}): Promise<FactExtractionResult> {
    const adapter = this.resolver.createAdapter(FACT_EXTRACTOR_AGENT_ID, FACT_EXTRACTOR_TIER);
    const prompt = renderFactExtractionPrompt(input) +
      (options.supplement === undefined || options.supplement.trim().length === 0
        ? ''
        : `\n\n作者本次补充要求（仅用于当前任务尝试，不代表确认事实）：\n${options.supplement.trim()}`);
    const modelResult = await adapter.complete({
      messages: [
        {
          role: 'system',
          content: '你只输出合法 JSON。任何思考过程、解释、Markdown 都不得进入最终回答。',
        },
        { role: 'user', content: prompt },
      ],
      options: {
        temperature: 0,
        maxTokens: 4096,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      },
    });
    const parsed = parseExtractionOutput(modelResult.text);
    const result: FactExtractionResult = {
      output: parsed.output,
      diagnostics: {
        ...parsed.diagnostics,
        rawChars: modelResult.text.length,
        finishReason: modelResult.finishReason,
      },
      rawText: modelResult.text,
    };
    logExtraction(input, result, options.logger);

    if (parsed.diagnostics.source === 'none' || parsed.diagnostics.invalidCandidates > 0 || modelResult.finishReason === 'length') {
      const preview = compactForLog(modelResult.text).slice(0, 240);
      const message =
        `[fact-extraction] parse-warning chapterId=${input.location.id as string} ` +
        `source=${parsed.diagnostics.source} invalid=${parsed.diagnostics.invalidCandidates} preview=${preview}`;
      appendOrchestrationLog(message);
      options.logger?.(message);
    }

    return result;
  }
}
