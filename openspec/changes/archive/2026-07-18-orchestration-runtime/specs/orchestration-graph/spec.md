## ADDED Requirements

### Requirement: 编排图运行时落地
`orchestration-graph` 的契约 MUST 在本波以 LangGraph 落地为 Main 侧运行时：单一有状态图、supervisor 路由、写-审-改条件循环真跑通，并以 Main 侧 SQLite checkpointer 在节点边界持久化。

#### Scenario: 契约推进为运行时
- **WHEN** 应用运行一次编排
- **THEN** 既有 orchestration-graph 契约（supervisor 路由 / 条件循环 / 单一有状态图 / 进程归属）MUST 由实际 LangGraph 运行时满足
- **AND** MUST NOT 仅停留在类型契约层
