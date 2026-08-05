# ipc-contract Specification

## Purpose
TBD - created by archiving change bootstrap-foundation. Update Purpose after archive.
## Requirements
### Requirement: IPC 三通道正交

系统 MUST 提供三条正交的 IPC 通道：正文流（manuscript-stream）、对话流（dialogue-stream）、控制事件（control-event）；三者职责不重叠。事实抽取的进度、完成、失败与冲突裁决事件 MUST 走控制事件通道。全书总检的 started/progress/completed/failed 事件 MUST 走控制事件通道。Story Bible 事实确认的完成/失败事件 MUST 走控制事件通道。Story Bible 事实编辑的完成/失败事件 MUST 走控制事件通道。Story Bible 事实删除与实体合并的完成/失败事件 MUST 走控制事件通道。审校类 agent（reviewer / fact-checker / plagiarism-checker）诊断出的结构化一致性问题清单 MUST 经控制事件通道以强类型 `review-completed` 事件下行，MUST NOT 混入内容流通道。编排图运行的逐节点转移 MUST 经控制事件通道以强类型 `graph-node-activated` 事件（携 `runId`、节点名与 enter/exit 相位）下行，MUST NOT 混入内容流通道。

#### Scenario: Story Bible 删除/合并事件强类型
- **WHEN** Story Bible 事实删除或实体合并完成或失败
- **THEN** 后端 MUST 经 control-event 下发带 runId 的强类型事件
- **AND** 成功事件 MUST 包含操作目标与最新 factVersion

#### Scenario: 审校结果结构化下行
- **WHEN** 审校类 agent 运行结束（正常完成或因需人工裁决而挂起）且产出非空一致性问题清单
- **THEN** 后端 MUST 经 control-event 下发 `review-completed` 事件，携 `runId`、产出 agent 标识与强类型 `ConsistencyIssueDto[]`
- **AND** 该结构化清单 MUST NOT 以裸文本形态经内容流通道传递
- **AND** 需人工裁决时既有 `interrupt-raised` 裁决通路 MUST 不受影响并可与 `review-completed` 并存

#### Scenario: 图节点转移事件下行
- **WHEN** 编排图一次运行中某节点开始或完成执行
- **THEN** 后端 MUST 经 control-event 下发 `graph-node-activated` 事件，携 `runId`、节点名与 `enter`/`exit` 相位
- **AND** 该事件 MUST NOT 混入内容流通道
- **AND** 既有对话流分片与 `interrupt-raised` / `review-completed` 事件的语义与时序 MUST 不受影响

### Requirement: 强类型消息与运行关联

系统 MUST 将所有 IPC 消息定义为以 `type` 字段判别的 discriminated union，并携带 `runId` 关联同一次运行。对不属于运行的工作流、资产和查询命令，契约 MUST 使用精确的 `workflow`、`asset` 或 `request` scope，而不得伪造 `runId`；工作流运行事件 MUST 同时携带原 `runId` 与精确 `workflowId` / `stageId`，issue scope 时还 MUST 携带 `issueId`，standalone 运行则保持仅以 `runId` 关联。

每个 IPC 请求 MUST 带 `requestId`；改变持久化状态的命令 MUST 另带幂等 `operationId`；需要并发保护的命令 MUST 带 `expectedVersion`。`requestId` 标识一次请求，`operationId` 标识一次业务写操作，二者 MUST NOT 混用。响应与事件 MUST 回传适用的 request/operation 关联及结构化错误。continuation MUST 是带 discriminant 的联合，并引用来源 run 及精确 workflow/stage/issue scope，MUST NOT 仅按 `correct` / `modify` decision kind 推断恢复目标。

建议契约形态包括 `RunScope { runId; workflowRef? }`、`WorkflowScope { workflowId; stageId?; issueId? }`、`AssetScope { projectId; assetId; baseVersion? }` 与 `RequestMeta { requestId; operationId?; expectedVersion? }`，并通过判别联合明确区分 `run`、`workflow`、`asset` 与 `request` scope。

#### Scenario: Story Bible 删除/合并命令可判别
- **WHEN** Renderer 请求删除某条事实或合并两个实体
- **THEN** 前端 MUST 发送 `delete-story-bible-fact` 或 `merge-story-bible-entities` 命令并携带 runId 与受限 payload
- **AND** 后端 MUST 通过判别联合收窄命令类型，无需使用 any

#### Scenario: standalone run 与 workflow run 精确区分
- **WHEN** standalone 运行或归属于工作流阶段的运行发出既有控制事件
- **THEN** standalone 事件 MUST 继续携带 `runId` 且 workflow scope 可缺省
- **AND** workflow run 事件 MUST 同时携带 `runId` 与精确 workflow/stage scope；issue scope 时 MUST 携带 `issueId`

#### Scenario: continuation 联合精确判别
- **WHEN** Main 恢复一个中断运行
- **THEN** continuation resolver MUST 根据 continuation discriminant、来源 run 和 workflow/stage/issue scope 判定目标
- **AND** MUST 拒绝 scope 不匹配或不属于模板允许范围的恢复

### Requirement: 流式、中断与错误语义
系统 MUST 在 IPC 契约中支持流式传输、运行中断，并将错误作为一等消息类型传递。作者恢复决策（`resume-run` 的 `decision`）跨 IPC 到达 Main 时为不可信输入，Main MUST 在驱动图续跑前校验其判别形状，非法/未知决策 MUST 以强类型错误消息拒绝而非让异常穿透。

#### Scenario: 流式内容分片传递
- **WHEN** 后端产生流式内容（正文或对话）
- **THEN** 内容 MUST 以增量分片经对应流通道推送
- **AND** 每次运行 MUST 有明确的开始与结束标记

#### Scenario: 前端可发起中断
- **WHEN** 作者请求停止（拉手刹）
- **THEN** 前端 MUST 能经 control-event 通道发送针对特定 `runId` 的 abort 命令
- **AND** 后端 MUST 能据此中止对应运行

#### Scenario: 错误作为消息而非异常穿透
- **WHEN** 后端在处理某运行时发生错误
- **THEN** 错误 MUST 作为控制事件通道上的强类型错误消息传递（含 `runId`）
- **AND** MUST NOT 以未捕获异常形式跨越 IPC 边界

#### Scenario: 恢复决策的 Main 侧校验
- **WHEN** Main 收到 `resume-run` 命令
- **THEN** Main MUST 校验 `decision` 为受支持的判别联合（`approve` / `reject` / `correct` 携带 `optionId` / `modify` 携带 issues）
- **AND** 决策非法或 `kind` 未知时 MUST 以 stream-error（含 `runId`）拒绝，MUST NOT 将其透传至图的续跑分支

### Requirement: Task Runtime IPC 契约

IPC MUST 提供强类型 task run 查询/命令和 `task-activity-event` 事件，至少区分 `projectRef`、`taskRunId`、可选 `workflowRef`、`chapterId`、`issueId` 和 `requestId`。改变任务状态或作者决策的命令 MUST 携带 `operationId`、`expectedVersion`，并在响应中返回成功快照或结构化 command failure。

#### Scenario: 创建并订阅任务
- **WHEN** Renderer 选择一个当前任务并请求开始
- **THEN** Main MUST 校验项目与任务归属、创建 task run 并发布真实 started/input 活动
- **AND** Renderer MUST 能通过 task activity 事件和重连查询恢复视图

### Requirement: 活动事件语义

`task-activity-event` MUST 携带任务运行引用、作者可读阶段/标题/消息、createdAt，并按需携带输入摘要、输出摘要、feedback、nextAction、evidenceRefs、artifactRefs、modelAudit 和 uiEffects。事件 MUST 反映真实执行，不得由 Renderer 根据最终 snapshot 猜测生成。

#### Scenario: 长任务 heartbeat 下行
- **WHEN** Main 侧任务超过 2 秒没有新活动
- **THEN** Main MUST 下发带真实状态摘要的 `task-run-heartbeat`
- **AND** heartbeat MUST 保持同一 taskRunId 且可与完整历史关联

### Requirement: UI Effect 与活动关联

所有正文或创作产物操作 MUST 在 IPC 活动中携带结构化 UI Effect；Effect 至少支持 `select-chapter`、`scroll-to-evidence`、`highlight-quote`、`show-diff`、`show-hunk-review` 和 `show-checkpoint`。Effect 执行结果 MUST 可上报并关联原 activity/taskRun。

#### Scenario: 定位原文 effect
- **WHEN** `locate-source` 找到候选
- **THEN** IPC MUST 下发章节选择、证据滚动和原文高亮 effect
- **AND** Renderer MUST 仅执行 UI 反馈并回报结果，不能直接修改业务数据

### Requirement: 模型审计边界

IPC 的模型交互 DTO MUST 只允许可见输入摘要、上下文/证据引用、作者/系统约束、输出摘要、结构化结果、工具结果、验证结果和采用状态。DTO、日志和持久化活动 MUST NOT 包含 hidden chain-of-thought 或未脱敏的内部 prompt。

#### Scenario: 模型结果可审计
- **WHEN** 模型任务完成或等待作者
- **THEN** 作者 MUST 能查看目标、可见上下文、结果和引用
- **AND** 契约 MUST 拒绝或省略 hidden CoT 字段

### Requirement: 向后兼容与范围校验

既有 standalone 运行和旧事件 MUST 继续可用；新增命令 MUST 校验 project/task/workflow/chapter/issue 归属、版本和 active run，失败返回可读且结构化的错误，不得因 Renderer 传入伪造引用而操作其他项目。

#### Scenario: 过期或伪造引用
- **WHEN** 命令携带不属于项目的引用或过期 expectedVersion
- **THEN** Main MUST 拒绝命令并返回 command failure
- **AND** MUST NOT 发布误导性的成功活动

### Requirement: 工作流命令与快照经控制通道强类型传递

IPC MUST 为工作流提供以 `type` 判别的强类型命令与事件。命令至少覆盖启动/查询工作流、开始/确认/重试/跳过阶段、暂停/恢复/取消工作流、选择/忽略/复检问题；事件至少覆盖 `workflow-snapshot-updated` 与 `workflow-command-failed`。快照 MUST 包含 `workflowId`、版本号、工作流状态、当前阶段、阶段摘要、允许动作和问题状态，MUST NOT 要求 Renderer 访问持久化层补全业务状态。工作流命令 MUST 使用 workflow scope 和 request metadata；写命令 MUST 使用幂等 operation id 与适用的 expected version。

#### Scenario: 启动工作流返回快照
- **WHEN** Renderer 提交合法 `start-workflow` 命令，携带 `requestId`、`operationId` 与适用的 `expectedVersion`
- **THEN** Main MUST 经 control-event 返回强类型 `workflow-snapshot-updated`
- **AND** 快照 MUST 包含新 `workflowId`、模板类型、当前阶段、最新版本与允许动作
- **AND** 响应 MUST 回传相同 `requestId`、`operationId` 和精确 workflow scope

#### Scenario: 旧快照命令冲突
- **WHEN** Renderer 使用过期 `expectedVersion` 提交阶段推进命令
- **THEN** Main MUST 返回 `workflow-command-failed` 与最新快照或其引用
- **AND** MUST NOT 应用冲突转换

### Requirement: 作者目标更新经工作流命令强类型传递

IPC MUST 提供以 `workflow-update-goal` 判别的工作流命令，用于在运行中更新 objective 和/或作者要求清单。命令 MUST 携带 `workflowId`、`requestId`、幂等 `operationId` 与 `expectedVersion`；作者要求 MUST 是可重复的 `{ kind, text }` 数组。Main MUST 校验工作流类型、文本约束、项目归属和版本，并返回更新后的完整快照。Renderer MUST NOT 通过本地修改快照伪造保存成功。

#### Scenario: 更新多条作者要求
- **WHEN** Renderer 提交包含多条同类要求的目标更新命令
- **THEN** Main MUST 保留全部合法要求并返回递增版本的快照
- **AND** 快照中的当前阶段和阶段状态 MUST 保持不变

#### Scenario: 更新后诊断提示过期
- **WHEN** 作者要求更新成功且已有基于旧要求的诊断资产
- **THEN** Renderer MUST 显示需要重新诊断的提示
- **AND** Main MUST NOT 通过该更新命令直接运行诊断或回退阶段

### Requirement: 创作资产澄清与影响经控制通道强类型传递

IPC MUST 提供资产查询、发起澄清、确认/拒绝 change set 和处理影响的强类型命令，并提供 `creative-asset-change-proposed`、`creative-asset-updated`、`asset-impact-detected` 与结构化失败事件。change set DTO MUST 包含目标 `assetId`、base version、字段级 operations 和作者原始澄清；影响 DTO MUST 包含来源资产版本、受影响对象稳定引用、影响级别和允许动作。上述命令与事件 MUST 使用独立 `AssetScope`，携带 project id、asset id 和适用版本，不得把 asset 误作 workflow stage 或 run；写操作还 MUST 关联 requestId、operationId 和新 asset version。

#### Scenario: 澄清候选变更下行
- **WHEN** Main 将作者澄清解析为目标人物资产的字段级变更
- **THEN** control-event MUST 下发可审阅的 `creative-asset-change-proposed`，携带 asset scope、baseVersion、作者原始澄清和 operations
- **AND** Renderer MUST NOT 在收到作者确认前把候选内容显示为已落库

#### Scenario: 资产更新后下发影响
- **WHEN** 作者确认资产 change set 且 Main 成功提交新版本
- **THEN** Main MUST 下发 `creative-asset-updated` 和适用的 `asset-impact-detected`
- **AND** 事件 MUST 携带 request/operation 关联、asset id/version 与受影响对象稳定引用

### Requirement: 既有运行事件可选关联工作流阶段

`stream-start`、`graph-node-activated`、`interrupt-raised`、`review-completed`、`refactor-diff-computed` 与 `refactor-applied` 等属于阶段的既有事件 MUST 携带可选 `workflowRef`，其字段至少为 `workflowId`、`stageId`，issue scope 时包含 `issueId`。不属于工作流的事件 MUST 继续只使用 `runId`，保持向后兼容。

#### Scenario: 节点事件挂载当前阶段
- **WHEN** 一个有 `workflowRef` 的 run 发出 `graph-node-activated`
- **THEN** 事件 MUST 同时携带原 `runId` 与相同 `workflowRef`
- **AND** Renderer MUST 能将真实轨迹显示在对应业务阶段下

#### Scenario: standalone 事件不破坏判别联合
- **WHEN** 单次召唤发出既有控制事件
- **THEN** `workflowRef` MUST 可缺省
- **AND** 既有消费者 MUST 继续正确收窄和处理该事件

### Requirement: 模型任务会话使用独立的结构化 IPC 契约

IPC MUST 将自动模型运行与作者主动专家对话建模为不同的消息联合。模型任务消息 MUST 至少支持任务活动、任务消息、失败、完成、作者补充、重试和中断等判别类型；不得将模型任务活动伪装成专家聊天消息，也不得要求 Renderer 通过读取数据库拼装任务状态。

模型任务 DTO MUST 能表达以下关联与生命周期：`taskId`、`attemptId`、任务类型（至少包括 `fact-extraction`、`global-audit`、`targeted-verification`、`refactor-generation`）、`runId`、可选 `workflowRef`、可选 `chapterId`、attempt status，以及活动的 `activityId`、阶段、面向作者的消息、可选结构化 metadata 和时间戳。活动阶段至少包括 `reading`、`model`、`validation`、`ingest`、`conflict`、`completed`、`failed`；metadata MUST 只携带可展示的证据/结果摘要，不得携带隐藏思维链。

作者补充命令 MUST 使用 `workflow-supplement-model-task`，并携带 request metadata、目标 task/attempt、文本、明确的作用域和幂等 operation id；作用域至少区分 `current-chapter`、`remaining-chapters` 与 `workflow-goal`，缺省作用域 MUST 由 Main 解释为 `current-chapter`。重试和中断 MUST 分别使用 `retry-model-task` 与 `abort-model-task`，并通过强类型成功/失败事件反馈。所有 task 命令 MUST 由 Main 校验项目归属、task/run/workflow/stage/chapter scope、当前状态、版本和幂等性。

任务补充或重试不得覆盖旧 attempt；Main MUST 为新的执行创建新的 `attemptId` 并保留历史活动。模型候选事实、冲突与作者裁决 MUST 使用结构化 DTO 传递；Renderer MUST 只能提交补充、重试、中断或明确裁决意图，MUST NOT 直接提交 confirmed 事实或把自由文本当作裁决。

#### Scenario: 模型任务活动与专家消息可区分
- **WHEN** Main 发布事实抽取的模型活动和专家聊天消息
- **THEN** 两者 MUST 具有不同的 discriminant 和消费入口
- **AND** 专家聊天历史 MUST 不包含模型任务活动

#### Scenario: 补充要求带有默认作用域
- **WHEN** Renderer 发送不含显式作用域的 `workflow-supplement-model-task`
- **THEN** Main MUST 按当前章节作用域处理，或在缺少章节 scope 时返回结构化失败
- **AND** Main MUST 返回带 task/attempt 关联的活动或失败事件

#### Scenario: 重试生成新 attempt
- **WHEN** Renderer 发送合法 `retry-model-task`
- **THEN** Main MUST 返回或发布新的 `attemptId`
- **AND** 旧 attempt MUST 仍可通过任务查询获取

#### Scenario: 越权覆盖 confirmed 事实被拒绝
- **WHEN** Renderer 试图用模型任务自由文本直接替换 confirmed 事实
- **THEN** Main MUST 拒绝该命令并保持 confirmed 事实不变
- **AND** MUST 返回可解释的结构化错误

### Requirement: Main 校验所有工作流与资产输入关联

来自 Renderer 的 workflow kind、workflow/stage/issue id、asset id/base version、字段操作、版本号、动作、requestId、operationId、expectedVersion 和恢复关联 MUST 被视为不可信输入。Main MUST 验证项目归属、当前版本、允许转换、资产/问题归属、锚点、活动 run、scope 一致性与 operationId 幂等性；非法、重复或冲突命令 MUST 以强类型失败事件拒绝，MUST NOT 抛出未捕获异常或部分写入。

#### Scenario: 伪造问题归属被拒绝
- **WHEN** 修复命令中的 `issueId` 不属于给定 `workflowId`
- **THEN** Main MUST 拒绝命令并保持正文、checkpoint 与工作流状态不变

#### Scenario: 过期资产基线被拒绝
- **WHEN** 资产确认命令中的 base version 不是目标资产最新版本
- **THEN** Main MUST 拒绝盲目覆盖并返回最新资产摘要
- **AND** Story Bible 与资产版本 MUST 保持不变

### Requirement: 工作流事件提交后发布且可重新查询

Main MUST 在 SQLite 事务成功提交后发布工作流更新事件。若 Renderer 丢失事件或应用重启，MUST 能通过带 `requestId` 的查询命令获取持久化最新快照；Renderer MUST NOT 依赖重放本地临时事件重建长期工作流。

#### Scenario: 重连后获取最新状态
- **WHEN** Renderer 重载并请求当前项目活动工作流
- **THEN** Main MUST 从持久化层返回最新工作流快照
- **AND** 快照 MUST 包含此前阶段、run 关联摘要与问题生命周期状态

