/**
 * OpenAI 兼容 provider adapter 实现 (walking-skeleton tasks 1.1–1.4)
 *
 * spec: model-provider-openai-compat——实现 core/model 的 ModelProviderAdapter：
 * stream() 走 SSE 逐 delta 产出正文、complete() 聚合；尊重 AbortSignal；分流 reasoning_content 与 content；
 * 用内置 fetch 不引 SDK；响应经 Zod 校验/收窄，禁 any。
 *
 * 归属说明：provider 适配（鉴权/请求/流式协议封装）属 model-adapter 层职责，fetch 在 Node/浏览器均可用、
 * 进程无关，故实现置于 core/model；实际调用由 Main 编排（LLM 调用属异步 I/O，归 Main，见 conventions §3）。
 */

import { z } from 'zod';
import type {
  ModelAdapter,
  ModelCallInput,
  ModelProviderAdapter,
  ModelResult,
  ProviderAuth,
} from './model-adapter.js';

/** reasoning 增量旁路回调（供对话轴折叠展示；正文 MUST NOT 混入 reasoning）。 */
export type ReasoningSink = (delta: string) => void;

/** 创建 adapter 的额外钩子（reasoning 旁路）。 */
export interface OpenAiCompatOptions {
  /** 思考过程增量回调；不传则丢弃 reasoning。 */
  onReasoning?: ReasoningSink;
}

/** OpenAI 兼容 chat/completions 的非流式响应（仅收窄所需字段，容忍其它）。 */
const completionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.string().nullish(),
            reasoning_content: z.string().nullish(),
          })
          .partial(),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .partial()
    .optional(),
});

/** 流式 chunk（data: {...}）的增量结构。 */
const streamChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            reasoning_content: z.string().nullish(),
          })
          .partial(),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
});

/** provider 结束原因 → 统一 finishReason。 */
function mapFinishReason(raw: string | null | undefined): ModelResult['finishReason'] {
  if (raw === 'length') return 'length';
  return 'stop';
}

interface RequestConfig {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

/** 组装 chat/completions 请求体。 */
function buildBody(input: ModelCallInput, model: string, stream: boolean): string {
  const body: Record<string, unknown> = {
    model,
    messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    stream,
  };
  const opts = input.options;
  if (opts?.temperature !== undefined) body['temperature'] = opts.temperature;
  if (opts?.maxTokens !== undefined) body['max_tokens'] = opts.maxTokens;
  return JSON.stringify(body);
}

function buildHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey !== undefined) headers['Authorization'] = `Bearer ${apiKey}`;
  return headers;
}

/** 判断是否为 abort 触发的错误。 */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * 逐块拆分 SSE 文本为「data: ...」事件行的增量解析器。
 * 处理跨 chunk 边界：保留未完成的尾部行，直到遇到换行。
 */
class SseLineBuffer {
  private buffer = '';

  /** 吞入一段文本，产出其中完整的 data 负载（去掉 `data: ` 前缀，跳过 [DONE] 与空行/注释）。 */
  push(text: string): string[] {
    this.buffer += text;
    const payloads: string[] = [];
    let idx = this.buffer.indexOf('\n');
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line.startsWith('data:')) {
        const data = line.slice('data:'.length).trim();
        if (data.length > 0 && data !== '[DONE]') payloads.push(data);
      }
      idx = this.buffer.indexOf('\n');
    }
    return payloads;
  }
}

/** 一个具体模型的 adapter 实例。 */
class OpenAiCompatAdapter implements ModelAdapter {
  constructor(
    private readonly cfg: RequestConfig,
    private readonly options: OpenAiCompatOptions,
  ) {}

  async complete(input: ModelCallInput): Promise<ModelResult> {
    let response: Response;
    try {
      response = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(this.cfg.apiKey),
        body: buildBody(input, this.cfg.model, false),
        ...(input.options?.signal !== undefined ? { signal: input.options.signal } : {}),
      });
    } catch (err) {
      if (isAbortError(err)) return { text: '', finishReason: 'aborted' };
      throw err;
    }
    if (!response.ok) {
      throw new Error(`Model request failed: HTTP ${response.status} ${await response.text()}`);
    }
    const raw: unknown = await response.json();
    const parsed = completionResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Model response failed schema validation: ${parsed.error.message}`);
    }
    const choice = parsed.data.choices[0];
    if (choice === undefined) throw new Error('Model response has no choices');
    const reasoning = choice.message.reasoning_content;
    if (reasoning !== undefined && reasoning !== null && reasoning.length > 0) {
      this.options.onReasoning?.(reasoning);
    }
    const usage =
      parsed.data.usage?.prompt_tokens !== undefined &&
      parsed.data.usage.completion_tokens !== undefined
        ? {
            promptTokens: parsed.data.usage.prompt_tokens,
            completionTokens: parsed.data.usage.completion_tokens,
          }
        : undefined;
    return {
      text: choice.message.content ?? '',
      finishReason: mapFinishReason(choice.finish_reason),
      ...(usage !== undefined ? { usage } : {}),
    };
  }

  async *stream(input: ModelCallInput): AsyncIterable<string> {
    let response: Response;
    try {
      response = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(this.cfg.apiKey),
        body: buildBody(input, this.cfg.model, true),
        ...(input.options?.signal !== undefined ? { signal: input.options.signal } : {}),
      });
    } catch (err) {
      if (isAbortError(err)) return;
      throw err;
    }
    if (!response.ok) {
      throw new Error(`Model request failed: HTTP ${response.status} ${await response.text()}`);
    }
    const body = response.body;
    if (body === null) throw new Error('Model stream response has no body');

    const reader = body.getReader();
    const decoder = new TextDecoder();
    const lines = new SseLineBuffer();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const payload of lines.push(decoder.decode(value, { stream: true }))) {
          let json: unknown;
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // 跳过非 JSON 心跳/注释
          }
          const parsed = streamChunkSchema.safeParse(json);
          if (!parsed.success) continue;
          const delta = parsed.data.choices[0]?.delta;
          if (delta === undefined) continue;
          const reasoning = delta.reasoning_content;
          if (reasoning !== undefined && reasoning !== null && reasoning.length > 0) {
            this.options.onReasoning?.(reasoning);
          }
          const content = delta.content;
          if (content !== undefined && content !== null && content.length > 0) {
            yield content;
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) return; // 中断即优雅结束
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * 创建 OpenAI 兼容 provider adapter (task 1.1)。
 * providerId 由调用方（Main 配置解析）传入；create(model, auth) 产出具体模型的 ModelAdapter。
 */
export function createOpenAiCompatProvider(
  providerId: string,
  options: OpenAiCompatOptions = {},
): ModelProviderAdapter {
  return {
    providerId,
    create(model: string, auth: ProviderAuth): ModelAdapter {
      const baseUrl = auth.baseUrl?.replace(/\/+$/, '');
      if (baseUrl === undefined || baseUrl.length === 0) {
        throw new Error(`Provider '${providerId}' requires baseUrl`);
      }
      return new OpenAiCompatAdapter({ baseUrl, apiKey: auth.apiKey, model }, options);
    },
  };
}
