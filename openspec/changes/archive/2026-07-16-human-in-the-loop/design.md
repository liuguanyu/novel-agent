## Context

“副驾拉手刹”是本产品的灵魂。控制面把 LangGraph 的中断与状态能力暴露为作者可用的交互语义
（interrupt/resume/abort/time-travel），建立在 agent-orchestration 的图、状态与 checkpointer 之上，
经 ipc-contract 的 control-event 通道与前端交互。本 change 只定义语义与契约，不实现 agent/召唤/UI。

## Goals / Non-Goals

**Goals:**
- 定义条件性动态中断（节点内 interrupt payload）与带决策数据的恢复。
- 定义即时 abort（停止生成、断连、干净态保证）。
- 定义 time-travel（历史查询、回退、分叉）及与事实版本的联动回滚。
- 明确 abort 与 time-travel 的语义区别。

**Non-Goals:**
- 不实现具体 agent 或其提示词（agent-orchestration）。
- 不实现召唤入口与命令协议（on-demand-summon）。
- 不实现 UI（手刹按钮、弹窗、历史面板由 electron-shell-ui 负责）。
- 不编写实现代码。

## Decisions

### D1. 动态中断优先于静态断点
- 优先使用节点内 `interrupt(payload)` 实现**条件性中断**：仅在需要作者介入时挂起（如审稿发现 bug、
  重构产出方案），并把结构化 payload 推给作者。
- 静态 interruptBefore/After 仅作调试兜底，不作为主交互机制（因其无法表达“有问题才停”）。
- payload MUST 为强类型结构（如审稿报告=activeBugs、重构方案=diff 提案）。

### D2. 恢复携带决策数据
- 作者以 `Command(resume=决策数据)` 恢复运行，决策数据进入共享状态影响后续节点。
- 支持三类决策：批准（放行）、驳回（否定并终止/改道）、修改（如覆写 activeBugs——删掉误报、
  只改指定项）。对应 orchestration-state 的 activeBugs 可覆写 reducer 与 story-bible 的
  requiresHumanDecision。
- resume 后从挂起点继续，不重跑已完成节点。

### D3. abort：丢弃未提交当前步
- abort 经 model-adapter 的 AbortSignal 立即停止当前流式生成并断开 provider 连接（省 token）。
- 因 checkpointer 在节点边界持久化，被中止的当前节点未提交，其半成品 MUST NOT 进入状态；
  最近 checkpoint 即“干净态”，无需显式回滚。
- abort 是廉价、即时操作，针对特定 runId（遵循 ipc-contract）。

### D4. time-travel：主动回溯与分叉
- 提供：查询 checkpoint 历史、回退到指定 checkpoint、从指定 checkpoint 分叉出新分支。
- 用于“退回三步前那版大纲重写”等主动回溯，区别于 abort 的“丢弃当前半步”。
- 回退/分叉 MUST 与 story-bible 事实版本联动：还原到某 checkpoint 时，事实库 MUST 呈现该时刻视图
  （见 fact-versioning）。

### D5. abort vs time-travel（明确区分）
- abort = 丢弃“未提交的当前步”，即时、廉价，不涉及历史。
- time-travel = 从“已提交的历史 checkpoint”回溯或分叉，主动、涉及历史与事实版本联动。
- 两者 MUST 在契约与 UI 语义上区分，避免混淆。

### D6. 经 control-event 通道
- 所有控制语义（interrupt 通知、resume 命令、abort 命令、time-travel 操作、状态变更）MUST 经
  ipc-contract 的 control-event 通道传递，携带 runId，错误作为一等消息。

## Risks / Trade-offs

- **风险：resume 决策数据与状态 reducer 不一致导致覆写异常。** 缓解：决策数据类型与 activeBugs
  覆写 reducer 对齐，schema 校验。
- **风险：分叉产生的多分支管理复杂。** 取舍：本 change 定义分叉能力与语义；分支树的可视化留给
  electron-shell-ui，深度分叉 UI 可后置。
- **风险：abort 时 provider 未及时断开仍计费。** 缓解：SHOULD 尽快断连（model-adapter 契约已要求）。
- **权衡：事实版本联动增加回滚复杂度。** 取舍：这是保证双向一致性检查正确的前提，必要。
