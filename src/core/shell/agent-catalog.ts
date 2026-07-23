/**
 * 权威 agent 召唤目录 (I10 ui-overhaul 子阶段 A：多 agent 召唤目录)
 *
 * spec: command-palette「召唤目录覆盖全部专家 agent」——命令面板召唤项 MUST 由本目录驱动，
 * 覆盖 orchestration 已落地的全部专家节点，MUST NOT 硬编码子集而遗漏已落地 agent。
 *
 * 单一事实源守卫：AGENT_CATALOG 以 `Record<(typeof EXPERT_NODES)[number], AgentCatalogEntry>`
 * 建模，与 graph-topology 的 EXPERT_NODES 编译期绑定——新增/删除专家而漏登记即 TS 报错，
 * 不与图拓扑漂移（见 spec「目录与图拓扑不漂移」）。
 *
 * 本文件为类型契约 + 纯数据 + 纯 helper（无 React、无 I/O、无视觉）。
 */

import { EXPERT_NODES } from '../orchestration/graph-topology.js';
import type { SummonMode, SummonScope } from '../summon/summon-command.js';

/** 专家 agent 标识（与 graph-topology 的专家节点同集）。 */
export type ExpertAgentId = (typeof EXPERT_NODES)[number];

/**
 * agent 类别 (供命令面板分组呈现)。
 * 与 I9 子阶段划分对齐：写作类 / 审校类（只读诊断）/ 重构类（片段改写建议）/ 策划类（产设定蓝图）。
 */
export type AgentCategory = 'writing' | 'review' | 'refactor' | 'planning';

/** 目录条目：一个专家 agent 的 UI 召唤元数据。 */
export interface AgentCatalogEntry {
  /** 专家 agent 标识（= graph-topology NodeName）。 */
  readonly agent: ExpertAgentId;
  /** 中文名（命令面板呈现）。 */
  readonly label: string;
  /** 一句话职责描述。 */
  readonly description: string;
  /** 类别（分组）。 */
  readonly category: AgentCategory;
  /** 默认执行模式（diagnose 只读诊断 / mutate 产出或改写）。 */
  readonly defaultMode: SummonMode;
  /** 默认作用范围（构造召唤命令时取用）。 */
  readonly defaultScope: SummonScope;
  /** 该 agent 是否要求节点锚点（要求则无选中章节时禁用其召唤项）。 */
  readonly requiresAnchor: boolean;
  /**
   * 拟人化图标名 (I8 visual-design)：lucide 组件名字符串。
   * core 不依赖 lucide/React——renderer 的 agent-icons 映射据此名解析组件，未知名回退兜底。
   */
  readonly icon: string;
}

/** 类别中文名（分组标题）。 */
export const AGENT_CATEGORY_LABELS: Readonly<Record<AgentCategory, string>> = {
  writing: '写作',
  review: '审校（只读诊断）',
  refactor: '重构（改写建议）',
  planning: '策划（设定蓝图）',
};

/**
 * 权威 agent 目录：覆盖 orchestration 已落地的全部专家节点。
 * key 集由 `Record<ExpertAgentId, …>` 强制穷尽——与 EXPERT_NODES 同步，遗漏即编译期报错。
 */
export const AGENT_CATALOG: Readonly<Record<ExpertAgentId, AgentCatalogEntry>> = {
  writer: {
    agent: 'writer',
    label: '写手',
    description: '基于指令与上下文续写/改写本章正文。',
    category: 'writing',
    defaultMode: 'mutate',
    defaultScope: 'node',
    requiresAnchor: true,
    icon: 'PenLine',
  },
  'scene-generator': {
    agent: 'scene-generator',
    label: '分场景写手',
    description: '生成单个场景正文，show-don-t-tell、承接相邻场景。',
    category: 'writing',
    defaultMode: 'mutate',
    defaultScope: 'node',
    requiresAnchor: true,
    icon: 'Clapperboard',
  },
  reviewer: {
    agent: 'reviewer',
    label: '审校',
    description: '检查连续性（命名/时间线/行为/伏笔/状态/空间）问题。',
    category: 'review',
    defaultMode: 'diagnose',
    defaultScope: 'node',
    requiresAnchor: true,
    icon: 'ScanEye',
  },
  'fact-checker': {
    agent: 'fact-checker',
    label: '事实核查官',
    description: '对撞事实库核查人物/时间线/世界设定一致性。',
    category: 'review',
    defaultMode: 'diagnose',
    defaultScope: 'node',
    requiresAnchor: true,
    icon: 'SearchCheck',
  },
  'plagiarism-checker': {
    agent: 'plagiarism-checker',
    label: '原创性核查官',
    description: '评估与知名作品的雷同与套路化风险。',
    category: 'review',
    defaultMode: 'diagnose',
    defaultScope: 'node',
    requiresAnchor: true,
    icon: 'Fingerprint',
  },
  editor: {
    agent: 'editor',
    label: '章节编辑',
    description: '对本章做结构/连贯/节奏/人物一致性的改写建议。',
    category: 'refactor',
    defaultMode: 'diagnose',
    defaultScope: 'node',
    requiresAnchor: true,
    icon: 'FilePen',
  },
  'style-editor': {
    agent: 'style-editor',
    label: '文风编辑',
    description: '打磨句式/遣词/语气/节奏，保留叙事声音与情节。',
    category: 'refactor',
    defaultMode: 'diagnose',
    defaultScope: 'node',
    requiresAnchor: true,
    icon: 'Feather',
  },
  architect: {
    agent: 'architect',
    label: '结构师',
    description: '产出章节/场景大纲、情节推进与人物成长里程碑。',
    category: 'planning',
    defaultMode: 'mutate',
    defaultScope: 'document',
    requiresAnchor: false,
    icon: 'DraftingCompass',
  },
  'character-generator': {
    agent: 'character-generator',
    label: '人物设计师',
    description: '产出人物档案（背景/动机/性格/关系/口吻）。',
    category: 'planning',
    defaultMode: 'mutate',
    defaultScope: 'document',
    requiresAnchor: false,
    icon: 'UserPlus',
  },
  worldbuilding: {
    agent: 'worldbuilding',
    label: '世界观设定师',
    description: '产出世界设定（地理/文化/历史/规则/组织）。',
    category: 'planning',
    defaultMode: 'mutate',
    defaultScope: 'document',
    requiresAnchor: false,
    icon: 'Globe',
  },
  'concept-generator': {
    agent: 'concept-generator',
    label: '立意策划师',
    description: '产书籍立意（标题/一句话故事内核/主题/目标读者/独特卖点）。',
    category: 'planning',
    defaultMode: 'mutate',
    defaultScope: 'document',
    requiresAnchor: false,
    icon: 'Lightbulb',
  },
  'scene-outliner': {
    agent: 'scene-outliner',
    label: '分场大纲师',
    description: '在章内产 3–5 个场景的分场大纲（目的/冲突/节拍/氛围/过场）。',
    category: 'planning',
    defaultMode: 'mutate',
    defaultScope: 'node',
    requiresAnchor: true,
    icon: 'ListTree',
  },
  researcher: {
    agent: 'researcher',
    label: '资料研究员',
    description: '为题材做背景资料研究（史实/技术细节/可用角度），提升真实感。',
    category: 'planning',
    defaultMode: 'mutate',
    defaultScope: 'document',
    requiresAnchor: false,
    icon: 'Microscope',
  },
};

/** 目录条目按 EXPERT_NODES 顺序的稳定列表（供 UI 遍历）。 */
export const AGENT_CATALOG_ENTRIES: ReadonlyArray<AgentCatalogEntry> = EXPERT_NODES.map(
  (id) => AGENT_CATALOG[id],
);

/** 类别呈现顺序。 */
export const AGENT_CATEGORY_ORDER: ReadonlyArray<AgentCategory> = [
  'writing',
  'review',
  'refactor',
  'planning',
];

/** 取某类别下的目录条目（保持 EXPERT_NODES 顺序）。纯函数。 */
export function agentsByCategory(category: AgentCategory): ReadonlyArray<AgentCatalogEntry> {
  return AGENT_CATALOG_ENTRIES.filter((entry) => entry.category === category);
}

/**
 * 对话轴自由提问的默认诊断 agent (I10-A)：目录中首个只读诊断类专家。
 * 取代此前写死的 `writer`——自由提问语义是"只读诊断当前章"，默认应是审校而非写手。
 */
export const DEFAULT_DIAGNOSE_AGENT: ExpertAgentId = 'reviewer';

/**
 * 据 agent 标识安全解析目录条目 (I10-B)：呈现层（对话轴）拿到的是宽松 `string`，
 * 未登记/未知返回 undefined，避免在 renderer 侧对 `AGENT_CATALOG` 做不安全下标。纯函数。
 */
export function resolveAgentEntry(agent: string): AgentCatalogEntry | undefined {
  return AGENT_CATALOG_ENTRIES.find((entry) => entry.agent === agent);
}

export type AgentMentionResolution =
  | { readonly kind: 'none'; readonly instruction: string }
  | { readonly kind: 'resolved'; readonly entry: AgentCatalogEntry; readonly instruction: string }
  | { readonly kind: 'unknown'; readonly mention: string; readonly instruction: string };

/**
 * 解析对话开头的专家 mention。支持 `@中文名` 与 `@agent-id`；mention 后可接空格或中文/英文标点。
 * 只解析开头，避免把正文中的普通 @ 文本误当路由命令。
 */
export function resolveAgentMention(input: string): AgentMentionResolution {
  const trimmed = input.trim();
  if (!trimmed.startsWith('@')) return { kind: 'none', instruction: trimmed };

  const mentionBody = trimmed.slice(1);
  const entriesByAliasLength = [...AGENT_CATALOG_ENTRIES].sort(
    (left, right) => Math.max(right.label.length, right.agent.length) - Math.max(left.label.length, left.agent.length),
  );
  for (const entry of entriesByAliasLength) {
    for (const alias of [entry.label, entry.agent]) {
      if (!mentionBody.startsWith(alias)) continue;
      const boundary = mentionBody.charAt(alias.length);
      if (boundary.length > 0 && !/[\s，,。.!！?？:：]/u.test(boundary)) continue;
      const instruction = mentionBody
        .slice(alias.length)
        .replace(/^[\s，,。.!！?？:：]+/u, '')
        .trim();
      return { kind: 'resolved', entry, instruction };
    }
  }

  const unknown = mentionBody.match(/^([^\s，,。.!！?？:：]+)/u)?.[1] ?? mentionBody;
  return {
    kind: 'unknown',
    mention: unknown,
    instruction: mentionBody.slice(unknown.length).replace(/^[\s，,。.!！?？:：]+/u, '').trim(),
  };
}
