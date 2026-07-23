## MODIFIED Requirements

### Requirement: Map-Reduce 全书总检
系统 MUST 以 Map-Reduce 方式对全书总检：Map 阶段按章/实体分片抽取事实库骨架，Reduce 阶段跨片对撞检出全局矛盾。

#### Scenario: Map 抽取骨架
- **WHEN** 启动一次全书总检
- **THEN** Map 阶段 MUST 从事实库按章/实体分片抽取骨架（实体状态时间线、伏笔状态机、人设特征弧光）

#### Scenario: Reduce 对撞全局矛盾
- **WHEN** Map 分片完成
- **THEN** Reduce 阶段 MUST 跨片对撞检出全局矛盾（时空死锁、伏笔悬空、人设崩塌/弧光断裂、状态矛盾）

#### Scenario: 首版骨架对撞可降级
- **WHEN** 当前环境没有 utilityProcess/worker 总检实现
- **THEN** 系统 MAY 在 Main 侧执行只读、轻量的事实库骨架对撞作为首版 MVP
- **AND** 该实现 MUST 保持可中断、只读、可替换为 worker 的边界

### Requirement: 离线可中断
总检为离线批处理，MUST 可手动触发且可中断。

#### Scenario: 手动触发
- **WHEN** 作者在完稿或大节点请求总检
- **THEN** 系统 MUST 支持手动触发总检，且 MUST NOT 强制其嵌入常规写作流

#### Scenario: 长任务可中断
- **WHEN** 作者在总检运行中请求停止
- **THEN** 系统 MUST 按 abort 语义中断任务
- **AND** 已完成分片的结果 SHOULD 可保留供查看

#### Scenario: 控制事件报告进度
- **WHEN** 总检遍历事实库骨架
- **THEN** 系统 MUST 经控制事件报告 started/progress/completed/failed
- **AND** 失败或中断 MUST 作为结构化事件返回，MUST NOT 以未捕获异常穿透 IPC
