## Why

召唤目前只有两个入口：⌘K 命令面板（需记快捷键、盲输）与对话轴自由提问。10 个专家 agent、架构看板/事实库/仪表盘、事实抽取/改写审阅这些能力，作者要么记快捷键、要么在顶栏零散按钮里找。布局契约 `core/shell/layout.ts` 早已把 `sidebar-toolbox`（侧边栏工具箱）列为「召唤三入口」之一（与 ⌘K、划词气泡并称、产出同一 `SummonCommand`），但一直没实现。作者需要一个**常驻可见、点一下即用**的工具区，把召唤/查阅/动作摆在明面上。

## What Changes

- 新增常驻工具条 `SummonBar`（顶栏下方，可折叠），分三排：
  - **Agent 排**：10 个专家拟人图标一字排开，点击=对当前章召唤（需锚点者无选中章节时禁用），与 ⌘K 产出同一 `SummonCommand`。
  - **看板排**：架构看板 / 事实库 / 质量仪表盘，点击打开对应抽屉（查阅、不产命令）。
  - **动作排**：事实抽取（当前章）/ 全书回填 / 改写审阅 / 全书总检，点击对当前内容发起操作。
- core 新增权威「工具条目录」`shell/toolbox-catalog.ts`：看板排/动作排的稳定元数据（id/label/icon 名/描述/是否需锚点），Agent 排复用 `AGENT_CATALOG`。`SummonBar` 与 ⌘K 命令面板**共用同一目录**，保证不漂移。
- 顶栏零散按钮（架构看板/Story Bible/改写审阅/质量仪表盘）下沉到工具条；三个抽屉（`StoryBibleDrawer`/`DashboardDrawer`/`RefactorReviewPanel`）加可选受控 props（`open`/`onOpenChange`），受控时隐藏自带触发钮、由工具条驱动，不传则向后兼容。⌘K 保留。

## Impact

- 新增 capability：`summon-toolbox`（常驻三排工具条：召唤/查阅/动作 + 与命令面板共用权威目录不漂移 + 需锚点项无选中章节禁用）。
- Affected specs：`command-palette`（新增 Requirement：侧边栏工具箱作为召唤三入口之一，产出同一 `SummonCommand`）。
- Affected code：新增 `src/core/shell/toolbox-catalog.ts`、`src/renderer/components/SummonBar.tsx`；改 `App.tsx`（挂 `SummonBar`、上提抽屉开合态）、`StoryBibleDrawer.tsx`/`DashboardDrawer.tsx`/`RefactorReviewPanel.tsx`（受控 props）、`lib/agent-icons.ts`（图标映射扩展看板/动作图标）；`src/main/orchestration-smoke.ts` 增工具条目录冒烟。
- 依赖 I8（`AGENT_CATALOG.icon`、`agent-icons` 已落地）。约束不变：core 无 React/lucide（icon 为字符串名）；renderer 不碰 DB/LLM/fs，全部业务经既有 hook/IPC。build/lint/tsc/smoke 保持绿。
