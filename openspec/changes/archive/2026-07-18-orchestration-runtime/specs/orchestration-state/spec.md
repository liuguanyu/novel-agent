## ADDED Requirements

### Requirement: 共享状态驱动运行时图
`NovelState`、reducer 语义与 `ContextRefs` MUST 在本波从契约推进为驱动实际 LangGraph 图的运行时状态：reducer 标签（append/overwrite）MUST 桥接到框架 Annotation，core 契约 MUST NOT 耦合框架类型。

#### Scenario: reducer 桥接保真
- **WHEN** 运行时图合并状态字段
- **THEN** `chatHistory` MUST 按累加语义合并、`activeBugs` MUST 可覆写，与 core reducer 一致
- **AND** 桥接层 MUST 位于 Main 实现层，core 的 NovelState/reducer MUST NOT 依赖 LangGraph 类型

#### Scenario: 上下文以引用进入运行时状态
- **WHEN** 节点需要事实/素材上下文
- **THEN** 其 MUST 经 `contextRefs` 以引用进入状态并按需检索
- **AND** MUST NOT 将整库内容塞入运行时状态
