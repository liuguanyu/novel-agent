## ADDED Requirements

### Requirement: Main 侧 LangGraph 编排运行时
系统 MUST 在 Main（或 utilityProcess）以 LangGraph 落地单一有状态图运行时，以 `NovelState` 为共享状态、Main 侧 SQLite checkpointer 为持久化后端；MUST NOT 在 Renderer 运行图或任意节点。

#### Scenario: 图以共享状态运行
- **WHEN** 编排运行时启动一次运行
- **THEN** 图 MUST 以强类型 `NovelState` 为共享状态（禁 any）
- **AND** MUST 使用 Main 侧 SQLite checkpointer 在节点边界持久化状态

#### Scenario: 运行时不在 Renderer
- **WHEN** 执行图或任意专家节点
- **THEN** 其执行 MUST 位于 Main 或 utilityProcess
- **AND** Renderer MUST NOT 直接触碰图、数据库、文件系统或 LLM

### Requirement: supervisor 路由与专家节点运行时
运行时 MUST 以 supervisor 为入口，按当前动作/召唤命令将执行路由到专家节点；本波 MUST 至少提供 writer 与 reviewer 两类专家节点，并支持新专家节点可扩展接入而不破坏既有节点。

#### Scenario: 按动作路由到专家
- **WHEN** 图收到带 `currentAction` 或注入的召唤命令
- **THEN** supervisor MUST 依据该动作路由到对应专家节点

#### Scenario: 写手节点产出正文
- **WHEN** 路由到 writer 节点
- **THEN** 该节点 MUST 调用 LLM 产出正文草稿并写入共享状态的草稿字段
- **AND** 流式分片 MUST 经既有对话流通道回推 Renderer

#### Scenario: 专家节点可扩展
- **WHEN** 需要新增一类专家 agent
- **THEN** 系统 MUST 允许以注册方式接入新节点，supervisor 路由 MUST 数据驱动而非按来源硬编码分支

### Requirement: 条件路由与写-审-改循环
运行时 MUST 支持条件路由与循环，表达"写→审→改→再审"的迭代环路，循环 MUST 可在满足条件或人工介入时终止。

#### Scenario: 审出问题回到修改
- **WHEN** reviewer 节点产出需要修改的问题
- **THEN** 图 MUST 能从修改节点回到审校节点形成循环
- **AND** 循环 MUST 可在问题清空或作者介入时终止

### Requirement: 召唤复用同一有状态图
一次召唤 MUST 通过向同一张持久化图注入命令改变下一跳路由实现，MUST NOT 为每次操作新建脱离共享状态与 checkpointer 的一次性单发图。

#### Scenario: 注入命令而非新建图
- **WHEN** 上层请求调用某个 agent（summon-run）
- **THEN** 运行时 MUST 向长驻的同一张图注入命令以改变路由
- **AND** MUST NOT 每次召唤新建 StateGraph 实例

#### Scenario: 图实例生命周期受管理
- **WHEN** 应用退出或切换工作区
- **THEN** 运行时 MUST 清理长驻图实例，MUST NOT 泄漏
