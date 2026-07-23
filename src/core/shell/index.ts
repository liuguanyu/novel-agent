/**
 * electron-shell-ui 统一出口 (Electron 外壳:双轴布局骨架 + 交互契约)
 *
 * 所有后端能力的交互收敛点。产品定位「正文轴 + 对话轴双轴并行」:作者在中间沉浸写作、在右侧随时对话
 * 拉手刹、用 Cmd+K 召唤专家、在底部抽屉看全书体检。本模块只定义**布局骨架与交互契约**（区域/承载/锚定/
 * 进程归属），视觉设计（配色/排版/动效/主题）明确后置、不在此:
 * - layout:三轴区域标识 + 各区能力入口映射 + Renderer 无业务/骨架无视觉的显式标记。
 * - handbrake:对话轴手刹:纯 mapper 把 UI 意图 → control-plane 的 AuthorControlCommand（abort/resume）。
 * - command-palette:Cmd+K → on-demand-summon 统一命令（三入口收敛）+ architect 看板视图。
 * - editor-annotation:bug 高亮/diff 双栏/逐 hunk 控件;稳定标识符 + ProseMirror 锚定防漂移;意图只上报。
 * - dashboard-drawer:底部抽屉承载 global-audit 体检结果 + 一键跳章（稳定标识符定位）。
 *
 * 本模块为类型契约 + 纯函数 helper（无 I/O、无 React、无视觉）。严守进程模型:Renderer 只渲染与交互，
 * 全部业务（召唤/控制/diff/总检/持久化）经 IPC 委派 Main/utilityProcess。
 */

export * from './layout.js';
export * from './handbrake.js';
export * from './command-palette.js';
export * from './agent-catalog.js';
export * from './theme.js';
export * from './toolbox-catalog.js';
export * from './editor-annotation.js';
export * from './dashboard-drawer.js';
