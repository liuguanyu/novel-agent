## 1. Specification

- [x] 1.1 visual-design delta：新增 6 条 Requirement——主题三态持久与解析 / agent 拟人图标全覆盖 / 章节导航可折叠 / 中文阅读排版 / 动效尊重 reduced-motion / 品牌与设计 token 一致性；每条至少一个 `#### Scenario:`。
- [x] 1.2 `npx openspec validate visual-design --strict` 通过。

## 2. 设计 token 与主题引擎（A）

- [x] 2.1 `src/renderer/index.css`：以「宣纸墨色 + 朱砂点缀」替换中性灰 token——暖白浅色 `:root` + 深墨深色 `.dark`（`--background/--foreground/--card/--primary/--secondary/--muted/--accent/--destructive/--border/--input/--ring` 全套 oklch）；`--primary`/accent 取朱砂红。
- [x] 2.2 `src/renderer/index.css`：新增字体栈 token（衬线中文阅读体 + 无衬线 UI 体）、排版节奏变量（行高/段距/首行缩进）、动效时长/缓动 token。
- [x] 2.3 新增 `src/core/shell/theme.ts`（纯函数、无 React）：`ThemePreference='light'|'dark'|'system'`、`ResolvedTheme='light'|'dark'`、`THEME_STORAGE_KEY`、`resolveTheme(pref, systemPrefersDark)`、`cycleThemePreference(pref)`（light→dark→system→light）、`THEME_PREFERENCE_LABELS`、`isThemePreference` 守卫；由 `core/shell/index.ts` 再导出。
- [x] 2.4 新增 `src/renderer/hooks/useTheme.ts`：读 `THEME_STORAGE_KEY` → preference；`matchMedia('(prefers-color-scheme: dark)')` + 监听；据 `resolveTheme` `document.documentElement.classList.toggle('dark', …)`；返回 `{preference, resolved, setPreference, cyclePreference}` 并持久化。
- [x] 2.5 新增 `src/renderer/components/ThemeToggle.tsx`：顶栏三态切换（Sun/Moon/Monitor 图标），复用 `useTheme`。
- [x] 2.6 `App.tsx`：顶栏挂 `<ThemeToggle/>`，确保 `useTheme` 在应用挂载即生效。

## 3. agent 拟人图标全覆盖（A/D，显式需求 1）

- [x] 3.1 `src/core/shell/agent-catalog.ts`：`AgentCatalogEntry` 增 `readonly icon: string`（lucide 组件名字符串，core 不依赖 lucide）；补齐全部 10 个专家条目的 icon 名。
- [x] 3.2 新增 `src/renderer/lib/agent-icons.ts`：icon 名字符串 → lucide 组件映射（10 名 + 兜底），无 `any`。
- [x] 3.3 `DialogueAxis.tsx`：助手气泡专家名旁渲染其拟人图标；召唤运行「生成中…」处一并带图标。
- [x] 3.4 `CommandPalette.tsx`：各召唤项前渲染该 agent 的拟人图标。

## 4. 章节导航可折叠（D，显式需求 2）

- [x] 4.1 `NavAxis.tsx`：硬编码 `gray-*`/`blue-*` 迁移为设计 token（`bg-card`/`border-border`/`hover:bg-accent`/选中 `bg-accent text-accent-foreground` 等）。
- [x] 4.2 `NavAxis.tsx`：卷（非叶 `kind!=='chapter'`）节点可折叠——加 Chevron 展开/收起指示与本地展开态（默认展开），点击卷标题切换其子树显隐，章节点仍触发正文加载。

## 5. 中文阅读排版（B）

- [x] 5.1 `ManuscriptAxis.tsx`：硬编码 `bg-white`/`gray-*` 迁移为 token；正文容器套用阅读级中文排版（衬线字体/行高/段距/首行缩进/CJK 标点），保持 TipTap 只读结构。
- [x] 5.2 三轴间距节奏统一（顶栏/导航/正文/对话的 padding 与分隔一致）。

## 6. 动效与状态反馈（C）

- [x] 6.1 抽屉/面板/命令面板过渡与 hover/focus 一致化，红/黄牌与中断态强调；全部动效以 `prefers-reduced-motion` 收敛（CSS `@media` 或 motion-safe），reduce 时禁用非必要动画。

## 7. 品牌与外壳收口（D）

- [x] 7.1 `App.tsx`：顶栏「Novel Agent」纯文字换为品牌标识（图标 + 字），命令面板/顶栏视觉收口；空状态（未选章节等）文案与样式打磨。
- [x] 7.2 剩余抽屉/面板（`ArchitectBoardDrawer`/`DashboardDrawer`/`FactExtractionPanel`/`StoryBibleDrawer`/`RefactorReviewPanel`）残留硬编码色的一致性迁移巡查。

## 8. 冒烟契约（core 可测部分）

- [x] 8.1 `src/main/orchestration-smoke.ts`：新增 `smokeVisualDesignContracts()`（同步 `check`）——断言每个 `AGENT_CATALOG_ENTRIES` 的 `icon` 非空；断言 `resolveTheme` 真值表（light→light / dark→dark / system+prefersDark→dark / system+!prefersDark→light）；断言 `cycleThemePreference` 三态循环；在 `main()` 调用。

## 9. Validation

- [x] 9.1 Run node TypeScript check（`tsconfig.node.json`）。
- [x] 9.2 Run web TypeScript check（`tsconfig.web.json`）。
- [x] 9.3 Run ESLint。
- [x] 9.4 Run production build（electron-vite build）。
- [x] 9.5 Run orchestration smoke（末行 MUST 为 `=== 完成：全部通过 ===`）。
- [x] 9.6 Run OpenSpec strict validation。
