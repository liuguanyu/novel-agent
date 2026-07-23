## MODIFIED Requirements

### Requirement: 对话轴手刹交互落地
右对话轴 MUST 呈现对话历史与打断/继续/审批控件，用户操作经 electron-shell-ui 的 toControlCommand 映射为控制命令并经桥上报。事实抽取冲突也 MUST 复用该控制通道回传作者裁决。召唤/对话流因 reviewer 抛出需人工裁决的一致性问题而挂起时（`interrupt-raised`），对话轴 MUST 呈现待裁决问题并允许作者经 `resume-run` 回传决策。

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

#### Scenario: 召唤流冲突挂起时呈现待裁决问题
- **WHEN** 某召唤/对话运行因 reviewer 抛出需人工裁决问题而经 `interrupt-raised` 挂起
- **THEN** 对话轴 MUST 订阅控制事件通道，识别该 runId 的挂起并呈现每条问题的严重度、类型、描述、证据与可选决策项
- **AND** MUST 在挂起未裁决前保持该运行处于等待作者输入的可交互态
- **AND** MUST NOT 替作者默认选择任何决策项

#### Scenario: 召唤流冲突裁决回传
- **WHEN** 作者对挂起的召唤运行选择批准放行、驳回、或从候选项中纠偏
- **THEN** Renderer MUST 经 `resume-run` 回传携带 runId 的 `approve` / `reject` / `correct.optionId` 决策
- **AND** 回传后 MUST 依后端后续的对话流/控制事件更新该运行状态
- **AND** Renderer MUST NOT 直接改写本地一致性问题作为事实来源

#### Scenario: 事实抽取冲突裁决
- **WHEN** 后端因事实抽取冲突推送 `interrupt-raised`
- **THEN** Renderer SHOULD 呈现冲突 issue 的描述、证据与可选决策项
- **AND** 作者选择后 MUST 经 `resume-run` 回传 `correct.optionId` 或 `reject`
- **AND** Renderer MUST NOT 替作者默认选择任何冲突选项

#### Scenario: 展示 LLM 思考过程
- **WHEN** 对话回复来自推理型模型、携带 reasoning 旁路
- **THEN** 对话轴 MAY 以可折叠方式展示思考过程
- **AND** 正文区 MUST 只显示 content，MUST NOT 将 reasoning 混入正文
