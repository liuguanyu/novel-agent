# layout-skeleton Specification

## Purpose
TBD - created by archiving change electron-shell-ui. Update Purpose after archive.
## Requirements
### Requirement: 双轴布局骨架

界面 MUST 保持左导航轴、中正文轴、右对话轴三区并存，并在三轴主区上方提供可收起的专家流程工作台，呈现当前或最近一次任务的目标与真实执行路径。应用最底部 MUST 提供默认收起的工具抽屉入口；Cmd+K 与既有业务抽屉保持不变。

#### Scenario: 流程与工具承载关系分离
- **WHEN** 应用主界面渲染
- **THEN** 三轴主区上方 MUST 直接可见专家流程工作台
- **AND** Agent / 看板 / 动作三排 MUST 位于独立底部工具抽屉
- **AND** 收起工具抽屉 MUST NOT 隐藏实时流程

#### Scenario: 不扰动三轴主区
- **WHEN** 完成流程工作台布局迁移
- **THEN** 左导航、中正文、右对话的职责与可调整布局 MUST 保持不变
- **AND** Renderer 业务委派边界 MUST 保持不变

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

### Requirement: 事实抽取任务按需出现

事实抽取能力 MUST 保留，但空闲状态 MUST NOT 常驻占据主界面空间。手动发起入口 MUST 保留在底部工具抽屉；任务状态区域只在运行、冲突、失败、完成摘要或中断状态下出现。

#### Scenario: 空闲时隐藏事实抽取区域
- **WHEN** 没有正在处理或待处理的事实抽取任务
- **THEN** 主界面 MUST NOT 显示事实抽取控制区域
- **AND** 用户仍 MUST 能从工具抽屉发起本章抽取或全书回填

#### Scenario: 任务状态需要关注
- **WHEN** 事实抽取正在运行、失败或等待冲突裁决
- **THEN** 主界面 MUST 显示紧凑任务状态与适用的处理动作
- **AND** 冲突裁决内容 MUST 保持完整可操作

#### Scenario: 成功摘要自动退出
- **WHEN** 事实抽取成功完成且无需冲突裁决
- **THEN** 主界面 MUST 短暂显示结果摘要
- **AND** 摘要 MUST 在无需用户操作的情况下自动隐藏

