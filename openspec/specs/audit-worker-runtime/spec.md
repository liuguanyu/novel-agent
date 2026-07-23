# audit-worker-runtime Specification

## Purpose
TBD - created by archiving change audit-worker-runtime. Update Purpose after archive.
## Requirements
### Requirement: 全书总检在 utilityProcess worker 执行
全书总检的 Map-Reduce 对撞计算 MUST 在 utilityProcess worker 执行，Main 进程 MUST NOT 同步跑完对撞而阻塞事件循环。Main MUST 只承担读事实库快照、派发任务、聚合评分与下发控制事件；对撞算法 MUST 在 worker 侧。

#### Scenario: 派发到 worker 计算
- **WHEN** 作者手动触发一次全书总检
- **THEN** Main MUST 读取最新事实库快照（FactView）并把它随启动任务派发给 audit worker
- **AND** Map-Reduce 骨架对撞 MUST 在 utilityProcess worker 执行
- **AND** Main 事件循环与正在进行的 IPC MUST NOT 因对撞计算被同步阻塞

#### Scenario: worker 读不到数据库故由 Main 供快照
- **WHEN** worker 执行总检
- **THEN** worker MUST 仅依据 Main 传入的可序列化事实库快照计算，MUST NOT 直接访问 SQLite 或文件
- **AND** 跨进程传递 MUST 仅为类型化任务消息（判别字段 + taskId 关联 + 错误即消息）

### Requirement: 总检结果经既有控制事件下发
worker 完成或失败后，Main MUST 把结果聚合为既有质量仪表盘 DTO 并经既有 `global-audit-started/progress/completed/failed` 控制事件下发，Renderer 的消息形状 MUST 保持不变；健康度评分与红黄牌聚合归 Main。

#### Scenario: 完成下发仪表盘
- **WHEN** worker 回传对撞结果
- **THEN** Main MUST 聚合为健康度评分 + 按严重度分级的问题列表（质量仪表盘 DTO）
- **AND** MUST 经 `global-audit-completed` 控制事件下发，DTO 形状与既有一致

#### Scenario: 失败作为结构化事件
- **WHEN** worker 计算失败或事实库未就绪
- **THEN** Main MUST 经 `global-audit-failed` 下发结构化错误（category + message）
- **AND** MUST NOT 以未捕获异常穿透 IPC

### Requirement: 总检可中断
运行中的总检 MUST 可经既有 abort 语义中断，Main MUST 向 worker 转发中止并以中断类别结束该运行。

#### Scenario: 中断运行中的总检
- **WHEN** 总检运行中作者请求停止（abort-run 该 runId）
- **THEN** Main MUST 向 worker 转发中止请求
- **AND** MUST 以 `global-audit-failed`(category=aborted) 结束该运行，MUST NOT 影响其他并发运行

### Requirement: worker 不可用时可回退内联
当运行环境无可用 utilityProcess（如 fork 失败或非 Electron 运行时）时，系统 MAY 回退为 Main 侧内联执行同一套纯对撞计算作为降级，且降级 MUST 保持只读、可中断、输出与 worker 路径语义一致。

#### Scenario: fork 不可用降级内联
- **WHEN** utilityProcess 不可用或 worker 启动失败
- **THEN** 系统 MAY 以 Main 内联执行同一纯对撞函数完成本次总检
- **AND** 该降级 MUST 只读事实库快照、MUST 可中断、产出的仪表盘 DTO MUST 与 worker 路径一致

#### Scenario: 对撞计算为纯函数可独立校验
- **WHEN** 校验总检对撞正确性
- **THEN** 对撞计算 MUST 收敛为无 I/O、无 Electron 依赖的纯函数
- **AND** MUST 可在不启动 utilityProcess 的情况下被独立调用校验

