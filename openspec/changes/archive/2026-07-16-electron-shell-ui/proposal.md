## Why

前面九个 change 定义了后端的数据支柱、编排、控制面与各类 agent 能力。它们都需要一个**外壳**来承载
作者的交互——但这个外壳必须严格遵守“Renderer 只渲染、业务逻辑在后端”的进程模型，且视觉设计后置。

本 change 定义 Electron 前端的**布局骨架与交互契约**，把散落在各能力里的前端触点收敛为一致的界面结构：

- **双轴布局**：左导航（章节树/事实库/素材库入口）、中正文轴（TipTap 沉浸式编辑）、右对话轴
  （Chat + 手刹），底部质量仪表盘抽屉，Cmd+K 命令面板覆盖层。这落实产品的“正文轴/对话轴双轴并行”。
- **命令面板（Cmd+K）**：召唤三入口之一，唤起全局命令/看板；产出 on-demand-summon 的统一命令。
- **编辑器标注**：TipTap/ProseMirror 承载 bug 高亮、diff 双栏视图、逐 hunk accept/reject 控件，
  且所有标注 MUST 以稳定标识符/ProseMirror 位置锚定，编辑时不漂移。

本 change **只定义布局骨架与交互契约**（哪些区域、承载什么、锚定与进程规则），**明确不含视觉设计**
（配色、字体、间距、动效留到后续视觉迭代）。不写代码。

## What Changes

- 定义 **双轴布局骨架**：左导航轴 / 中正文轴 / 右对话轴 三区并存，底部仪表盘抽屉，Cmd+K 覆盖层；
  各区承载的能力入口 MUST 明确，MUST NOT 在 Renderer 放业务逻辑（仅渲染 + 经 IPC 通信）。
- 定义 **对话轴（手刹）契约**：常驻 Chat 侧栏承载对话历史与打断/继续控件，映射 human-in-the-loop 的
  interrupt/resume/abort；对话历史即 orchestration-state 的 chatHistory 视图。
- 定义 **命令面板（Cmd+K）**：唤起命令/看板，产出 on-demand-summon 统一召唤命令，并可查阅 architect
  维护的时间线/情节线/人设集看板。
- 定义 **编辑器标注契约**：bug 高亮、diff 双栏、逐 hunk accept/reject 由 TipTap/ProseMirror 承载，
  标注 MUST 以稳定标识符 + ProseMirror 位置锚定，文档编辑时按位置映射防漂移。
- 定义 **仪表盘抽屉**：承载 global-audit 的健康度评分与红黄牌列表，点击一键跳章。
- 明确 **视觉设计后置**：本 change 只定骨架与契约，不定配色/排版/动效。

## Capabilities

### New Capabilities
- `layout-skeleton`: 双轴布局 + 导航 + 仪表盘抽屉的区域骨架与进程规则。
- `command-palette`: Cmd+K 命令面板，产出统一召唤命令、查阅看板。
- `editor-annotations`: TipTap/ProseMirror 的 bug 高亮、diff 视图与锚定防漂移。

### Modified Capabilities
<!-- 无。 -->

## Impact

- 依赖 `bootstrap-foundation`（进程模型、IPC 契约）、`on-demand-summon`（命令面板产出召唤命令）、
  `human-in-the-loop`（对话轴手刹映射 interrupt/resume/abort）、`surgical-refactor`（diff 视图与 hunk 控件）、
  `global-audit`（仪表盘数据）、`story-workspace`（导航轴章节树、稳定标识符锚定）、`story-bible`/
  `corpus-library`（导航轴事实/素材入口）、`agent-orchestration`（chatHistory、architect 看板）。
- 是所有前端交互的收敛点；后续视觉设计迭代在此骨架上进行。
- Renderer 只负责渲染与交互，全部业务经 IPC 委派后端；MUST NOT 在 Renderer 承载 agent/编排/持久化逻辑。
