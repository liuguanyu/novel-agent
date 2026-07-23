## ADDED Requirements

### Requirement: 局部重构 diff 计算在 utilityProcess worker 执行

原片段与 agent 改写的最小差异 + hunk 拆分属 CPU 密集，MUST 在 utilityProcess worker 执行，Main 进程 MUST NOT 同步跑完 diff 而阻塞事件循环。Main MUST 只承担裁片段、派发任务、收敛结果与下发控制事件；最小差异算法 MUST 在 worker 侧。

#### Scenario: 派发到 worker 计算 diff
- **WHEN** 作者对某片段发起一次局部重构且重构 agent 已产出改写片段
- **THEN** Main MUST 把「原片段（含锚点）+ 改写片段全文」随任务派发给 diff worker
- **AND** 最小差异计算 + hunk 拆分 MUST 在 utilityProcess worker 执行
- **AND** Main 事件循环与正在进行的 IPC MUST NOT 因 diff 计算被同步阻塞

#### Scenario: worker 仅据传入片段计算
- **WHEN** worker 执行 diff
- **THEN** worker MUST 仅依据 Main 传入的原片段 + 改写片段计算，MUST NOT 直接访问 SQLite 或磁盘正文
- **AND** 跨进程传递 MUST 仅为类型化任务消息（判别字段 type + taskId 关联 + 错误即消息）
- **AND** 产出的 hunk MUST 仅覆盖片段范围内的差异，越出片段边界的内容 MUST NOT 产生 hunk

### Requirement: 逐 hunk 裁决经纯函数拼回并写回磁盘正文

作者对每个 hunk 独立接受/拒绝后，Main MUST 用确定性纯函数拼回（仅将被接受 hunk 的改写替换其片段内原位），并把拼回后的片段仅替换锚点区间写回磁盘 Markdown 正文，未接受项与片段之外的正文 MUST NOT 改动；系统 MUST NOT 提供整章/整节点一键覆盖原文的写入路径。

#### Scenario: 接受部分 hunk 精确拼回落盘
- **WHEN** 作者接受一次 diff 中的部分 hunk 并提交裁决
- **THEN** Main MUST 用纯函数按接受项精确拼回片段，拒绝/未裁决项对应原文 MUST NOT 改动
- **AND** Main MUST 读磁盘章节原文、仅以拼回后的片段替换该片段锚点 [from, to) 区间后写回磁盘
- **AND** 片段之外的正文 MUST 逐字节保持不变

#### Scenario: 无整章覆盖路径
- **WHEN** 执行任何重构写入
- **THEN** 写入 MUST 仅经逐 hunk 接受的片段区间替换实现
- **AND** 系统 MUST NOT 提供整章/整节点覆盖原文的写入路径

#### Scenario: 接受项失效或重叠不盲拼
- **WHEN** 被接受的 hunk 存在已失效项或区间相互重叠
- **THEN** Main MUST 拒绝拼回并以结构化失败事件告知（含相关 hunk 标识），MUST NOT 盲目写盘

### Requirement: 重构变更作为可回滚步进入 checkpointer

接受 hunk 产生的正文变更 MUST 作为可回滚步进入 checkpointer（与事实版本共用同一标识空间），供 human-in-the-loop 的 time-travel 回退或分叉。

#### Scenario: 落盘后提交可回滚 checkpoint
- **WHEN** 一次逐 hunk 接受产生正文变更并写回磁盘
- **THEN** Main MUST 将该变更作为一个 checkpoint 提交进 checkpointer，并沿 parent 链成史
- **AND** 完成事件 MUST 携带该 checkpoint 标识供作者 time-travel 定位

### Requirement: 局部重构可中断

运行中的 diff 计算 MUST 可经既有 abort 语义中断，Main MUST 向 worker 转发中止并以中断类别结束该运行，MUST NOT 影响其他并发运行。

#### Scenario: 中断运行中的 diff
- **WHEN** diff 计算运行中作者请求停止（abort-run 该 runId）
- **THEN** Main MUST 向 worker 转发中止请求
- **AND** MUST 以重构失败事件（category=aborted）结束该运行，MUST NOT 影响其他并发运行

### Requirement: worker 不可用时可回退内联

当运行环境无可用 utilityProcess（如 fork 失败或非 Electron 运行时）时，系统 MAY 回退为 Main 侧内联执行同一套纯 diff 计算作为降级，且降级 MUST 可中断、输出与 worker 路径语义一致。

#### Scenario: fork 不可用降级内联
- **WHEN** utilityProcess 不可用或 diff worker 启动失败
- **THEN** 系统 MAY 以 Main 内联执行同一纯 diff 函数完成本次计算
- **AND** 该降级 MUST 可中断、产出的 DiffResult MUST 与 worker 路径一致

#### Scenario: diff 计算为纯函数可独立校验
- **WHEN** 校验 diff 拆分与拼回正确性
- **THEN** diff 计算 MUST 收敛为无 I/O、无 Electron 依赖的纯函数
- **AND** MUST 可在不启动 utilityProcess 的情况下被独立调用校验
