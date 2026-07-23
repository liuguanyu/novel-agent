/**
 * 长章节抽取分块 (story-bible-extraction I4 task 7.2)
 *
 * 分块只改变送入模型的正文片段，不改变章级 NodeRef；候选事实仍以原章节锚点
 * 与原文 quote 回溯。运行时会先收集所有分块的已校验候选，再统一 normalizer/ingest，
 * 避免半章写入。
 */

import type { ExtractionInput } from '../../core/story-bible/index.js';

export const DEFAULT_EXTRACTION_CHUNK_CHARS = 12_000;

function splitParagraphs(text: string, maxChars: number): ReadonlyArray<string> {
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);
  return paragraphs.flatMap((paragraph) => {
    if (paragraph.length <= maxChars) return [paragraph];
    const pieces: string[] = [];
    for (let index = 0; index < paragraph.length; index += maxChars) {
      pieces.push(paragraph.slice(index, index + maxChars));
    }
    return pieces;
  });
}

/**
 * 将长正文切成不超过 maxChars 的抽取输入；每块保留同一个章/场景 location。
 */
export function chunkExtractionInput(
  input: ExtractionInput,
  maxChars: number = DEFAULT_EXTRACTION_CHUNK_CHARS,
): ReadonlyArray<ExtractionInput> {
  if (maxChars <= 0) throw new Error('maxChars must be positive');
  if (input.text.length <= maxChars) return [input];

  const chunks: ExtractionInput[] = [];
  let current = '';
  for (const paragraph of splitParagraphs(input.text, maxChars)) {
    const next = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current.length > 0) chunks.push({ location: input.location, text: current });
    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }
    for (let index = 0; index < paragraph.length; index += maxChars) {
      chunks.push({ location: input.location, text: paragraph.slice(index, index + maxChars) });
    }
    current = '';
  }
  if (current.length > 0) chunks.push({ location: input.location, text: current });
  return chunks.length > 0 ? chunks : [input];
}
