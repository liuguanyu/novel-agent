## ADDED Requirements

### Requirement: supervisor 路由与专家节点
编排图 MUST 以 supervisor 为入口路由，将请求按当前动作/意图分发到专家节点（writer、reviewer、
fact-checker、editor、style-editor、architect、character-generator、worldbuilding 等）。

#### Scenario: 按动作路由
- **WHEN** 图收到带 `currentAction`/意图的请求
- **THEN** supervisor MUST 依据该动作将执行路由到对应专家节点

#### Scenario: 专家节点可扩展
- **WHEN** 需要新增一类专家 agent
- **THEN** 系统 MUST 允许以新节点接入图，而不破坏既有节点

### Requirement: 条件路由与循环
编排图 MUST 支持条件路由与循环，以表达“写→审→改→再审”等迭代环路。

#### Scenario: 写-审-改循环
- **WHEN** 审稿产出需要修改的问题且流程要求迭代
- **THEN** 图 MUST 能从修改节点回到审稿节点形成循环
- **AND** 循环 MUST 可在满足条件或人工介入时终止

### Requirement: 单一有状态图
召唤等操作 MUST 通过改变同一张有状态图的下一跳路由实现，MUST NOT 为每次操作新建无状态单发图。

#### Scenario: 召唤复用有状态图
- **WHEN** 上层（on-demand-summon）请求调用某个 agent
- **THEN** 系统 MUST 向同一张持久化图注入命令以改变路由
- **AND** MUST NOT 新建脱离共享状态与 checkpointer 的一次性图

### Requirement: 编排进程归属
图与 agent 执行 MUST 位于 Main 进程或 utilityProcess，绝不在 Renderer。

#### Scenario: 编排不在 Renderer
- **WHEN** 运行编排图或任意节点
- **THEN** 其执行 MUST 位于 Main 或 utilityProcess
