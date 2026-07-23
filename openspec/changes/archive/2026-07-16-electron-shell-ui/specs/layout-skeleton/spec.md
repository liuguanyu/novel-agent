## ADDED Requirements

### Requirement: 双轴布局骨架
界面 MUST 由左导航轴、中正文轴、右对话轴三区并存，并含底部仪表盘抽屉与 Cmd+K 命令面板覆盖层。

#### Scenario: 三轴并存
- **WHEN** 应用主界面渲染
- **THEN** 界面 MUST 含左导航轴（章节树 + 事实库 + 素材库入口）、中正文轴（TipTap 编辑器）、
  右对话轴（Chat + 手刹）
- **AND** MUST 含底部可展开的质量仪表盘抽屉与 Cmd+K 命令面板覆盖层

#### Scenario: 承载关系明确、不含视觉细节
- **WHEN** 定义各区域
- **THEN** 每个区域承载的能力入口 MUST 明确
- **AND** 本布局 MUST 仅为骨架级（区域与承载关系），MUST NOT 规定配色/字体/间距/动效等视觉细节

### Requirement: 对话轴手刹契约
右侧对话轴 MUST 呈现对话历史与打断/继续控件，映射 human-in-the-loop 的 interrupt/resume/abort。

#### Scenario: 对话历史为状态视图
- **WHEN** 对话轴渲染历史
- **THEN** 其 MUST 呈现 orchestration-state 的 chatHistory 视图
- **AND** MUST NOT 在 Renderer 二次加工业务数据

#### Scenario: 手刹映射控制语义
- **WHEN** 作者点击打断/继续/审批控件
- **THEN** 打断 MUST 映射 abort，审批（批准/驳回/修改）与继续 MUST 映射 interrupt/resume
- **AND** 动作 MUST 经 IPC control-event 下发并携带 runId

#### Scenario: 审批弹窗呈现强类型 payload
- **WHEN** 后端推送一次中断 payload（如审稿报告 activeBugs）
- **THEN** 审批弹窗 MUST 呈现该强类型 payload
- **AND** MUST NOT 在 Renderer 承载业务处理逻辑

### Requirement: 仪表盘抽屉
底部抽屉 MUST 承载 global-audit 的健康度评分与红黄牌列表，并支持点击一键跳章。

#### Scenario: 承载体检结果并跳章
- **WHEN** 仪表盘抽屉展开
- **THEN** 其 MUST 呈现健康度评分与按严重度分级的问题列表
- **AND** 点击问题 MUST 经稳定标识符定位并使正文轴滚动至对应节点

### Requirement: Renderer 无业务逻辑
Renderer MUST 只负责渲染与交互，全部业务经 IPC 委派后端。

#### Scenario: 业务经 IPC 委派
- **WHEN** 前端需要执行召唤/控制/diff/总检/持久化等业务
- **THEN** 其 MUST 经 IPC 委派 Main/utilityProcess
- **AND** Renderer MUST NOT 承载 agent 执行、编排、持久化或 CPU 密集计算
