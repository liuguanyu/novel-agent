/**
 * 图标名 → lucide 组件映射 (I8 visual-design + summon-toolbox)
 *
 * core 的 agent-catalog / toolbox-catalog 以字符串名建模图标（core 不依赖 lucide）；
 * 此处把名映射为 lucide 组件。未知名回退兜底组件（Bot），确保呈现层不因未登记图标崩溃。
 */

import {
  PenLine,
  Clapperboard,
  ScanEye,
  SearchCheck,
  Fingerprint,
  FilePen,
  Feather,
  DraftingCompass,
  UserPlus,
  Globe,
  Lightbulb,
  ListTree,
  Microscope,
  LayoutDashboard,
  BookMarked,
  Gauge,
  FileSearch,
  DatabaseZap,
  GitCompare,
  ClipboardCheck,
  Workflow,
  Bot,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Readonly<Record<string, LucideIcon>> = {
  // agent 拟人图标
  PenLine,
  Clapperboard,
  ScanEye,
  SearchCheck,
  Fingerprint,
  FilePen,
  Feather,
  DraftingCompass,
  UserPlus,
  Globe,
  Lightbulb,
  ListTree,
  Microscope,
  // 工具条看板/动作图标
  LayoutDashboard,
  BookMarked,
  Gauge,
  FileSearch,
  DatabaseZap,
  GitCompare,
  ClipboardCheck,
  // 专家工作台中枢图标
  Workflow,
};

/** 据图标名解析 lucide 组件；未知名回退兜底 Bot。 */
export function resolveIcon(iconName: string | undefined): LucideIcon {
  if (iconName === undefined) return Bot;
  return ICON_MAP[iconName] ?? Bot;
}

/** agent 图标解析（语义别名，行为同 resolveIcon）。 */
export const resolveAgentIcon = resolveIcon;
