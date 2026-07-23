## ADDED Requirements

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
