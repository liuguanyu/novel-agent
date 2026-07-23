## Why

自 walking-skeleton 起，renderer 一直只有「结构可用」的中性灰骨架：`index.css` 是 shadcn neutral token，`.dark` 变体已声明却无任何切换器，`NavAxis`/`ManuscriptAxis` 还在用硬编码 `gray-*`/`blue-*`，字体/排版/动效 token 全缺。作者面对的是一款中文长篇小说 IDE，却没有阅读级中文排版、没有品牌气质、没有明暗主题、章节树也不可折叠。视觉打磨自始被显式后置到 I8（见 `index.css` 顶注与各组件「视觉后置」注释），现为路线图最后一项，需一次收口。

## What Changes

- **设计 token 与主题引擎**：以「宣纸墨色 + 朱砂点缀」替换中性灰，落地暖白浅色 + 深墨深色两套 token；新增纯函数主题解析（core）+ `useTheme` hook（localStorage 持久化 + `prefers-color-scheme` 跟随 + 顶栏三态切换），让 `.dark` 真正生效。
- **中文阅读排版**：正文轴引入衬线阅读字体栈、行高、段距、首行缩进、CJK 标点约束；三轴统一间距节奏。
- **动效与状态反馈**：抽屉/面板过渡、流式光标、加载骨架、红/黄牌强调，全部尊重 `prefers-reduced-motion`。
- **品牌与外壳收口**：应用标识、命令面板/顶栏视觉收口、空状态；全部 10 个专家 agent 配拟人 lucide 图标并在对话轴/命令面板呈现；章节导航卷/章可折叠。

## Impact

- 新增 capability：`visual-design`（主题三态持久与解析 / agent 拟人图标全覆盖 / 章节导航可折叠 / 中文阅读排版 / 动效尊重 reduced-motion / 品牌与 token 一致性）。
- Affected code：`src/core/shell/agent-catalog.ts`（条目加 `icon` 名）、新增 `src/core/shell/theme.ts`（纯函数）、`src/renderer/index.css`、新增 `src/renderer/hooks/useTheme.ts` + `components/ThemeToggle.tsx` + `lib/agent-icons.ts`、`App.tsx`、`NavAxis.tsx`、`ManuscriptAxis.tsx`、`DialogueAxis.tsx`、`CommandPalette.tsx` 及各抽屉的 token 迁移；`src/main/orchestration-smoke.ts` 增视觉契约冒烟。
- 依赖 I10（`AGENT_CATALOG` 已归档）。约束不变：core 无 React/lucide 依赖（icon 为字符串名，renderer 映射组件）；renderer 不碰 DB/LLM/fs。build/lint/tsc/smoke 保持绿。
