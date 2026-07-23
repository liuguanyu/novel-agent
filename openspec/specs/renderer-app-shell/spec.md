# renderer-app-shell Specification

## Purpose
TBD - created by archiving change walking-skeleton. Update Purpose after archive.
## Requirements
### Requirement: React 三轴外壳落地
Renderer MUST 用 React 落地左导航轴、中正文轴、右对话轴三区并存的可运行外壳，含底部仪表盘抽屉与 Cmd+K 覆盖层，且严守 Renderer 无业务逻辑边界。Renderer SHOULD 提供 Story Bible 查看入口，用只读 DTO 展示事实库当前态，并 SHOULD 提供确认 inferred/conflicting 事实的受限操作入口。Renderer MAY 提供受限事实编辑、删除与实体合并入口，相关请求 MUST 通过 Main 验证并写入。当事实库因抽取/补库/冲突裁决而产生新版本时，Story Bible 视图 SHOULD 经受限查询桥自动重取只读 DTO，MUST NOT 在 Renderer 侧自行改写事实作为事实来源。

#### Scenario: Story Bible 面板删除/合并事实
- **WHEN** 作者删除 Story Bible 中一条事实或把某实体合并进另一实体
- **THEN** Renderer MUST 经受限桥发送 `delete-story-bible-fact` 或 `merge-story-bible-entities` 命令
- **AND** 成功后 SHOULD 刷新 Story Bible DTO
- **AND** Renderer MUST NOT 自行修改本地事实状态作为事实来源
- **AND** Renderer MUST NOT 发送任意 SQL 或 raw JSON payload

#### Scenario: 事实抽取后自动刷新 Story Bible
- **WHEN** 一次事实抽取/补库运行完成并产生了新的 fact version（`fact-extraction-completed` 携带 `factVersion`）
- **THEN** Renderer SHOULD 经受限查询桥自动重取 Story Bible 只读 DTO
- **AND** Renderer MUST NOT 直接读取事实库、正文文件或调用 LLM
- **AND** 未产生新版本（无入库）时 MAY 不刷新

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

#### Scenario: 手动运行全书总检
- **WHEN** 作者在仪表盘抽屉点击运行全书总检
- **THEN** Renderer MUST 经受限 IPC 桥发送 `run-global-audit` 命令
- **AND** Renderer MUST 展示 started/progress/completed/failed 控制事件
- **AND** Renderer MUST NOT 直接读取事实库、正文文件或调用 LLM

#### Scenario: 中断全书总检
- **WHEN** 总检正在运行且作者点击停止
- **THEN** Renderer MUST 发送既有 `abort-run` 命令
- **AND** 后端 SHOULD 以 global-audit-failed(category=aborted) 结束该运行

### Requirement: 骨架级样式、视觉后置
本 change 的样式 MUST 仅保证结构可用，MUST NOT 引入视觉设计。

#### Scenario: 仅结构可用
- **WHEN** 落地外壳样式
- **THEN** 样式 MUST 仅保证分区、滚动、覆盖层显隐、可点击态等结构可用性
- **AND** MUST NOT 规定配色/字体/间距/动效/主题（视觉为后续独立迭代）

### Requirement: 对话轴标注发言专家 agent
右对话轴 MUST 为每条助手消息标注其发言专家 agent（中文名 + 类别徽标），据权威 agent 目录（agent-catalog）呈现，使作者可区分是审校/写手/结构师等哪一位专家在发言；用户消息 MUST 标注「作者」。当某助手消息的 agent 未知或未在目录登记时，对话轴 MUST 回退呈现通用「助手」，MUST NOT 臆造名称或类别。Renderer MUST NOT 自行维护一份与目录漂移的 agent 名称/类别清单。

#### Scenario: 助手消息标注发言专家
- **WHEN** 一次召唤运行产生助手消息且其目标 agent 在权威目录中登记
- **THEN** 对话轴 MUST 据目录条目呈现该专家的中文名与类别徽标
- **AND** MUST NOT 在 Renderer 侧硬编码或臆造该 agent 的名称/类别

#### Scenario: 用户消息标注作者
- **WHEN** 对话轴渲染一条用户发起的消息
- **THEN** 其 MUST 标注「作者」
- **AND** MUST NOT 为用户消息附加专家类别徽标

#### Scenario: 未知 agent 回退通用助手
- **WHEN** 某助手消息未携带 agent 或其 agent 未在权威目录登记
- **THEN** 对话轴 MUST 回退呈现通用「助手」
- **AND** MUST NOT 臆造名称或类别

