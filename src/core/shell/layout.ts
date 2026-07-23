/**
 * 双轴布局骨架 (electron-shell-ui layout-skeleton tasks 1.1, 1.2, 1.4, 1.5)
 *
 * spec: layout-skeleton——界面 MUST 三区并存（左导航轴 / 中正文轴 / 右对话轴）+ 底部质量仪表盘抽屉
 * + Cmd+K 命令面板覆盖层;各区承载的能力入口 MUST 明确;布局仅骨架级（区域与承载关系），
 * MUST NOT 规定配色/字体/间距/动效等视觉细节（视觉后置，见 design D1、tasks 4.3）。
 * Renderer 只渲染与交互，全部业务经 IPC 委派后端（design D7）。
 *
 * 本文件为类型契约 + 显式契约标记（无 I/O、无视觉、无 React）。仅声明「有哪些区域、各承载什么入口、
 * 进程边界如何」。实际组件/样式属 renderer 实现层（本 change 之 Non-Goal）。
 */

/**
 * 三轴区域标识 (task 1.1)。三区并存，非折叠标签页。
 * - `nav-axis`：左导航轴——章节树 + 事实库 + 素材库入口。
 * - `manuscript-axis`：中正文轴——TipTap 编辑器（沉浸写作 + 标注承载，见 editor-annotation.ts）。
 * - `dialogue-axis`：右对话轴——Chat 历史 + 手刹（见 handbrake.ts）。
 */
export type ShellAxis = 'nav-axis' | 'manuscript-axis' | 'dialogue-axis';

/**
 * 覆盖/抽屉层标识 (task 1.1)：叠加在三轴之上的临时表层。
 * - `dashboard-drawer`：底部可展开的质量仪表盘抽屉（承载体检结果，见 dashboard-drawer.ts）。
 * - `command-palette`：Cmd+K 唤起的命令面板覆盖层（见 command-palette.ts）。
 */
export type ShellOverlay = 'dashboard-drawer' | 'command-palette';

/**
 * 一个区域承载的能力入口 (task 1.2)。骨架级——只声明「这里有什么入口」，不含视觉。
 * 每个入口经 IPC 委派后端（capabilityChannel 指向 shared/ipc 的通道语义），Renderer 不落业务。
 */
export interface CapabilityEntry {
  /** 入口稳定标识（供路由/测试引用，非展示文案） */
  readonly id: string;
  /** 入口承载的能力简述（骨架级说明，非最终文案） */
  readonly summary: string;
}

/**
 * 左导航轴承载的能力入口 (task 1.2 / spec「章节树 + 事实库 + 素材库入口」)。
 * 数据均来自后端（story-workspace / story-bible / corpus），Renderer 仅渲染。
 */
export const NAV_AXIS_ENTRIES: ReadonlyArray<CapabilityEntry> = [
  { id: 'chapter-tree', summary: '章节树:卷/章/场景层级，节点以稳定标识符（NodeRef）引用' },
  { id: 'story-bible', summary: '事实库:时间线/情节线/人设集入口（architect 看板，见 command-palette.ts）' },
  { id: 'corpus-library', summary: '素材库:语料/参考素材入口' },
] as const;

/**
 * 中正文轴承载的能力入口 (task 1.2)。TipTap 编辑器 + 标注承载（bug 高亮 / diff 双栏 / hunk 控件）。
 * 标注锚定与偏移映射见 editor-annotation.ts;划词气泡为召唤三入口之一（见 command-palette.ts）。
 */
export const MANUSCRIPT_AXIS_ENTRIES: ReadonlyArray<CapabilityEntry> = [
  { id: 'tiptap-editor', summary: '正文编辑器:沉浸写作，承载 bug 高亮/diff 双栏/逐 hunk 控件' },
  { id: 'selection-summon-bubble', summary: '划词气泡:选区上浮的召唤入口（产出统一 SummonCommand）' },
] as const;

/**
 * 右对话轴承载的能力入口 (task 1.2 / spec「Chat + 手刹」)。
 * 对话历史为 orchestration novel-state chatHistory 的视图;手刹映射 interrupt/resume/abort（见 handbrake.ts）。
 */
export const DIALOGUE_AXIS_ENTRIES: ReadonlyArray<CapabilityEntry> = [
  { id: 'chat-history', summary: '对话历史:chatHistory 视图（只读呈现，不二次加工）' },
  { id: 'handbrake-controls', summary: '手刹控件:打断/继续/审批，映射 abort/resume/interrupt' },
  { id: 'approval-dialog', summary: '审批弹窗:呈现后端推送的强类型 InterruptPayload' },
] as const;

/** 各轴 → 承载入口的映射表 (task 1.2)。骨架级承载关系，供实现层据此挂载组件。 */
export const AXIS_CAPABILITIES: Readonly<Record<ShellAxis, ReadonlyArray<CapabilityEntry>>> = {
  'nav-axis': NAV_AXIS_ENTRIES,
  'manuscript-axis': MANUSCRIPT_AXIS_ENTRIES,
  'dialogue-axis': DIALOGUE_AXIS_ENTRIES,
} as const;

/**
 * Renderer 无业务逻辑原则 (task 1.5 / spec「Renderer 无业务逻辑」、design D7)。
 * Renderer MUST 只负责渲染与交互;召唤/控制/diff/总检/持久化等全部业务 MUST 经 IPC 委派
 * Main/utilityProcess;Renderer MUST NOT 承载 agent 执行、编排、持久化或 CPU 密集计算。
 * 此常量为该边界的显式契约标记。
 */
export const RENDERER_HAS_NO_BUSINESS_LOGIC = true as const;

/**
 * 骨架级、无视觉原则 (task 1.2 / spec「不含视觉细节」)。
 * 本布局契约仅定义区域与承载关系;配色/字体/间距/动效/主题为后续独立迭代（tasks 4.3），
 * MUST NOT 在此规定。此常量为该边界的显式契约标记。
 */
export const LAYOUT_IS_SKELETON_ONLY = true as const;
