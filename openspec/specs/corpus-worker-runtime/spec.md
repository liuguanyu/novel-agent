# corpus-worker-runtime Specification

## Purpose
TBD - created by archiving change corpus-worker-runtime. Update Purpose after archive.
## Requirements
### Requirement: 查询 embedding 在 utilityProcess worker 执行

素材语义检索的查询 embedding 计算 MUST 在 utilityProcess worker 执行，Main 进程 MUST NOT 同步跑完向量计算而阻塞事件循环。Main MUST 只承担读素材快照、派发查询文本、排序聚合与下发控制事件；embedding 算法 MUST 在 worker 侧（回退内联时在 Main，但为同一纯函数）。

#### Scenario: 派发到 worker 计算查询向量
- **WHEN** 作者发起一次素材语义检索
- **THEN** Main MUST 把查询文本随任务消息派发给 embed worker
- **AND** 查询 embedding 计算 MUST 在 utilityProcess worker 执行
- **AND** Main 事件循环与正在进行的 IPC MUST NOT 因向量计算被同步阻塞

#### Scenario: worker 只据传入文本计算
- **WHEN** worker 执行 embedding
- **THEN** worker MUST 仅依据 Main 传入的文本计算向量，MUST NOT 直接访问 SQLite 或文件
- **AND** 跨进程传递 MUST 仅为类型化任务消息（判别字段 + taskId 关联 + 错误即消息）

### Requirement: 检索排序与过滤组合归 Main

Main MUST 对（按作用域筛出的）素材条目以查询向量做语义相似度排序，并 MUST 支持按类型/标签/来源过滤与语义检索组合，仅返回同时满足语义相关与过滤条件的条目，按相关度降序。

#### Scenario: 按语义相似度降序返回
- **WHEN** worker 回传查询向量
- **THEN** Main MUST 以余弦相似度对候选素材排序，返回按相关度降序的命中列表
- **AND** MUST 遵循 topK 与 minScore 截断（若给定）

#### Scenario: 过滤与语义组合
- **WHEN** 检索指定类型/标签/来源过滤条件
- **THEN** Main MUST 仅返回同时满足语义相关与过滤条件的条目

#### Scenario: 限定检索作用域
- **WHEN** 检索指定作用域（单篇/项目/全局）
- **THEN** Main MUST 仅在该作用域内的素材中返回结果

### Requirement: 检索经控制事件下发且可中断

检索结果 MUST 经 `corpus-retrieval-started`/`corpus-retrieval-completed`/`corpus-retrieval-failed` 控制事件下发；运行中的检索 MUST 可经既有 abort 语义中断，失败 MUST 作为结构化事件（category + message），MUST NOT 以未捕获异常穿透 IPC。

#### Scenario: 完成下发命中列表
- **WHEN** Main 完成排序
- **THEN** MUST 经 `corpus-retrieval-completed` 下发命中列表（素材条目 + 相关度分数）

#### Scenario: 失败作为结构化事件
- **WHEN** embedding 计算失败
- **THEN** Main MUST 经 `corpus-retrieval-failed` 下发结构化错误（category + message）
- **AND** MUST NOT 以未捕获异常穿透 IPC

#### Scenario: 中断运行中的检索
- **WHEN** 检索运行中作者请求停止（abort 该 runId）
- **THEN** Main MUST 向 worker 转发中止请求
- **AND** MUST 以 `corpus-retrieval-failed`(category=aborted) 结束该运行

### Requirement: 素材为弱参考不进入一致性检查

检索到的素材条目 MUST 仅作为可取可不取的灵感输入，MUST NOT 构成约束、MUST NOT 进入一致性检查、MUST NOT 产生 bug。

#### Scenario: 检索不触发一致性问题
- **WHEN** 素材库中存在与当前正文不同的设定或写法且被检索命中
- **THEN** 系统 MUST NOT 因此产出任何一致性问题或 bug
- **AND** 素材 MUST 仅作为检索结果返回，不写入事实库/不进总检

### Requirement: worker 不可用时可回退内联

当运行环境无可用 utilityProcess（fork 失败或非 Electron 运行时）时，系统 MAY 回退为 Main 内联执行同一套纯 embedding 计算作为降级，且降级 MUST 保持可中断、输出与 worker 路径语义一致。

#### Scenario: fork 不可用降级内联
- **WHEN** utilityProcess 不可用或 worker 启动失败
- **THEN** 系统 MAY 以 Main 内联执行同一纯 embedding 函数完成本次检索
- **AND** 该降级 MUST 可中断、产出的命中列表 MUST 与 worker 路径一致

#### Scenario: embedding 计算为纯函数可独立校验
- **WHEN** 校验 embedding/排序正确性
- **THEN** embedding 计算 MUST 收敛为无 I/O、无 Electron 依赖的确定性纯函数
- **AND** MUST 可在不启动 utilityProcess 的情况下被独立调用校验

