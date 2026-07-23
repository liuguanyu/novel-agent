## Context

Electron 外壳是所有后端能力的交互收敛点。产品定位“正文轴 + 对话轴双轴并行”，作者在中间沉浸写作、
在右侧随时对话拉手刹、用 Cmd+K 召唤专家、在底部抽屉看全书体检。本 change 只定义**布局骨架与交互契约**：
哪些区域、各承载什么能力入口、标注如何锚定、进程如何归属。**视觉设计（配色/排版/动效）明确后置**，
不在本 change。严守进程模型：Renderer 只渲染与交互，业务逻辑全部经 IPC 委派后端。不写代码。

## Goals / Non-Goals

**Goals:**
- 定义双轴布局骨架（左导航/中正文/右对话）+ 底部仪表盘抽屉 + Cmd+K 覆盖层，及各区承载的能力入口。
- 定义对话轴手刹契约（映射 interrupt/resume/abort）与命令面板契约（产出统一召唤命令、查阅看板）。
- 定义编辑器标注契约（bug 高亮/diff 视图/hunk 控件）与稳定标识符 + ProseMirror 锚定防漂移。
- 明确 Renderer 无业务逻辑、全部经 IPC。

**Non-Goals:**
- 不做视觉设计（配色、字体、间距、动效、主题）——后续迭代。
- 不重新定义召唤命令/控制语义/diff/总检（各自 change 已定义，此处只承载与呈现）。
- 不编写实现代码。

## Decisions

### D1. 双轴布局骨架
- 界面 MUST 含三个并存区域：左导航轴（章节树 + 事实库 + 素材库入口）、中正文轴（TipTap 编辑器）、
  右对话轴（Chat + 手刹）；底部为可展开的质量仪表盘抽屉；Cmd+K 唤起命令面板覆盖层。
- 各区承载的能力入口 MUST 明确；布局为骨架级（区域与承载关系），MUST NOT 涉及视觉样式细节。

### D2. 对话轴手刹契约
- 右侧常驻 Chat 侧栏 MUST 呈现对话历史（orchestration-state chatHistory 的视图）并提供打断/继续控件。
- 打断映射 human-in-the-loop 的 abort；审批（批准/驳回/修改）与继续映射 interrupt/resume；
  控件动作 MUST 经 IPC control-event 下发，携带 runId。
- 中断/审批弹窗 MUST 呈现后端推送的强类型 payload（如审稿报告 activeBugs），不在 Renderer 二次加工业务数据。

### D3. 命令面板（Cmd+K）
- Cmd+K MUST 唤起命令面板覆盖层，作为 on-demand-summon 的三入口之一，产出**统一召唤命令**
  （agent/scope/anchor/mode/instruction），MUST NOT 自造另一套命令结构。
- 命令面板 MUST 可查阅 architect 维护的看板（时间线轴、并行情节线、核心人设集），看板数据来自后端。

### D4. 编辑器标注契约（锚定防漂移）
- 正文轴基于 TipTap/ProseMirror；bug 高亮、diff 双栏视图、逐 hunk accept/reject 控件 MUST 由其承载。
- 所有标注（高亮/hunk）MUST 以 story-workspace 稳定标识符 + ProseMirror 位置锚定；文档编辑时 MUST 按
  ProseMirror 位置映射修正，MUST NOT 漂移或错位（与 surgical-refactor 的偏移修正一致）。
- accept/reject 仅收集作者意图并经 IPC 上报，实际拼回/diff 计算在后端（surgical-refactor），
  Renderer MUST NOT 执行 diff 计算或正文写入业务逻辑。

### D5. 仪表盘抽屉
- 底部抽屉 MUST 承载 global-audit 的健康度评分与红黄牌问题列表；点击问题 MUST 触发一键跳章
  （经稳定标识符定位，正文轴滚动至对应节点）。

### D6. 三召唤入口收敛
- 三入口——划词气泡（正文轴选区上浮）、Cmd+K 命令面板、侧边栏工具箱——MUST 产出同一种召唤命令；
  它们是入口，命令协议归 on-demand-summon。

### D7. 进程模型
- Renderer MUST 只负责渲染与交互，全部业务（召唤/控制/diff/总检/持久化）经 IPC 委派 Main/utilityProcess。
- Renderer MUST NOT 承载 agent 执行、编排、持久化或 CPU 密集计算。

## Risks / Trade-offs

- **风险：Renderer 越权承载业务逻辑（图省事）。** 缓解：契约明确 Renderer 只渲染 + IPC；评审守此边界。
- **风险：编辑期标注漂移导致高亮/hunk 错位。** 缓解：稳定标识符 + ProseMirror 位置映射，无法映射即失效重算。
- **风险：视觉后置导致骨架与最终设计冲突。** 取舍：骨架只定区域与承载关系，视觉在其上迭代，冲突面可控。
- **风险：命令面板另造命令结构造成分裂。** 缓解：强约束复用 on-demand-summon 统一命令。
