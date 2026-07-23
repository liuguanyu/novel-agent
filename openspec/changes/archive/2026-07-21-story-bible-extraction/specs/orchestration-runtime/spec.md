## MODIFIED Requirements

### Requirement: supervisor 路由与专家节点运行时
运行时 MUST 以 supervisor 为入口，按当前动作/召唤命令将执行路由到专家节点；系统 MUST 提供 writer 与 reviewer 节点，并支持事实抽取能力以可扩展节点或后置步骤接入而不破坏既有节点。

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

#### Scenario: 新正文反哺事实库
- **WHEN** writer 产生新草稿或作者显式要求为章节抽取事实
- **THEN** 系统 SHOULD 将带 NodeRef 的正文提交事实抽取运行时
- **AND** 低风险事实 MAY 自动入库为 inferred
- **AND** 抽取冲突 MUST 复用 interrupt/resume 人工裁决回路，MUST NOT 在未裁决时覆盖 confirmed 事实
