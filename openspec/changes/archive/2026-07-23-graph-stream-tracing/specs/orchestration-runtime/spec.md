## MODIFIED Requirements

### Requirement: Main 侧 LangGraph 编排运行时

系统 MUST 在 Main（或 utilityProcess）以 LangGraph 落地单一有状态图运行时，以 `NovelState` 为共享状态、Main 侧 SQLite checkpointer 为持久化后端；MUST NOT 在 Renderer 运行图或任意节点。运行时驱动图 MUST 以逐节点流式（stream）方式消费执行进展：每个节点转移 MUST 实时下发 `graph-node-activated` 控制事件（携 `runId`、节点名与相位），MUST NOT 以黑盒一次性调用吞没中间节点转移；流式驱动下的挂起（interrupt）、完成（含 `activeBugs` 收敛）、中断（abort）与错误收敛语义 MUST 与既有行为等价。

#### Scenario: 图以共享状态运行
- **WHEN** 编排运行时启动一次运行
- **THEN** 图 MUST 以强类型 `NovelState` 为共享状态（禁 any）
- **AND** MUST 使用 Main 侧 SQLite checkpointer 在节点边界持久化状态

#### Scenario: 运行时不在 Renderer
- **WHEN** 执行图或任意专家节点
- **THEN** 其执行 MUST 位于 Main 或 utilityProcess
- **AND** Renderer MUST NOT 直接触碰图、数据库、文件系统或 LLM

#### Scenario: 逐节点转移实时下发
- **WHEN** 一次运行中图经过多个节点（如写-审-改循环）
- **THEN** 运行时 MUST 对每个节点转移下发 `graph-node-activated` 控制事件
- **AND** 事件 MUST 按实际执行顺序下发，如实反映本次运行经过的节点序列

#### Scenario: 流式驱动语义等价
- **WHEN** 运行以流式驱动结束（正常完成 / 因裁决挂起 / 被中断 / 出错）
- **THEN** 对话流结束标记与控制事件（`interrupt-raised` / `review-completed` / 错误消息）MUST 与黑盒调用时的语义一致
- **AND** MUST NOT 因流式化而丢失挂起 payload 或最终 `activeBugs`
