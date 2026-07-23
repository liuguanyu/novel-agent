/**
 * 事实抽取模型输出解析与校验 (story-bible-extraction I4 tasks 2.1–2.4)
 *
 * 模型输出是非可信文本：必须先解析 JSON、item-level salvage、Zod 校验并转为
 * core/story-bible 的 CandidateFact，方可进入 normalizer/ingest。这里只处理
 * “模型输出 → 强类型候选事实”的边界，不做入库与冲突判定。
 */

import { z } from 'zod';
import { asNodeId, type NodeKind } from '../../core/manuscript/node-id.js';
import type { CandidateFact, ExtractionOutput } from '../../core/story-bible/index.js';

const NODE_KIND_VALUES = ['volume', 'chapter', 'scene'] as const satisfies readonly NodeKind[];
const CANDIDATE_KIND_VALUES = [
  'entity',
  'attribute',
  'alias',
  'timeline-event',
  'relation',
  'plot-hook',
] as const;

type ExtractionParseSource = 'json-object' | 'candidate-salvage' | 'none';

export interface ExtractionParseDiagnostics {
  readonly source: ExtractionParseSource;
  readonly candidateObjects: number;
  readonly validCandidates: number;
  readonly invalidCandidates: number;
}

export interface ExtractionParseResult {
  readonly output: ExtractionOutput;
  readonly diagnostics: ExtractionParseDiagnostics;
}

const nodeRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(NODE_KIND_VALUES),
});

const candidateFactSchema = z.object({
  kind: z.enum(CANDIDATE_KIND_VALUES),
  suggestedAnchor: nodeRefSchema,
  confidence: z.number().min(0).max(1),
  payload: z.unknown(),
});

const extractionOutputSchema = z.object({
  candidates: z.array(candidateFactSchema),
});

type ParsedCandidateFact = z.infer<typeof candidateFactSchema>;

function toCandidateFact(parsed: ParsedCandidateFact): CandidateFact {
  return {
    kind: parsed.kind,
    suggestedAnchor: {
      id: asNodeId(parsed.suggestedAnchor.id),
      kind: parsed.suggestedAnchor.kind,
    },
    confidence: parsed.confidence,
    payload: parsed.payload,
  };
}

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function normalizeRawCandidate(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const record = input as Record<string, unknown>;
  const anchor = record['suggestedAnchor'] ?? record['anchor'] ?? record['location'];
  const confidence = record['confidence'];
  return {
    kind: record['kind'],
    suggestedAnchor: anchor,
    confidence: typeof confidence === 'number' ? confidence : 0.7,
    payload: record['payload'] ?? record,
  };
}

function parseCandidate(input: unknown): CandidateFact | null {
  const parsed = candidateFactSchema.safeParse(normalizeRawCandidate(input));
  if (!parsed.success) return null;
  return toCandidateFact(parsed.data);
}

function parseCandidateArray(input: unknown): ReadonlyArray<CandidateFact> {
  if (!Array.isArray(input)) return [];
  return input.map(parseCandidate).filter((candidate): candidate is CandidateFact => candidate !== null);
}

function findFirstCompleteJsonValue(text: string): string | null {
  const source = stripJsonFence(text);
  const objectStart = source.indexOf('{');
  const arrayStart = source.indexOf('[');
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const opener = source[start];
  const closer = opener === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === opener) depth += 1;
    if (char === closer) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function sliceCandidatesArrayLike(text: string): string {
  const source = stripJsonFence(text);
  const candidatesIndex = source.indexOf('"candidates"');
  if (candidatesIndex >= 0) {
    const arrayStart = source.indexOf('[', candidatesIndex);
    if (arrayStart >= 0) return source.slice(arrayStart);
  }
  const firstArray = source.indexOf('[');
  return firstArray >= 0 ? source.slice(firstArray) : source;
}

function extractCompleteObjectTexts(text: string): ReadonlyArray<string> {
  const source = sliceCandidatesArrayLike(text);
  const objects: string[] = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      if (depth === 0) objectStart = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        objects.push(source.slice(objectStart, index + 1));
        objectStart = -1;
      }
    }
  }
  return objects;
}

function parseCompleteJsonObject(text: string): ReadonlyArray<CandidateFact> | null {
  const jsonText = findFirstCompleteJsonValue(text);
  if (jsonText === null) return null;
  try {
    const raw = JSON.parse(jsonText) as unknown;
    const outputParsed = extractionOutputSchema.safeParse(raw);
    if (outputParsed.success) return outputParsed.data.candidates.map(toCandidateFact);
    if (typeof raw === 'object' && raw !== null) {
      const record = raw as Record<string, unknown>;
      const candidates = parseCandidateArray(record['candidates']);
      if (candidates.length > 0) return candidates;
    }
    const candidates = parseCandidateArray(raw);
    return candidates.length > 0 ? candidates : null;
  } catch {
    return null;
  }
}

/** 解析模型输出为强类型 ExtractionOutput，并返回诊断信息。 */
export function parseExtractionOutput(text: string): ExtractionParseResult {
  const complete = parseCompleteJsonObject(text);
  if (complete !== null) {
    return {
      output: { candidates: complete },
      diagnostics: {
        source: 'json-object',
        candidateObjects: complete.length,
        validCandidates: complete.length,
        invalidCandidates: 0,
      },
    };
  }

  const objectTexts = extractCompleteObjectTexts(text);
  const candidates = objectTexts
    .map((objectText) => {
      try {
        return parseCandidate(JSON.parse(objectText) as unknown);
      } catch {
        return null;
      }
    })
    .filter((candidate): candidate is CandidateFact => candidate !== null);

  return {
    output: { candidates },
    diagnostics: {
      source: candidates.length > 0 ? 'candidate-salvage' : 'none',
      candidateObjects: objectTexts.length,
      validCandidates: candidates.length,
      invalidCandidates: objectTexts.length - candidates.length,
    },
  };
}
