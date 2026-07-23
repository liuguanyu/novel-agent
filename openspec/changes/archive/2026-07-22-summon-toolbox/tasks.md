## 1. Specification

- [x] 1.1 summon-toolbox delta：新增 Requirement——常驻三排工具条（Agent 召唤 / 看板查阅 / 动作）/ 与命令面板共用权威目录不漂移 / 需锚点项无选中章节禁用；每条至少一个 `#### Scenario:`。
- [x] 1.2 command-palette delta：新增 Requirement——侧边栏工具箱作为召唤三入口之一，产出同一 `SummonCommand`。
- [x] 1.3 `npx openspec validate summon-toolbox --strict` 通过。

## 2. 工具条目录（core）

- [x] 2.1 新增 `src/core/shell/toolbox-catalog.ts`（纯数据 + 类型，无 React/lucide）：`ToolboxBoardId`/`ToolboxActionId` 判别、`ToolboxItem`（id/label/icon 名/description/requiresAnchor）、`TOOLBOX_BOARD_ITEMS`/`TOOLBOX_ACTION_ITEMS` 稳定列表；由 `core/shell/index.ts` 再导出。
- [x] 2.2 Agent 排复用 `AGENT_CATALOG_ENTRIES`（不重复建模）；目录条目 icon 名与 lucide 映射对齐。

## 3. 图标映射扩展（renderer）

- [x] 3.1 `src/renderer/lib/agent-icons.ts`：图标映射补齐看板/动作图标名（LayoutDashboard/BookMarked/Gauge/FileSearch/DatabaseZap/GitCompare 等），保持未知名回退兜底。

## 4. 抽屉受控化（renderer）

- [x] 4.1 `StoryBibleDrawer.tsx`：加可选 `open?`/`onOpenChange?`；受控时隐藏自带 `SheetTrigger`，不传时保持原自触发行为（向后兼容）。
- [x] 4.2 `DashboardDrawer.tsx`：同上受控化。
- [x] 4.3 `RefactorReviewPanel.tsx`：同上受控化。

## 5. 常驻工具条（renderer）

- [x] 5.1 新增 `src/renderer/components/SummonBar.tsx`：三排布局（Agent/看板/动作），可折叠；Agent 排据 `AGENT_CATALOG_ENTRIES` 渲染拟人图标按钮，点击构造 `SummonRequest` 经 `onSummon` 下发（需锚点且无选中章节时禁用，与命令面板 `buildRequest` 同规则）；看板排/动作排据 `toolbox-catalog` 渲染。
- [x] 5.2 `App.tsx`：挂 `SummonBar` 于顶栏下方；上提三个抽屉的开合态并受控传入；顶栏零散按钮下沉工具条（主题切换留顶栏）；动作排接既有 hook（`useFactExtraction`/`useRefactor`/`useDashboard`）触发口。

## 6. 冒烟契约（core 可测部分）

- [x] 6.1 `src/main/orchestration-smoke.ts`：新增 `smokeToolboxCatalogContracts()`——断言看板/动作目录条目 id 唯一、label/icon 非空；断言 Agent 排复用 `AGENT_CATALOG_ENTRIES` 覆盖全部 10 专家；在 `main()` 调用。

## 7. Validation

- [x] 7.1 Run node TypeScript check（`tsconfig.node.json`）。
- [x] 7.2 Run web TypeScript check（`tsconfig.web.json`）。
- [x] 7.3 Run ESLint。
- [x] 7.4 Run production build（electron-vite build）。
- [x] 7.5 Run orchestration smoke（末行 MUST 为 `=== 完成：全部通过 ===`）。
- [x] 7.6 Run OpenSpec strict validation。
