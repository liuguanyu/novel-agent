/**
 * 故事资产提炼器 — 用 LLM 从旧稿大纲中提炼情节线和人物资产 (Roadmap M2)
 *
 * 输入：LegacyOutline（已识别的情节候选 + 章节归属 + 人物名称）
 * 输出：StoryAssetSnapshot（草案态，需作者确认后才转正式）
 *
 * 提炼分两步：
 * 1. 情节线聚合：把散落的情节节点归类为主线/支线，标注目标和阶段
 * 2. 人物提炼：从情节中归纳人物身份、性格、动机、关系和成长弧
 */

import { z } from 'zod';
import type { CapabilityTier, ModelAdapter } from '../../core/model/index.js';
import type { LegacyOutline } from '../../core/legacy-organization/index.js';
import type {
  StoryAssetSnapshot,
  PlotThread,
  PlotThreadStage,
  PlotThreadKind,
  CharacterProfile,
  CharacterRelation,
  CharacterArc,
  Foreshadowing,
  Evidence,
  CredibilityLevel,
} from '../../core/story-asset/index.js';

const EXTRACTOR_AGENT_ID = 'architect';
const EXTRACTOR_TIER: CapabilityTier = 'cheap-fast';
const MAX_OUTPUT_TOKENS = 8_192;
const MAX_RETRIES = 2;

export interface AssetExtractorModelResolver {
  createAdapter(agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'>;
}

/* ─── Prompt 构建 ────────────────────────────────────────────── */

export function renderExtractionPrompt(outline: LegacyOutline): string {
  const plotNodes = outline.nodes.filter((n) => n.kind === 'plot-beat');
  const chapterMap = new Map(outline.nodes.filter((n) => n.kind === 'chapter').map((c) => [c.id, c.title]));

  const plotLines = plotNodes.map((plot, index) => {
    const chapterTitle = plot.parentId !== undefined ? (chapterMap.get(plot.parentId) ?? '未知章节') : '未归属';
    const characters = plot.characters.length > 0 ? plot.characters.join('、') : '无';
    const preserved = plot.preserved ? ' [已保留]' : '';
    return `${index + 1}. [id:${plot.id}] 章节「${chapterTitle}」${preserved}\n   标题：${plot.title}\n   摘要：${plot.summary}\n   人物：${characters}`;
  });

  // 收集所有出现过的角色名
  const allCharacters = [...new Set(plotNodes.flatMap((p) => p.characters))];

  return [
    '你是一位资深小说结构分析师。下面是一部旧稿的全书情节列表和人物名单。',
    '请从这些情节中提炼出故事资产，包括情节线、人物档案、人物关系和成长弧。',
    '',
    '## 提炼要求',
    '',
    '### 情节线',
    '- 把散落的情节归类为主线或支线（main/sub）',
    '- 每条情节线有名称、目标和涉及的人物',
    '- 标注情节线阶段：setup/rising/turn/climax/resolution',
    '- 关联 plotNodeIds 必须使用上方给定的 plot id',
    '',
    '### 人物档案',
    '- 为每个出现的人物提炼身份、性格、动机、恐惧、弱点和当前状态',
    '- 合并同一人物的别名',
    '- 标注信息来源是原文明确(explicit)还是合理推断(inferred)',
    '- 如果信息不足，标注为待补充设计(pending-design)',
    '',
    '### 人物关系',
    '- 识别主要人物之间的关系类型：ally/enemy/mentor/lover/family/colleague/rival/other',
    '- 描述关系及其变化',
    '',
    '### 成长弧',
    '- 识别主要人物的成长弧和关键转折点',
    '',
    '### 伏笔',
    '- 识别已埋设的伏笔及其状态：planted/advanced/paid-off',
    '',
    '## 全书情节列表',
    plotLines.length > 0 ? plotLines.join('\n') : '（无情节候选）',
    '',
    '## 人物名单',
    allCharacters.length > 0 ? allCharacters.join('、') : '（无人物）',
    '',
    '## 输出要求',
    '严格输出以下 JSON 格式（不要添加其他文字）：',
    '```json',
    '{"plotThreads":[{"id":"pt-1","name":"情节线名称","kind":"main","goal":"目标","credibility":"explicit","plotNodeIds":["plot-id-1","plot-id-2"],"characterIds":["ch-1"],"stages":[{"kind":"setup","plotNodeIds":["plot-id-1"],"description":"阶段描述"}]}],"characters":[{"id":"ch-1","name":"人物名","aliases":["别名"],"identity":"身份","identityCredibility":"explicit","personality":"性格","personalityCredibility":"inferred","desire":"欲望","goal":"目标","fear":"恐惧","weakness":"弱点","currentStatus":"当前状态","currentStatusCredibility":"inferred","plotThreadIds":["pt-1"]}],"relations":[{"id":"rel-1","fromCharacterId":"ch-1","toCharacterId":"ch-2","kind":"ally","description":"关系描述"}],"arcs":[{"id":"arc-1","characterId":"ch-1","description":"成长弧描述","turningPoints":[{"plotNodeId":"plot-id-1","description":"转折描述"}]}],"foreshadowings":[{"id":"fs-1","description":"伏笔描述","state":"planted","plantedPlotNodeId":"plot-id-1","credibility":"explicit"}]}',
    '```',
  ].join('\n');
}

/* ─── 输出解析 ──────────────────────────────────────────────── */

const credibilityEnum = z.enum(['explicit', 'inferred', 'pending-confirmation', 'pending-design']);

const extractionOutputSchema = z.object({
  plotThreads: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(50),
    kind: z.enum(['main', 'sub']),
    goal: z.string().min(1).max(200),
    credibility: credibilityEnum,
    plotNodeIds: z.array(z.string().min(1)).min(1),
    characterIds: z.array(z.string().min(1)).default([]),
    stages: z.array(z.object({
      kind: z.enum(['setup', 'rising', 'turn', 'climax', 'resolution']),
      plotNodeIds: z.array(z.string().min(1)).default([]),
      description: z.string().min(1).max(200),
    })).default([]),
  })).max(20),
  characters: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(30),
    aliases: z.array(z.string().min(1).max(30)).default([]),
    identity: z.string().max(200).default(''),
    identityCredibility: credibilityEnum.default('pending-design'),
    personality: z.string().max(200).default(''),
    personalityCredibility: credibilityEnum.default('pending-design'),
    desire: z.string().max(200).default(''),
    desireCredibility: credibilityEnum.default('pending-design'),
    goal: z.string().max(200).default(''),
    goalCredibility: credibilityEnum.default('pending-design'),
    fear: z.string().max(200).default(''),
    fearCredibility: credibilityEnum.default('pending-design'),
    weakness: z.string().max(200).default(''),
    weaknessCredibility: credibilityEnum.default('pending-design'),
    currentStatus: z.string().max(200).default(''),
    currentStatusCredibility: credibilityEnum.default('pending-design'),
    plotThreadIds: z.array(z.string().min(1)).default([]),
  })).max(50),
  relations: z.array(z.object({
    id: z.string().min(1),
    fromCharacterId: z.string().min(1),
    toCharacterId: z.string().min(1),
    kind: z.enum(['ally', 'enemy', 'mentor', 'lover', 'family', 'colleague', 'rival', 'other']),
    description: z.string().min(1).max(200),
  })).max(50),
  arcs: z.array(z.object({
    id: z.string().min(1),
    characterId: z.string().min(1),
    description: z.string().min(1).max(300),
    turningPoints: z.array(z.object({
      plotNodeId: z.string().min(1),
      description: z.string().min(1).max(200),
    })).default([]),
  })).max(30),
  foreshadowings: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1).max(200),
    state: z.enum(['planted', 'advanced', 'paid-off', 'abandoned']),
    plantedPlotNodeId: z.string().min(1),
    credibility: credibilityEnum,
  })).max(30),
}).strict();

type RawExtractionOutput = z.infer<typeof extractionOutputSchema>;

function stripJsonFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseExtractionOutput(text: string): RawExtractionOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(text)) as unknown;
  } catch {
    throw new Error('故事资产提炼未返回合法 JSON，请重试');
  }
  const parsed = extractionOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`故事资产提炼格式不完整：${parsed.error.issues[0]?.message ?? '未知格式错误'}`);
  }
  return parsed.data;
}

/* ─── 转换为 StoryAssetSnapshot ──────────────────────────────── */

function toCredibleClaim(value: string, credibility: CredibilityLevel, evidence: ReadonlyArray<Evidence> = []): { value: string; credibility: CredibilityLevel; evidence: ReadonlyArray<Evidence> } {
  return { value: value || '（未提炼）', credibility, evidence };
}

function toPlotThread(raw: RawExtractionOutput['plotThreads'][number]): PlotThread {
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind as PlotThreadKind,
    goal: toCredibleClaim(raw.goal, raw.credibility),
    plotNodeIds: raw.plotNodeIds,
    characterIds: raw.characterIds,
    stages: raw.stages as ReadonlyArray<PlotThreadStage>,
    keyEvents: [],
    status: 'draft',
  };
}

function toCharacter(raw: RawExtractionOutput['characters'][number]): CharacterProfile {
  const empty = toCredibleClaim('', 'pending-design');
  return {
    id: raw.id,
    name: raw.name,
    aliases: raw.aliases,
    identity: toCredibleClaim(raw.identity, raw.identityCredibility),
    appearance: empty,
    abilities: empty,
    personality: toCredibleClaim(raw.personality, raw.personalityCredibility),
    languageStyle: empty,
    desire: toCredibleClaim(raw.desire, raw.desireCredibility),
    goal: toCredibleClaim(raw.goal, raw.goalCredibility),
    fear: toCredibleClaim(raw.fear, raw.fearCredibility),
    weakness: toCredibleClaim(raw.weakness, raw.weaknessCredibility),
    currentStatus: toCredibleClaim(raw.currentStatus, raw.currentStatusCredibility),
    plotThreadIds: raw.plotThreadIds,
    status: 'draft',
  };
}

function toRelation(raw: RawExtractionOutput['relations'][number]): CharacterRelation {
  return {
    id: raw.id,
    fromCharacterId: raw.fromCharacterId,
    toCharacterId: raw.toCharacterId,
    kind: raw.kind,
    description: toCredibleClaim(raw.description, 'inferred'),
    changes: [],
    status: 'draft',
  };
}

function toArc(raw: RawExtractionOutput['arcs'][number]): CharacterArc {
  return {
    id: raw.id,
    characterId: raw.characterId,
    description: raw.description,
    turningPoints: raw.turningPoints,
    status: 'draft',
  };
}

function toForeshadowing(raw: RawExtractionOutput['foreshadowings'][number]): Foreshadowing {
  return {
    id: raw.id,
    description: raw.description,
    state: raw.state,
    plantedPlotNodeId: raw.plantedPlotNodeId,
    advancedPlotNodeIds: [],
    credibility: raw.credibility,
    evidence: [],
  };
}

/* ─── 提炼器 ────────────────────────────────────────────────── */

export class AssetExtractor {
  constructor(private readonly resolver: AssetExtractorModelResolver) {}

  async extract(outline: LegacyOutline): Promise<StoryAssetSnapshot> {
    const adapter = this.resolver.createAdapter(EXTRACTOR_AGENT_ID, EXTRACTOR_TIER);
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await adapter.complete({
        messages: [
          { role: 'system', content: '你只输出合法 JSON，不输出 Markdown、分析过程或额外解释。' },
          { role: 'user', content: renderExtractionPrompt(outline) },
        ],
        options: { temperature: 0.2, maxTokens: MAX_OUTPUT_TOKENS },
      });
      if (result.finishReason === 'length') {
        lastError = new Error('故事资产提炼结果被模型截断，请重试');
        continue;
      }
      try {
        const raw = parseExtractionOutput(result.text);
        const now = new Date().toISOString();
        return {
          id: `snapshot-${Date.now()}`,
          projectId: outline.projectId,
          version: 1,
          createdAt: now,
          updatedAt: now,
          plotThreads: raw.plotThreads.map(toPlotThread),
          characters: raw.characters.map(toCharacter),
          relations: raw.relations.map(toRelation),
          arcs: raw.arcs.map(toArc),
          foreshadowings: raw.foreshadowings.map(toForeshadowing),
          sourceOutlineVersion: outline.version,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }
    }
    throw lastError ?? new Error('故事资产提炼失败，请重试');
  }
}
