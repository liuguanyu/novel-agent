/**
 * 全书诊断 — 基于旧稿大纲做跨章时间线/人物状态/因果关系检查
 *
 * 读取全部情节候选和章节归属，让模型识别潜在的贯穿问题。
 * 只产出候选问题，不自动保存为正式贯穿问题——由作者审阅后决定。
 */

import { z } from 'zod';
import type { CapabilityTier, ModelAdapter } from '../../core/model/index.js';
import type { LegacyOutline } from '../../core/legacy-organization/index.js';

const DIAGNOSIS_AGENT_ID = 'architect';
const DIAGNOSIS_TIER: CapabilityTier = 'reasoning';
const MAX_PLOT_SUMMARY_CHARS = 200;

export interface BookDiagnosisModelResolver {
  createAdapter(agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'>;
}

export interface BookDiagnosisCandidate {
  readonly kind: 'timeline' | 'character-state' | 'causality' | 'duplicate-event' | 'continuity' | 'other';
  readonly severity: 'low' | 'medium' | 'high' | 'unknown';
  readonly description: string;
  readonly evidence: ReadonlyArray<string>;
  readonly plotNodeIds: ReadonlyArray<string>;
}

const diagnosisOutputSchema = z.object({
  issues: z.array(z.object({
    kind: z.enum(['timeline', 'character-state', 'causality', 'duplicate-event', 'continuity', 'other']),
    severity: z.enum(['low', 'medium', 'high', 'unknown']),
    description: z.string().trim().min(1).max(300),
    evidence: z.array(z.string().trim().min(1).max(200)).max(5).default([]),
    plotNodeIds: z.array(z.string().min(1)).min(2).max(10),
  })).max(20),
}).strict();

function parseOutput(text: string): ReadonlyArray<BookDiagnosisCandidate> {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()) as unknown;
  } catch {
    throw new Error('全书诊断未返回合法 JSON，请重试');
  }
  const parsed = diagnosisOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error('全书诊断返回格式不完整，请重试');
  return parsed.data.issues;
}

export function renderBookDiagnosisPrompt(outline: LegacyOutline): string {
  const plotNodes = outline.nodes.filter((n) => n.kind === 'plot-beat');
  const chapterMap = new Map(outline.nodes.filter((n) => n.kind === 'chapter').map((c) => [c.id, c.title]));

  const plotLines = plotNodes.map((plot, index) => {
    const chapterTitle = plot.parentId !== undefined ? (chapterMap.get(plot.parentId) ?? '未知章节') : '未归属';
    const summary = plot.summary.length > MAX_PLOT_SUMMARY_CHARS
      ? `${plot.summary.slice(0, MAX_PLOT_SUMMARY_CHARS)}…`
      : plot.summary;
    const characters = plot.characters.length > 0 ? `人物：${plot.characters.join('、')}` : '无人物';
    const flags = [
      plot.preserved ? '已保留' : '',
      plot.crossChapter === true ? '跨章' : '',
    ].filter(Boolean).join('、');
    const flagLine = flags.length > 0 ? ` [${flags}]` : '';
    return `${index + 1}. [id:${plot.id}] 章节「${chapterTitle}」${flagLine}\n   标题：${plot.title}\n   摘要：${summary}\n   ${characters}`;
  });

  const existingIssues = (outline.crossChapterIssues ?? []).map((issue, index) =>
    `${index + 1}. [${issue.kind}/${issue.severity}/${issue.status}] ${issue.description}`,
  );

  const sections: string[] = [
    '你是一位资深小说结构诊断专家。下面是一部旧稿的全书情节列表。请检查跨章节的潜在问题。',
    '',
    '## 检查维度',
    '- 时间线：事件的先后顺序、时间跨度是否自洽',
    '- 人物状态：人物在不同情节中的知识、能力、位置和心态是否连贯',
    '- 因果关系：前因后果是否成立，是否有断裂或矛盾',
    '- 重复事件：是否有不同情节实际上是同一事件',
    '- 连续性：物品、地点、称谓等是否前后一致',
    '',
    '## 全书情节列表',
    plotLines.length > 0 ? plotLines.join('\n') : '（无情节候选）',
  ];

  if (existingIssues.length > 0) {
    sections.push('', '## 已记录的贯穿问题（不要重复报告已记录的问题）', existingIssues.join('\n'));
  }

  sections.push(
    '',
    '## 输出要求',
    '只报告你有信心的跨章问题；不要报告单章内部的问题。',
    '每个问题必须关联至少 2 个情节（用 plot id）。',
    '如果全书没有明显的跨章问题，返回空数组。',
    '严格输出以下 JSON 格式（不要添加其他文字）：',
    '```json',
    '{"issues":[{"kind":"timeline","severity":"high","description":"问题描述","evidence":["证据1"],"plotNodeIds":["plot-id-1","plot-id-2"]}]}',
    '```',
  );

  return sections.join('\n');
}

export class BookDiagnoser {
  constructor(private readonly resolver: BookDiagnosisModelResolver) {}

  async diagnose(outline: LegacyOutline): Promise<ReadonlyArray<BookDiagnosisCandidate>> {
    const adapter = this.resolver.createAdapter(DIAGNOSIS_AGENT_ID, DIAGNOSIS_TIER);
    const result = await adapter.complete({
      messages: [{ role: 'user', content: renderBookDiagnosisPrompt(outline) }],
      options: { maxTokens: 4096 },
    });
    return parseOutput(result.text);
  }
}
