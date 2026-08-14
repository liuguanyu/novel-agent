/**
 * 新版大纲生成器 — 用 LLM 从正式故事资产生成新版大纲 (Roadmap M3)
 *
 * 输入：正式故事资产快照 + 旧稿大纲 + 保留清单 + 作者意图
 * 输出：NewOutline（草案态，需作者确认后才转正式）
 *
 * 关键约束：
 * - 只读取 formal 状态的故事资产（不读 draft/confirmed）
 * - 无 formal 资产时明确拒绝
 * - 记录来源快照 ID 和版本
 */

import { z } from 'zod';
import type { CapabilityTier, ModelAdapter } from '../../core/model/index.js';
import type { LegacyOutline, PreservationManifest } from '../../core/legacy-organization/index.js';
import type { StoryAssetSnapshot } from '../../core/story-asset/index.js';
import {
  type NewOutline,
  type NewOutlineNode,
  type NewOutlineNodeKind,
  type SourceRelation,
} from '../../core/new-outline/index.js';

const GENERATOR_AGENT_ID = 'architect';
const GENERATOR_TIER: CapabilityTier = 'cheap-fast';
const MAX_OUTPUT_TOKENS = 8_192;
const MAX_RETRIES = 2;

export interface OutlineGeneratorModelResolver {
  createAdapter(agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'>;
}

/* ─── Prompt 构建 ────────────────────────────────────────────── */

export function renderGenerationPrompt(
  formalAssets: StoryAssetSnapshot,
  legacyOutline: LegacyOutline | undefined,
  preservations: PreservationManifest | undefined,
  authorIntent: string | undefined,
): string {
  // 情节线
  const plotThreadLines = formalAssets.plotThreads.map((t) => {
    const stageDesc = t.stages.length > 0 ? t.stages.map((s) => `${s.kind}:${s.description}`).join(' → ') : '无阶段';
    return `- [id:${t.id}] ${t.name}（${t.kind}）\n  目标：${t.goal.value}\n  阶段：${stageDesc}\n  涉及人物：${t.characterIds.join('、') || '无'}\n  关联节点：${t.plotNodeIds.join('、')}`;
  });

  // 人物
  const characterLines = formalAssets.characters.map((c) => {
    return `- [id:${c.id}] ${c.name}${c.aliases.length > 0 ? `（${c.aliases.join('、')}）` : ''}\n  身份：${c.identity.value}\n  性格：${c.personality.value}\n  目标：${c.goal.value}\n  恐惧：${c.fear.value}\n  弱点：${c.weakness.value}\n  当前状态：${c.currentStatus.value}`;
  });

  // 关系
  const relationLines = formalAssets.relations.map((r) => {
    return `- [id:${r.id}] ${r.fromCharacterId} → ${r.toCharacterId}（${r.kind}）：${r.description.value}`;
  });

  // 成长弧
  const arcLines = formalAssets.arcs.map((a) => {
    return `- [id:${a.id}] ${a.characterId}：${a.description}`;
  });

  // 伏笔
  const foreshadowingLines = formalAssets.foreshadowings.map((f) => {
    return `- [id:${f.id}] ${f.description}（${f.state}），埋设于 ${f.plantedPlotNodeId}`;
  });

  // 旧稿大纲节点
  const legacyNodeLines = legacyOutline === undefined ? [] : legacyOutline.nodes
    .filter((n) => n.kind === 'plot-beat')
    .map((n) => {
      const preserved = n.preserved ? ' [已保留]' : '';
      return `- [id:${n.id}] ${n.title}${preserved}\n  摘要：${n.summary}\n  人物：${n.characters.join('、') || '无'}`;
    });

  // 保留清单
  const preservedPlotLines = preservations?.plots.map((p) => {
    return `- [id:${p.id}] ${p.title}，关联大纲节点：${p.outlineNodeId}${p.authorNote !== undefined ? `，备注：${p.authorNote}` : ''}`;
  }) ?? [];
  const preservedQuoteLines = preservations?.quotes.map((q) => {
    return `- [id:${q.id}] "${q.text}"（来源：${q.sourceChapterTitle}）${q.outlineNodeId !== undefined ? `，关联大纲节点：${q.outlineNodeId}` : ''}${q.authorNote !== undefined ? `，备注：${q.authorNote}` : ''}`;
  }) ?? [];

  const sections = [
    '你是一位资深小说结构编辑。下面是一部小说的正式故事资产、旧稿大纲和作者保留清单。',
    '请基于这些信息生成一份新版大纲。',
    '',
  ];

  if (authorIntent !== undefined && authorIntent.trim().length > 0) {
    sections.push('## 作者意图', authorIntent.trim(), '');
  }

  sections.push(
    '## 正式故事资产',
    '',
    '### 情节线',
    plotThreadLines.length > 0 ? plotThreadLines.join('\n') : '（无情节线）',
    '',
    '### 人物',
    characterLines.length > 0 ? characterLines.join('\n') : '（无人物）',
    '',
    '### 人物关系',
    relationLines.length > 0 ? relationLines.join('\n') : '（无关系）',
    '',
    '### 成长弧',
    arcLines.length > 0 ? arcLines.join('\n') : '（无成长弧）',
    '',
    '### 伏笔',
    foreshadowingLines.length > 0 ? foreshadowingLines.join('\n') : '（无伏笔）',
    '',
  );

  if (legacyNodeLines.length > 0) {
    sections.push(
      '## 旧稿大纲（供映射参考）',
      legacyNodeLines.join('\n'),
      '',
    );
  }

  if (preservedPlotLines.length > 0 || preservedQuoteLines.length > 0) {
    sections.push('## 作者保留清单');
    if (preservedPlotLines.length > 0) {
      sections.push('### 保留情节', preservedPlotLines.join('\n'));
    }
    if (preservedQuoteLines.length > 0) {
      sections.push('### 保留原文', preservedQuoteLines.join('\n'));
    }
    sections.push('');
  }

  sections.push(
    '## 输出要求',
    '严格输出以下 JSON 格式（不要添加其他文字）：',
    '```json',
    '{"nodes":[{"id":"no-1","parentId":null,"order":0,"kind":"chapter","title":"第一章 标题","summary":"本章摘要","goal":"本章目标","conflict":"核心冲突","outcome":"结果","sourceRelation":"carried-over","sourceNodeIds":["plot-1"],"plotThreadIds":["pt-1"],"characterIds":["ch-1"],"preservedPlotIds":[],"preservedQuoteIds":[]}]}',
    '```',
    '',
    '### 字段说明',
    '- id：新版节点 ID，格式 no-N',
    '- parentId：父节点 ID，根节点为 null',
    '- kind：volume/chapter/arc/plot-beat/scene',
    '- sourceRelation：carried-over（沿用）/adjusted（调整）/merged（合并）/new（新增）/deleted（删除）',
    '- sourceNodeIds：来源旧稿节点 ID 列表（新增时为 []）',
    '- plotThreadIds：使用上方给定的情节线 ID',
    '- characterIds：使用上方给定的人物 ID',
    '- preservedPlotIds：使用上方给定的保留情节 ID',
    '- preservedQuoteIds：使用上方给定的保留原文 ID',
    '',
    '### 生成规则',
    '1. 新版大纲必须覆盖所有正式情节线',
    '2. 保留情节和保留原文必须有承接位置',
    '3. 人物动机和成长弧必须与正式资产一致',
    '4. 伏笔必须有回收或推进计划',
    '5. 节点顺序应有因果递进关系',
  );

  return sections.join('\n');
}

/* ─── 输出解析 ──────────────────────────────────────────────── */

const sourceRelationEnum = z.enum(['carried-over', 'adjusted', 'merged', 'new', 'deleted']);

const generationOutputSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().min(1),
    parentId: z.string().nullable().default(null),
    order: z.number().int().min(0),
    kind: z.enum(['volume', 'chapter', 'arc', 'plot-beat', 'scene']),
    title: z.string().min(1).max(100),
    summary: z.string().max(500).default(''),
    goal: z.string().max(200).default(''),
    conflict: z.string().max(200).default(''),
    outcome: z.string().max(200).default(''),
    sourceRelation: sourceRelationEnum,
    sourceNodeIds: z.array(z.string().min(1)).default([]),
    plotThreadIds: z.array(z.string().min(1)).default([]),
    characterIds: z.array(z.string().min(1)).default([]),
    preservedPlotIds: z.array(z.string().min(1)).default([]),
    preservedQuoteIds: z.array(z.string().min(1)).default([]),
  })).min(1).max(200),
}).strict();

type RawGenerationOutput = z.infer<typeof generationOutputSchema>;

function stripJsonFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseGenerationOutput(text: string): RawGenerationOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(text)) as unknown;
  } catch {
    throw new Error('新版大纲生成未返回合法 JSON，请重试');
  }
  const parsed = generationOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`新版大纲生成格式不完整：${parsed.error.issues[0]?.message ?? '未知格式错误'}`);
  }
  return parsed.data;
}

/* ─── 转换为 NewOutline ──────────────────────────────────────── */

function toNewOutlineNode(raw: RawGenerationOutput['nodes'][number]): NewOutlineNode {
  return {
    id: raw.id,
    parentId: raw.parentId ?? undefined,
    order: raw.order,
    kind: raw.kind as NewOutlineNodeKind,
    title: raw.title,
    summary: raw.summary,
    goal: raw.goal,
    conflict: raw.conflict,
    outcome: raw.outcome,
    sourceRelation: raw.sourceRelation as SourceRelation,
    sourceNodeIds: raw.sourceNodeIds,
    plotThreadIds: raw.plotThreadIds,
    characterIds: raw.characterIds,
    preservedPlotIds: raw.preservedPlotIds,
    preservedQuoteIds: raw.preservedQuoteIds,
    authorNote: undefined,
  };
}

/* ─── 生成器 ────────────────────────────────────────────────── */

export class OutlineGenerator {
  constructor(private readonly resolver: OutlineGeneratorModelResolver) {}

  /**
   * 从正式故事资产生成新版大纲。
   * formalAssets 必须是 formal 状态的快照（由调用方保证）。
   */
  async generate(
    formalAssets: StoryAssetSnapshot,
    legacyOutline: LegacyOutline | undefined,
    preservations: PreservationManifest | undefined,
    authorIntent: string | undefined,
    version: number,
  ): Promise<NewOutline> {
    // 强制约束：只接受 formal 资产
    const allItems = [...formalAssets.plotThreads, ...formalAssets.characters, ...formalAssets.relations, ...formalAssets.arcs, ...formalAssets.foreshadowings];
    if (allItems.some((item) => item.status !== 'formal')) {
      throw new Error('新版大纲生成只接受正式（formal）故事资产，请先发布正式版');
    }

    const adapter = this.resolver.createAdapter(GENERATOR_AGENT_ID, GENERATOR_TIER);
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await adapter.complete({
        messages: [
          { role: 'system', content: '你只输出合法 JSON，不输出 Markdown、分析过程或额外解释。' },
          { role: 'user', content: renderGenerationPrompt(formalAssets, legacyOutline, preservations, authorIntent) },
        ],
        options: { temperature: 0.3, maxTokens: MAX_OUTPUT_TOKENS },
      });
      if (result.finishReason === 'length') {
        lastError = new Error('新版大纲生成结果被模型截断，请重试');
        continue;
      }
      try {
        const raw = parseGenerationOutput(result.text);
        const now = new Date().toISOString();
        return {
          id: `outline-${Date.now()}`,
          projectId: formalAssets.projectId,
          version,
          createdAt: now,
          updatedAt: now,
          sourceSnapshotId: formalAssets.id,
          sourceSnapshotVersion: formalAssets.version,
          sourceLegacyOutlineVersion: legacyOutline?.version,
          authorIntent: authorIntent?.trim() || undefined,
          nodes: raw.nodes.map(toNewOutlineNode),
          status: 'draft',
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }
    }
    throw lastError ?? new Error('新版大纲生成失败，请重试');
  }
}
