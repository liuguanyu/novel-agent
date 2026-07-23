/**
 * ConsistencyIssue 的边界校验 schema 与解析 (orchestration-runtime tasks 2.4, 4.1)
 *
 * reviewer 节点的模型输出是非结构化文本，进入状态前 MUST 经 schema 校验转强类型
 * （见 core/model output-validation 约定 + agent-node-contract）。此文件是那道校验点：
 * 从模型文本中抽取 JSON → Zod 校验 → 映射为 core 的 ConsistencyIssue[]（禁 any）。
 *
 * 同一 schema 也用于校验作者 resume 决策里携带的「修改后 bug 列表」（modify 场景），
 * 保证跨 IPC 传入的 unknown 在写回状态前被收窄。
 */

import { z } from 'zod';
import { asNodeId, type NodeKind, type NodeRef } from '../../core/manuscript/node-id.js';
import type {
  ConsistencyIssue,
  DecisionOption,
  IssueSeverity,
} from '../../core/story-bible/index.js';
import { validateWithSchema, type ValidationResult } from '../../core/model/index.js';

const NODE_KIND_VALUES = ['volume', 'chapter', 'scene'] as const satisfies readonly NodeKind[];
const SEVERITY_VALUES = ['critical', 'warning', 'info'] as const satisfies readonly IssueSeverity[];

const nodeRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(NODE_KIND_VALUES),
});

const decisionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

const issueEvidenceSchema = z.object({
  quote: z.string().min(1),
  before: z.string().min(1).optional(),
  after: z.string().min(1).optional(),
});

/**
 * 单个一致性问题的 schema。
 * 关键约束（对齐 story-bible）：anchors 至少 1 个；requiresHumanDecision=true 时 options MUST 非空。
 */
const consistencyIssueSchema = z
  .object({
    type: z.string().min(1),
    severity: z.enum(SEVERITY_VALUES),
    anchors: z.array(nodeRefSchema).min(1),
    description: z.string().min(1),
    suggestedFix: z.string().min(1).optional(),
    evidence: issueEvidenceSchema.optional(),
    requiresHumanDecision: z.boolean(),
    options: z.array(decisionOptionSchema).min(1).optional(),
  })
  .refine((issue) => !issue.requiresHumanDecision || issue.options !== undefined, {
    message: 'requiresHumanDecision=true 时 MUST 附非空 options（系统不代作者选择）',
    path: ['options'],
  });

const consistencyIssueListSchema = z.array(consistencyIssueSchema);

const ISSUE_START_PATTERN = /^\s*(?:\d+[.、)]\s*)?(?:问题\s*)?[：:]?\s*/;
const SEVERITY_PATTERN = /(?:严重|critical|警告|warning|提示|info)/i;
const ISSUE_KEYWORDS = /矛盾|不一致|突兀|缺少|缺乏|未交代|重复|冲突|不合理|问题|应为|改为|修正|建议/;
const META_REASONING_PATTERN = /我们被要求|输出必须|合法JSON|JSON数组|每个元素|如果没发现|先分析|需要检查|检查连续性|内容大致|最终输出|格式|anchors|requiresHumanDecision|severity|description/;
const ISSUE_LABEL_PATTERN = /(命名冲突|状态矛盾|时间线|行为|伏笔|空间|文字|道具|称呼)(?:问题|矛盾|冲突|不一致)?[：:]/;
const MAX_LOOSE_DESCRIPTION_CHARS = 260;
const MAX_LOOSE_ISSUES = 12;
const TYPE_HINTS: ReadonlyArray<{ pattern: RegExp; type: string }> = [
  { pattern: /称呼|命名|名字|别名|naming/i, type: 'naming-conflict' },
  { pattern: /时间|先后|顺序|timeline/i, type: 'timeline-break' },
  { pattern: /性格|动机|行为|ooc/i, type: 'behavior-ooc' },
  { pattern: /伏笔|线索|plot/i, type: 'plot-hook-dangling' },
  { pattern: /道具|物品|状态|来源|出现突兀|矛盾|state/i, type: 'state-contradiction' },
  { pattern: /空间|位置|走位|楼|房间|spatial/i, type: 'spatial-inconsistency' },
];

type ParsedIssue = z.infer<typeof consistencyIssueSchema>;

type JsonIssueParseMode = 'json-array' | 'object-salvage' | 'none';

interface JsonIssueParseResult {
  readonly issues: ReadonlyArray<ConsistencyIssue>;
  readonly mode: JsonIssueParseMode;
  readonly objectCandidates: number;
}

export type ReviewerIssueParseSource = 'final-json-array' | 'final-object-salvage' | 'reasoning-loose' | 'none';

export interface ReviewerIssueParseDiagnostics {
  readonly source: ReviewerIssueParseSource;
  readonly finalObjectCandidates: number;
  readonly finalIssues: number;
  readonly reasoningIssues: number;
}

export interface ReviewerIssueParseResult {
  readonly issues: ReadonlyArray<ConsistencyIssue>;
  readonly diagnostics: ReviewerIssueParseDiagnostics;
}

function isSeverity(value: unknown): value is IssueSeverity {
  return value === 'critical' || value === 'warning' || value === 'info';
}

function normalizeEvidence(input: unknown): unknown {
  // 模型常把 evidence 写成字符串；规范化为 {quote}，避免一条漂移导致整批 issue 丢失。
  if (typeof input === 'string' && input.length > 0) return { quote: input };
  if (typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const quote = record['quote'];
  if (typeof quote !== 'string' || quote.length === 0) return undefined;
  return {
    quote,
    ...(typeof record['before'] === 'string' && record['before'].length > 0
      ? { before: record['before'] }
      : {}),
    ...(typeof record['after'] === 'string' && record['after'].length > 0
      ? { after: record['after'] }
      : {}),
  };
}

function normalizeOptions(input: unknown): unknown {
  if (!Array.isArray(input)) return undefined;
  const options = input
    .map((item) => {
      if (typeof item !== 'object' || item === null) return null;
      const record = item as Record<string, unknown>;
      const id = record['id'];
      const label = record['label'];
      if (typeof id !== 'string' || id.length === 0) return null;
      if (typeof label !== 'string' || label.length === 0) return null;
      return { id, label };
    })
    .filter((item): item is { id: string; label: string } => item !== null);
  return options.length > 0 ? options : undefined;
}

function normalizeAnchors(input: unknown): unknown {
  if (!Array.isArray(input)) return [{ id: 'unknown', kind: 'chapter' }];
  const anchors = input
    .map((item) => {
      if (typeof item !== 'object' || item === null) return null;
      const record = item as Record<string, unknown>;
      const id = record['id'];
      const kind = record['kind'];
      if (typeof id !== 'string' || id.length === 0) return null;
      if (kind !== 'volume' && kind !== 'chapter' && kind !== 'scene') return null;
      return { id, kind };
    })
    .filter((item): item is { id: string; kind: NodeKind } => item !== null);
  return anchors.length > 0 ? anchors : [{ id: 'unknown', kind: 'chapter' }];
}

function normalizeRawIssue(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const record = input as Record<string, unknown>;
  const description = record['description'];
  if (typeof description !== 'string' || description.length === 0) return input;
  const suggestedFix = record['suggestedFix'];
  const requiresHumanDecision = record['requiresHumanDecision'];
  const normalizedOptions = normalizeOptions(record['options']);
  return {
    type: typeof record['type'] === 'string' && record['type'].length > 0
      ? record['type']
      : inferIssueType(description),
    severity: isSeverity(record['severity']) ? record['severity'] : inferSeverity(description),
    anchors: normalizeAnchors(record['anchors']),
    description,
    ...(typeof suggestedFix === 'string' && suggestedFix.length > 0
      ? { suggestedFix }
      : {}),
    ...(normalizeEvidence(record['evidence']) !== undefined
      ? { evidence: normalizeEvidence(record['evidence']) }
      : {}),
    requiresHumanDecision:
      typeof requiresHumanDecision === 'boolean' ? requiresHumanDecision : false,
    ...(normalizedOptions !== undefined ? { options: normalizedOptions } : {}),
  };
}

function parseOneIssue(input: unknown): ConsistencyIssue | null {
  const parsed = consistencyIssueSchema.safeParse(normalizeRawIssue(input));
  if (!parsed.success) return null;
  return toConsistencyIssue(parsed.data);
}

function parseIssueArrayItems(raw: unknown): ReadonlyArray<ConsistencyIssue> {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseOneIssue).filter((issue): issue is ConsistencyIssue => issue !== null);
}

/** 把校验后的普通对象映射为带品牌类型的 core ConsistencyIssue。 */
function toConsistencyIssue(parsed: ParsedIssue): ConsistencyIssue {
  const anchors: NodeRef[] = parsed.anchors.map((a) => ({ id: asNodeId(a.id), kind: a.kind }));
  const options: DecisionOption[] | undefined = parsed.options?.map((o) => ({
    id: o.id,
    label: o.label,
  }));
  const evidence =
    parsed.evidence !== undefined
      ? {
          quote: parsed.evidence.quote,
          ...(parsed.evidence.before !== undefined ? { before: parsed.evidence.before } : {}),
          ...(parsed.evidence.after !== undefined ? { after: parsed.evidence.after } : {}),
        }
      : undefined;
  return {
    type: parsed.type,
    severity: parsed.severity,
    anchors,
    description: parsed.description,
    ...(parsed.suggestedFix !== undefined ? { suggestedFix: parsed.suggestedFix } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
    requiresHumanDecision: parsed.requiresHumanDecision,
    ...(options !== undefined ? { options } : {}),
  };
}

/** 校验一个 unknown 值为 ConsistencyIssue[]（如作者 modify 决策携带的 bug 列表）。 */
export function validateConsistencyIssues(
  input: unknown,
): ValidationResult<ReadonlyArray<ConsistencyIssue>> {
  const result = validateWithSchema(consistencyIssueListSchema, input);
  if (result.ok) return { ok: true, data: result.data.map(toConsistencyIssue) };

  // 容错：模型输出数组中若只有个别元素字段漂移（如 evidence 写成字符串），保留能修复/能校验的项。
  const itemResults = parseIssueArrayItems(input);
  if (itemResults.length > 0) return { ok: true, data: itemResults };
  return result;
}

function inferIssueType(description: string): string {
  const hit = TYPE_HINTS.find((h) => h.pattern.test(description));
  return hit?.type ?? 'other';
}

function inferSeverity(description: string): IssueSeverity {
  if (/严重|critical/i.test(description)) return 'critical';
  if (/提示|info/i.test(description)) return 'info';
  return 'warning';
}

function stripLeadingIssueMarker(line: string): string {
  return line.replace(ISSUE_START_PATTERN, '').replace(SEVERITY_PATTERN, '').trim();
}

function splitLooseIssueCandidates(text: string): ReadonlyArray<string> {
  // reasoning_content 有时没有稳定换行，而是把 “1. ... 2. ... 3. ...” 串在一段里；先按编号切块，再按换行兜底。
  const numbered = text
    .replace(/\r?\n/g, '\n')
    .split(/(?=\n?\s*\d+[.、)]\s*)/)
    .map((part) => stripLeadingIssueMarker(part.replace(/\s+/g, ' ')))
    .filter((part) => part.length > 0);
  if (numbered.length > 1) return numbered;

  return text
    .split(/\r?\n/)
    .map((line) => stripLeadingIssueMarker(line))
    .filter((line) => line.length > 0);
}

function trimLooseDescription(description: string): string {
  const clean = description.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_LOOSE_DESCRIPTION_CHARS
    ? `${clean.slice(0, MAX_LOOSE_DESCRIPTION_CHARS)}……`
    : clean;
}

function extractLabeledIssue(candidate: string): string | null {
  const match = ISSUE_LABEL_PATTERN.exec(candidate);
  if (match === null) return null;
  const start = match.index;
  const tail = candidate.slice(start);
  const sentenceEnd = tail.search(/[。！？]/);
  return trimLooseDescription(sentenceEnd >= 0 ? tail.slice(0, sentenceEnd + 1) : tail);
}

function extractIssueSentences(candidate: string): ReadonlyArray<string> {
  const labeled = extractLabeledIssue(candidate);
  if (labeled !== null && ISSUE_KEYWORDS.test(labeled)) return [labeled];

  return candidate
    .split(/(?<=[。！？])/)
    .map((sentence) => trimLooseDescription(stripLeadingIssueMarker(sentence)))
    .filter((sentence) => sentence.length > 0)
    .filter((sentence) => !META_REASONING_PATTERN.test(sentence))
    .filter((sentence) => ISSUE_KEYWORDS.test(sentence));
}

function parseLooseIssues(text: string): ReadonlyArray<ConsistencyIssue> {
  const descriptions: string[] = [];
  const seen = new Set<string>();
  for (const candidate of splitLooseIssueCandidates(text)) {
    if (META_REASONING_PATTERN.test(candidate) && !ISSUE_LABEL_PATTERN.test(candidate)) continue;
    for (const description of extractIssueSentences(candidate)) {
      if (seen.has(description)) continue;
      seen.add(description);
      descriptions.push(description);
    }
  }

  return descriptions.slice(0, MAX_LOOSE_ISSUES).map((description) => ({
    type: inferIssueType(description),
    severity: inferSeverity(description),
    anchors: [{ id: asNodeId('unknown'), kind: 'chapter' as const }],
    description,
    requiresHumanDecision: false,
  }));
}

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function findCompleteJsonArray(text: string): string | null {
  const source = stripJsonFence(text);
  const start = source.indexOf('[');
  if (start < 0) return null;

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
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function extractArrayLikeText(text: string): string | null {
  const source = stripJsonFence(text);
  const start = source.indexOf('[');
  return start >= 0 ? source.slice(start) : source;
}

function extractCompleteObjectTexts(text: string): ReadonlyArray<string> {
  const source = extractArrayLikeText(text);
  if (source === null) return [];

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

function parseJsonIssueText(text: string): JsonIssueParseResult {
  const arrayText = findCompleteJsonArray(text);
  if (arrayText !== null) {
    try {
      const raw = JSON.parse(arrayText) as unknown;
      const itemResults = parseIssueArrayItems(raw);
      if (itemResults.length > 0) {
        return { issues: itemResults, mode: 'json-array', objectCandidates: itemResults.length };
      }
      const result = validateConsistencyIssues(raw);
      if (result.ok && result.data.length > 0) {
        return { issues: result.data, mode: 'json-array', objectCandidates: result.data.length };
      }
    } catch {
      // Fall through to per-object salvage. A single broken item must not discard previous valid items.
    }
  }

  const objectTexts = extractCompleteObjectTexts(text);
  const issues = objectTexts
    .map((objectText) => {
      try {
        return parseOneIssue(JSON.parse(objectText) as unknown);
      } catch {
        return null;
      }
    })
    .filter((issue): issue is ConsistencyIssue => issue !== null);
  return {
    issues,
    mode: issues.length > 0 ? 'object-salvage' : 'none',
    objectCandidates: objectTexts.length,
  };
}

/**
 * 从模型自由文本中尽力抽取一致性问题。
 * 优先解析 JSON 数组/数组片段；若模型把问题写进自然语言，则启用宽松兜底。
 * 解析失败不抛裸异常穿透图；最多降级为宽松问题列表或空数组。
 */
export function parseConsistencyIssues(text: string): ReadonlyArray<ConsistencyIssue> {
  const jsonIssues = parseJsonIssueText(text);
  if (jsonIssues.issues.length > 0) return jsonIssues.issues;
  return parseLooseIssues(text);
}

/**
 * reviewer 专用解析：final content 只按 JSON/半截 JSON 解析；若 final 无有效问题，再解析 reasoning_content 兜底。
 * 不能把 final 做自然语言抽句，否则破损 JSON 里的 "suggestedFix" 等字段值会被误显示成一个问题。
 * 也不能把 final+reasoning 简单拼接后再按首个 '[' 到末个 ']' 抽取，否则 reasoning 中的示例 JSON 会污染抽取范围。
 */
export function parseReviewerIssuesWithDiagnostics(
  finalText: string,
  reasoningText: string,
): ReviewerIssueParseResult {
  const finalResult = parseJsonIssueText(finalText);
  if (finalResult.issues.length > 0) {
    const source: ReviewerIssueParseSource =
      finalResult.mode === 'json-array' ? 'final-json-array' : 'final-object-salvage';
    return {
      issues: finalResult.issues,
      diagnostics: {
        source,
        finalObjectCandidates: finalResult.objectCandidates,
        finalIssues: finalResult.issues.length,
        reasoningIssues: 0,
      },
    };
  }

  const reasoningIssues = parseLooseIssues(reasoningText);
  return {
    issues: reasoningIssues,
    diagnostics: {
      source: reasoningIssues.length > 0 ? 'reasoning-loose' : 'none',
      finalObjectCandidates: finalResult.objectCandidates,
      finalIssues: 0,
      reasoningIssues: reasoningIssues.length,
    },
  };
}

export function parseReviewerIssues(
  finalText: string,
  reasoningText: string,
): ReadonlyArray<ConsistencyIssue> {
  return parseReviewerIssuesWithDiagnostics(finalText, reasoningText).issues;
}
