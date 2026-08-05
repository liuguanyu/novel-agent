## ADDED Requirements

### Requirement: 单次运行状态仅携带工作流上下文引用

当 LangGraph 运行属于长期工作流时，`NovelState` MUST 以可选强类型 `workflowRef` 携带 `workflowId`、`stageId` 与可选 `issueId`，并使该引用在本次运行的节点和控制事件间保持一致。完整 `WorkflowInstance`、全部阶段历史和问题队列 MUST NOT 被复制进 LangGraph 共享状态。

#### Scenario: 阶段运行携带引用
- **WHEN** Main 从人物设计阶段启动一次专家运行
- **THEN** 初始 `NovelState.workflowRef` MUST 指向该 workflow 与 stage
- **AND** 运行产生的消息、节点事件和完成证据 MUST 可由该引用归属当前阶段

#### Scenario: standalone 运行引用为空
- **WHEN** 一次按需召唤不属于长期工作流
- **THEN** `workflowRef` MUST 可缺省
- **AND** 既有 reducer 与路由行为 MUST 保持可用

### Requirement: 工作流长期状态独立于 NovelState reducer

工作流阶段转换、run 关联和问题生命周期 MUST 由 Main 工作流服务事务化管理，MUST NOT 通过 `NovelState` reducer 累加长期历史。LangGraph checkpoint MAY 保存当次运行的 `workflowRef`，但 MUST NOT 被视为工作流实例真相源。

#### Scenario: 新运行不覆盖长期阶段历史
- **WHEN** 同一阶段产生新运行并创建新的 `NovelState`
- **THEN** 工作流 repository MUST 保留此前 run 关联
- **AND** 新状态初始化 MUST NOT 依赖复制全部旧运行状态
