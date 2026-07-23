## ADDED Requirements

### Requirement: React 三轴外壳落地
Renderer MUST 用 React 落地左导航轴、中正文轴、右对话轴三区并存的可运行外壳，含底部仪表盘抽屉与 Cmd+K 覆盖层，且严守 Renderer 无业务逻辑边界。

#### Scenario: 三轴外壳渲染
- **WHEN** 应用启动、Renderer 挂载
- **THEN** 界面 MUST 以 React 渲染左导航轴、中正文轴、右对话轴三区并存
- **AND** MUST 含底部可展开的质量仪表盘抽屉与 Cmd+K 命令面板覆盖层
- **AND** 各区承载的能力入口 MUST 依 electron-shell-ui 的 layout 契约（AXIS_CAPABILITIES）呈现
- **AND** 样式 MUST 用 Tailwind CSS 仅保证结构可用（分区/滚动/覆盖层），MUST NOT 做视觉设计

#### Scenario: 正文轴显示真实章节
- **WHEN** 作者在导航轴选中某章
- **THEN** 中正文轴 MUST 经桥向 Main 请求该章真实正文并在 TipTap 中显示
- **AND** MUST NOT 使用 mock/占位文本

#### Scenario: Renderer 不承载业务逻辑
- **WHEN** 用户触发召唤/控制/跳章/审批等操作
- **THEN** Renderer MUST 仅收集意图并经 IPC 桥上报
- **AND** MUST NOT 在 Renderer 执行 agent 编排、持久化、diff 计算或正文写入

### Requirement: 对话轴手刹交互落地
右对话轴 MUST 呈现对话历史与打断/继续/审批控件，用户操作经 electron-shell-ui 的 toControlCommand 映射为控制命令并经桥上报。

#### Scenario: 呈现对话历史
- **WHEN** 对话轴渲染
- **THEN** 其 MUST 呈现 orchestration-state chatHistory 的视图（DialogueMessage 列表）
- **AND** MUST NOT 在 Renderer 二次加工业务数据

#### Scenario: 手刹操作映射并上报
- **WHEN** 用户点击打断/继续/审批（批准/驳回/修改）控件
- **THEN** Renderer MUST 用 electron-shell-ui 的 toControlCommand 映射为 AuthorControlCommand
- **AND** MUST 经 IPC 桥上报并携带 runId，MUST NOT 在 Renderer 直接执行控制

#### Scenario: 审批弹窗呈现强类型 payload
- **WHEN** 后端推送一次 InterruptPayload
- **THEN** 审批弹窗 MUST 原样呈现该强类型 payload（如 review-report 的 activeBugs）
- **AND** MUST NOT 在 Renderer 承载业务处理逻辑

#### Scenario: 展示 LLM 思考过程
- **WHEN** 对话回复来自推理型模型、携带 reasoning 旁路
- **THEN** 对话轴 MAY 以可折叠方式展示思考过程
- **AND** 正文区 MUST 只显示 content，MUST NOT 将 reasoning 混入正文

### Requirement: 命令面板与看板落地
Cmd+K MUST 唤起命令面板覆盖层，产出 on-demand-summon 的统一召唤命令，并可查阅 architect 看板；三入口收敛为同一命令。

#### Scenario: Cmd+K 产出统一命令
- **WHEN** 用户按下 Cmd+K 并发起一次召唤
- **THEN** 系统 MUST 唤起命令面板覆盖层
- **AND** 由其发起的召唤 MUST 产出 on-demand-summon 的统一 SummonCommand，MUST NOT 自造命令结构

#### Scenario: 查阅架构看板
- **WHEN** 用户经命令面板请求查阅看板
- **THEN** 系统 MUST 呈现时间线轴、并行情节线与核心人设集（ArchitectBoardView）
- **AND** 看板数据 MUST 来自后端，Renderer MUST NOT 自行计算

#### Scenario: 三入口收敛
- **WHEN** 划词气泡、Cmd+K、侧栏工具箱任一入口发起召唤
- **THEN** 三入口 MUST 产出同一种统一 SummonCommand

### Requirement: 仪表盘抽屉与一键跳章落地
底部抽屉 MUST 呈现 global-audit 的健康度评分与红黄牌列表，点击问题经 toJumpIntent 触发正文轴一键跳章。

#### Scenario: 呈现体检结果并跳章
- **WHEN** 仪表盘抽屉展开（本波数据可为后端初始空态或已有总检结果）
- **THEN** 其 MUST 呈现 QualityDashboard 的健康度评分与按严重度分级的问题列表
- **AND** 点击问题 MUST 经 electron-shell-ui 的 toJumpIntent 以稳定标识符定位、使正文轴滚动至对应节点

### Requirement: 骨架级样式、视觉后置
本 change 的样式 MUST 仅保证结构可用，MUST NOT 引入视觉设计。

#### Scenario: 仅结构可用
- **WHEN** 落地外壳样式
- **THEN** 样式 MUST 仅保证分区、滚动、覆盖层显隐、可点击态等结构可用性
- **AND** MUST NOT 规定配色/字体/间距/动效/主题（视觉为后续独立迭代）
