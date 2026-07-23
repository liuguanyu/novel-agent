## MODIFIED Requirements

### Requirement: React 三轴外壳落地
Renderer MUST 用 React 落地左导航轴、中正文轴、右对话轴三区并存的可运行外壳，含底部仪表盘抽屉与 Cmd+K 覆盖层，且严守 Renderer 无业务逻辑边界。事实抽取 UI MUST 只收集作者意图并展示后端控制事件，不得在 Renderer 直接读文件、调用 LLM 或写事实库。

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
- **WHEN** 用户触发召唤/控制/跳章/审批/事实抽取等操作
- **THEN** Renderer MUST 仅收集意图并经 IPC 桥上报
- **AND** MUST NOT 在 Renderer 执行 agent 编排、持久化、diff 计算、事实抽取或正文写入

#### Scenario: 事实抽取入口与状态展示
- **WHEN** 作者选中某章节
- **THEN** Renderer SHOULD 提供“抽取本章事实”入口，并通过 `extract-facts` 命令上报选中章节 id
- **AND** Renderer SHOULD 提供“补抽全书事实”入口，并通过 `backfill-facts` 命令上报
- **AND** Renderer MUST 通过 control-event 展示抽取开始、完成、失败、章节进度、分块数、自动入库数、冲突数与跳过数
- **AND** Renderer MUST NOT 直接读取章节文件、调用模型或写入事实库

### Requirement: 对话轴手刹交互落地
右对话轴 MUST 呈现对话历史与打断/继续/审批控件，用户操作经 electron-shell-ui 的 toControlCommand 映射为控制命令并经桥上报。事实抽取冲突也 MUST 复用该控制通道回传作者裁决。

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

#### Scenario: 事实抽取冲突裁决
- **WHEN** 后端因事实抽取冲突推送 `interrupt-raised`
- **THEN** Renderer SHOULD 呈现冲突 issue 的描述、证据与可选决策项
- **AND** 作者选择后 MUST 经 `resume-run` 回传 `correct.optionId` 或 `reject`
- **AND** Renderer MUST NOT 替作者默认选择任何冲突选项

#### Scenario: 展示 LLM 思考过程
- **WHEN** 对话回复来自推理型模型、携带 reasoning 旁路
- **THEN** 对话轴 MAY 以可折叠方式展示思考过程
- **AND** 正文区 MUST 只显示 content，MUST NOT 将 reasoning 混入正文
