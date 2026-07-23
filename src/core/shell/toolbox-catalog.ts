/**
 * 常驻工具条目录 (summon-toolbox)
 *
 * spec: summon-toolbox「工具条与命令面板共用权威目录」——工具条看板排/动作排 MUST 源自本统一目录，
 * Agent 排复用 agent-catalog（此处不重复建模）。core 目录 MUST NOT 依赖 React/图标组件库：
 * 图标以名称字符串建模，由 renderer 的 agent-icons 映射为组件。
 *
 * 本文件为类型契约 + 纯数据（无 React、无 lucide、无 I/O、无视觉）。
 */

/** 看板排条目标识（查阅类：打开对应抽屉，不产召唤命令）。 */
export type ToolboxBoardId = 'architect-board' | 'story-bible' | 'quality-dashboard';

/** 动作排条目标识（对当前内容发起后端操作）。 */
export type ToolboxActionId =
  | 'fact-extract-chapter'
  | 'fact-backfill-all'
  | 'refactor-review'
  | 'global-audit';

/** 工具条条目：一个看板/动作入口的 UI 元数据。 */
export interface ToolboxItem<Id extends string> {
  /** 稳定标识（供路由/测试引用，非展示文案）。 */
  readonly id: Id;
  /** 中文名（工具条呈现）。 */
  readonly label: string;
  /** 拟人/功能图标名（lucide 组件名字符串，renderer 映射）。 */
  readonly icon: string;
  /** 一句话说明。 */
  readonly description: string;
  /** 是否要求选中章节锚点（要求则无选中章节时禁用）。 */
  readonly requiresAnchor: boolean;
}

/** 看板排：架构看板 / 事实库 / 质量仪表盘（查阅，不需锚点）。 */
export const TOOLBOX_BOARD_ITEMS: ReadonlyArray<ToolboxItem<ToolboxBoardId>> = [
  {
    id: 'architect-board',
    label: '架构看板',
    icon: 'LayoutDashboard',
    description: '查阅时间线轴 / 并行情节线 / 核心人设集。',
    requiresAnchor: false,
  },
  {
    id: 'story-bible',
    label: '事实库',
    icon: 'BookMarked',
    description: '查阅 Story Bible：时间线 / 人设 / 关系 / 伏笔。',
    requiresAnchor: false,
  },
  {
    id: 'quality-dashboard',
    label: '质量仪表盘',
    icon: 'Gauge',
    description: '查阅全书总检健康分与红黄牌问题。',
    requiresAnchor: false,
  },
] as const;

/** 动作排：事实抽取（当前章）/ 全书回填 / 改写审阅 / 全书总检。 */
export const TOOLBOX_ACTION_ITEMS: ReadonlyArray<ToolboxItem<ToolboxActionId>> = [
  {
    id: 'fact-extract-chapter',
    label: '抽取本章事实',
    icon: 'FileSearch',
    description: '读当前章正文，抽取时间线 / 人设 / 伏笔入库。',
    requiresAnchor: true,
  },
  {
    id: 'fact-backfill-all',
    label: '全书回填事实',
    icon: 'DatabaseZap',
    description: '对全书逐章回填事实库（无需选中章节）。',
    requiresAnchor: false,
  },
  {
    id: 'refactor-review',
    label: '改写审阅',
    icon: 'GitCompare',
    description: '确认原片段与改写片段 → diff → 逐段接受/拒绝拼回。',
    requiresAnchor: true,
  },
  {
    id: 'global-audit',
    label: '全书总检',
    icon: 'ClipboardCheck',
    description: '基于事实骨架运行全书总检，产出健康分与红黄牌。',
    requiresAnchor: false,
  },
] as const;
