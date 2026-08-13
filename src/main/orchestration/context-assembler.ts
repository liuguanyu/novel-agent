/**
 * 上下文组装器 (orchestration-runtime tasks 6.1, 6.3, 7.1, 7.2)
 *
 * spec: context-assembly——按 agent + scope 装配作用范围内正文、事实库结构化召回（以引用）、
 * 近期 chatHistory；各 agent 声明各自组装策略，统一组装器依声明执行、MUST NOT 为每 agent 硬编码分支，
 * MUST NOT 将整库塞入上下文。
 *
 * 软/硬锚点（historical-fact-retrieval / design D4）：
 *  - 硬锚点（scope=node/selection）：忠实照做，检索只限该锚点范围，MUST NOT 扩散。
 *  - 软提示（对话自然语言章号）：内容/语义召回，作者陈述章号仅作软排序提示，MUST NOT 硬过滤。
 *
 * 事实以引用（FactContextRef 版本指针）进入 contextRefs，本模块只组装「读哪个版本 + 召回哪些条目」，
 * 不把 FactView 整体塞进 NovelState。密集检索（大 getView）可迁移到 utilityProcess。
 */

import type { FactStoreReader } from '../../core/story-bible/index.js';
import type { NovelState, DialogueMessage, ContextRefs } from '../../core/orchestration/index.js';
import type { FactVersionId } from '../../core/story-bible/index.js';
import {
  retrieveFacts,
  type FactRetrievalQuery,
  type RetrievalResult,
} from '../retrieval/fact-retrieval.js';

/** 召唤作用范围（与 SummonTarget.scope 对齐）。 */
export type SummonScope = 'selection' | 'node' | 'document' | 'project';

/**
 * 单个 agent 的组装策略声明（数据驱动，非硬编码分支）。
 * 统一组装器依此声明执行 —— 新增 agent 只需加一条声明，无需改组装器。
 */
export interface AgentAssemblyStrategy {
  /** agent 标识 */
  agentId: string;
  /** 是否需要事实库召回（不需要则不查库、不占上下文） */
  wantsFacts: boolean;
  /** 召回实体 */
  wantsEntities: boolean;
  /** 召回伏笔 */
  wantsPlotHooks: boolean;
  /** 召回时间线事件 */
  wantsTimeline: boolean;
  /** 纳入的近期 chatHistory 条数上限（防状态膨胀） */
  recentDialogueLimit: number;
}

/** 默认策略（未声明的 agent 回退到此，仍不硬编码分支）。 */
export const DEFAULT_ASSEMBLY_STRATEGY: AgentAssemblyStrategy = {
  agentId: '__default__',
  wantsFacts: true,
  wantsEntities: true,
  wantsPlotHooks: true,
  wantsTimeline: true,
  recentDialogueLimit: 12,
};

/**
 * 各 agent 的组装策略登记表（数据驱动，task 6.3）。
 * 统一组装器据此查表执行；不存在则用 DEFAULT_ASSEMBLY_STRATEGY。
 */
export const AGENT_ASSEMBLY_STRATEGIES: ReadonlyMap<string, AgentAssemblyStrategy> = new Map([
  [
    'writer',
    {
      agentId: 'writer',
      wantsFacts: true,
      wantsEntities: true,
      wantsPlotHooks: true,
      wantsTimeline: false,
      recentDialogueLimit: 8,
    },
  ],
  [
    'reviewer',
    {
      agentId: 'reviewer',
      wantsFacts: true,
      wantsEntities: true,
      wantsPlotHooks: true,
      wantsTimeline: true,
      recentDialogueLimit: 6,
    },
  ],
  [
    'fact-checker',
    {
      agentId: 'fact-checker',
      wantsFacts: true,
      wantsEntities: true,
      wantsPlotHooks: true,
      wantsTimeline: true,
      recentDialogueLimit: 6,
    },
  ],
  [
    'scene-generator',
    {
      agentId: 'scene-generator',
      wantsFacts: true,
      wantsEntities: true,
      wantsPlotHooks: true,
      wantsTimeline: false,
      recentDialogueLimit: 8,
    },
  ],
  [
    'plagiarism-checker',
    {
      agentId: 'plagiarism-checker',
      wantsFacts: false,
      wantsEntities: false,
      wantsPlotHooks: false,
      wantsTimeline: false,
      recentDialogueLimit: 6,
    },
  ],
  [
    // editor（重构类）：编辑需保连贯与人物/伏笔/时间线一致，全维召回；近期对话带上 reviewer 反馈。
    'editor',
    {
      agentId: 'editor',
      wantsFacts: true,
      wantsEntities: true,
      wantsPlotHooks: true,
      wantsTimeline: true,
      recentDialogueLimit: 6,
    },
  ],
  [
    // style-editor（重构类）：只打磨文字，只需实体以护角色称呼；不查伏笔/时间线（与文风无关）。
    'style-editor',
    {
      agentId: 'style-editor',
      wantsFacts: true,
      wantsEntities: true,
      wantsPlotHooks: false,
      wantsTimeline: false,
      recentDialogueLimit: 6,
    },
  ],
  [
    // architect（策划类）：结构大纲需看全局，伏笔与时间线全维召回。
    'architect',
    {
      agentId: 'architect',
      wantsFacts: true,
      wantsEntities: true,
      wantsPlotHooks: true,
      wantsTimeline: true,
      recentDialogueLimit: 6,
    },
  ],
  [
    // character-generator（策划类）：侧重实体与关系；不查伏笔与时间线。
    'character-generator',
    {
      agentId: 'character-generator',
      wantsFacts: true,
      wantsEntities: true,
      wantsPlotHooks: false,
      wantsTimeline: false,
      recentDialogueLimit: 6,
    },
  ],
  [
    // worldbuilding（策划类）：侧重实体与地点、组织；不查伏笔与时间线。
    'worldbuilding',
    {
      agentId: 'worldbuilding',
      wantsFacts: true,
      wantsEntities: true,
      wantsPlotHooks: false,
      wantsTimeline: false,
      recentDialogueLimit: 6,
    },
  ],
]);

/** 查某 agent 的组装策略（缺省回退默认，不为每 agent 硬编码分支）。 */
export function strategyFor(agentId: string): AgentAssemblyStrategy {
  return AGENT_ASSEMBLY_STRATEGIES.get(agentId) ?? DEFAULT_ASSEMBLY_STRATEGY;
}

/** 组装请求：agent + scope + 锚点 + 作者软提示。 */
export interface AssemblyRequest {
  /** 目标 agent */
  agentId: string;
  /** 作用范围 */
  scope: SummonScope;
  /** 硬锚点节点 id（scope=node/selection 时存在，检索只限此范围） */
  anchorNodeId?: string;
  /** 软提示：作者对话中自然语言提及的章号节点 id（仅作软排序提示，MUST NOT 硬过滤） */
  softChapterNodeId?: string;
  /** 从指令/对话提取的检索关键词（实体名/伏笔关键词等） */
  keywords?: FactRetrievalQuery;
  /** 由特定工作流提供的附加约束；与事实召回分区呈现。 */
  additionalContext?: string;
}

/** 组装结果：召回条目（含真实 provenance）+ 近期对话 + contextRefs（版本指针）。 */
export interface AssembledContext {
  /** 结构化召回结果（以引用形式带入，非整库） */
  retrieval: RetrievalResult;
  /** 纳入 prompt 的近期对话（按策略截断） */
  recentDialogue: ReadonlyArray<DialogueMessage>;
  /** 事实/素材引用槽（进入 NovelState.contextRefs） */
  contextRefs: ContextRefs;
  /** 本次组装采用的策略（供追溯/调试） */
  strategy: AgentAssemblyStrategy;
  /** 是否硬锚点（scope=node/selection） */
  isHardAnchor: boolean;
  /** 特定工作流附加的独立上下文区块。 */
  additionalContext?: string;
}

/** 硬锚点判定：划词/点章（node/selection）为硬锚点，其余为软范围。 */
export function isHardAnchor(scope: SummonScope): boolean {
  return scope === 'node' || scope === 'selection';
}

/**
 * 统一上下文组装器（依 agent 声明执行）。
 *
 * @param store 事实库读契约（Main 侧 SqliteFactStore）
 * @param state 当前 NovelState（提供 chatHistory）
 * @param request 组装请求（agent + scope + 锚点 + 关键词）
 */
export async function assembleContext(
  store: (Pick<FactStoreReader, 'getView'> & { getLatestVersion: () => Promise<FactVersionId | null> }) | undefined,
  state: NovelState,
  request: AssemblyRequest,
): Promise<AssembledContext> {
  const strategy = strategyFor(request.agentId);
  const hardAnchor = isHardAnchor(request.scope);

  // 近期对话：按策略截断尾部若干条（防状态膨胀）。
  const recentDialogue = state.chatHistory.slice(-strategy.recentDialogueLimit);

  // 事实召回：仅当策略需要且库中有版本时进行；否则返回空集，不占上下文。
  let retrieval: RetrievalResult = { entities: [], plotHooks: [], timelineEvents: [] };
  let factRef: ContextRefs['facts'] = null;

  if (strategy.wantsFacts && store !== undefined) {
    const version = await store.getLatestVersion();
    if (version !== null) {
      const view = await store.getView(version);
      // 按策略裁剪查询维度：未声明想要的类别不查（软/硬锚点均在 query/后处理体现）。
      const query: FactRetrievalQuery = { ...request.keywords };
      const full = retrieveFacts(view, query);
      retrieval = {
        entities: strategy.wantsEntities ? full.entities : [],
        plotHooks: strategy.wantsPlotHooks ? full.plotHooks : [],
        timelineEvents: strategy.wantsTimeline ? full.timelineEvents : [],
      };

      // 硬锚点：检索结果只保留出处落在锚点范围内的命中，MUST NOT 扩散（task 7.1）。
      if (hardAnchor && request.anchorNodeId !== undefined && request.anchorNodeId.length > 0) {
        retrieval = filterToAnchor(retrieval, request.anchorNodeId);
      } else if (request.softChapterNodeId !== undefined && request.softChapterNodeId.length > 0) {
        // 软提示：仅按作者陈述章号软排序（把命中该章号的排前），MUST NOT 硬过滤（task 7.2）。
        retrieval = softSortByChapter(retrieval, request.softChapterNodeId);
      }

      // 事实以引用（版本指针）进入 contextRefs，不塞整库（task 6.1）。
      factRef = { version };
    }
  }

  const contextRefs: ContextRefs = {
    facts: factRef,
    corpus: state.contextRefs.corpus,
  };

  return {
    retrieval,
    recentDialogue,
    contextRefs,
    strategy,
    isHardAnchor: hardAnchor,
    ...(request.additionalContext === undefined ? {} : { additionalContext: request.additionalContext }),
  };
}

/** 硬锚点过滤：只保留出处/埋点落在锚点节点的命中（不扩散到其他章节）。 */
function filterToAnchor(result: RetrievalResult, anchorNodeId: string): RetrievalResult {
  return {
    entities: result.entities.filter((e) =>
      e.provenance.some((p) => (p.location.id as string) === anchorNodeId),
    ),
    plotHooks: result.plotHooks.filter((h) => (h.plantedAt.id as string) === anchorNodeId),
    timelineEvents: result.timelineEvents.filter((ev) =>
      ev.provenance.some((p) => (p.location.id as string) === anchorNodeId),
    ),
  };
}

/** 软排序：命中作者陈述章号的条目排前，其余保留（不过滤）。 */
function softSortByChapter(result: RetrievalResult, chapterNodeId: string): RetrievalResult {
  const rank = <T extends { provenance: ReadonlyArray<{ location: { id: string } }> }>(
    items: ReadonlyArray<T>,
  ): T[] =>
    [...items].sort((a, b) => {
      const aHit = a.provenance.some((p) => (p.location.id as string) === chapterNodeId) ? 0 : 1;
      const bHit = b.provenance.some((p) => (p.location.id as string) === chapterNodeId) ? 0 : 1;
      return aHit - bHit;
    });

  return {
    entities: rank(result.entities),
    plotHooks: [...result.plotHooks].sort((a, b) => {
      const aHit = (a.plantedAt.id as string) === chapterNodeId ? 0 : 1;
      const bHit = (b.plantedAt.id as string) === chapterNodeId ? 0 : 1;
      return aHit - bHit;
    }),
    timelineEvents: rank(result.timelineEvents),
  };
}

/**
 * 把组装结果渲染为紧凑的中文提示块（以引用/摘要形式，MUST NOT 塞整库）。
 * 每条命中带真实出处（章节锚点 id + 引文），供模型核对；空召回时返回空串（不占上下文）。
 * 节点把此块作为一条 system/context 消息注入 prompt。
 */
export function renderAssembledContext(assembled: AssembledContext): string {
  const { retrieval } = assembled;
  const lines: string[] = [];

  if (retrieval.entities.length > 0) {
    lines.push('【相关实体】');
    for (const e of retrieval.entities) {
      const alias = e.aliases.length > 0 ? `（别名：${e.aliases.join('、')}）` : '';
      const src = e.provenance[0];
      const cite = src !== undefined ? ` 出处[${src.location.id as string}]：「${src.quote}」` : '';
      lines.push(`- ${e.canonicalName}${alias} [${e.type}]${cite}`);
    }
  }

  if (retrieval.plotHooks.length > 0) {
    lines.push('【相关伏笔】');
    for (const h of retrieval.plotHooks) {
      lines.push(`- ${h.description}（状态：${h.state}，埋于[${h.plantedAt.id as string}]）`);
    }
  }

  if (retrieval.timelineEvents.length > 0) {
    lines.push('【相关时间线】');
    for (const ev of retrieval.timelineEvents) {
      const src = ev.provenance[0];
      const cite = src !== undefined ? ` 出处[${src.location.id as string}]` : '';
      lines.push(`- (t=${ev.tick}) ${ev.description}${cite}`);
    }
  }

  const sections: string[] = [];
  if (lines.length > 0) {
    const anchorNote = assembled.isHardAnchor
      ? '（以下事实严格限定在作者指定的锚点范围内）'
      : '（以下事实由内容召回得到，章号仅为软提示，请以出处锚点为准）';
    sections.push(`【事实库召回${anchorNote}】\n${lines.join('\n')}`);
  }
  if (assembled.additionalContext !== undefined && assembled.additionalContext.length > 0) {
    sections.push(assembled.additionalContext);
  }
  return sections.join('\n\n');
}
