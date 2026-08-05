# orchestration-state Specification

## Purpose
TBD - created by archiving change agent-orchestration. Update Purpose after archive.
## Requirements
### Requirement: 精确类型的共享状态
编排 MUST 定义精确类型的共享状态（NovelState），禁用 any，承载正文上下文、章节标识、对话历史、
活跃问题、当前动作与 agent 状态等。

#### Scenario: 状态字段强类型
- **WHEN** 定义或访问共享状态字段
- **THEN** 每个字段 MUST 具备精确类型定义
- **AND** MUST NOT 使用 any

#### Scenario: 章节引用复用稳定标识符
- **WHEN** 状态中引用当前章节或正文位置
- **THEN** 其 MUST 使用 story-workspace 的稳定标识符

### Requirement: reducer 语义
共享状态 MUST 为关键字段定义明确的 reducer 语义：对话历史累加、活跃问题可被人工覆写。

#### Scenario: 对话历史累加
- **WHEN** 新的对话消息进入状态
- **THEN** 其 MUST 以累加方式合并进 `chatHistory`，不覆盖既有历史

#### Scenario: 活跃问题可覆写
- **WHEN** 作者对 `activeBugs` 进行增删改（如删掉一个被判定为伏笔的“误报”）
- **THEN** 状态 MUST 允许覆写该列表
- **AND** 覆写结果 MUST 作为后续节点的输入

### Requirement: 上下文以引用进入状态
事实库与素材库 MUST 以引用（版本/作用域）进入状态，MUST NOT 将整库内容塞入状态。

#### Scenario: 引用而非整库
- **WHEN** 某节点需要事实库或素材库上下文
- **THEN** 状态 MUST 以版本/作用域引用表达，由节点按需检索
- **AND** MUST NOT 将整个事实库或素材库内容复制进状态

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

