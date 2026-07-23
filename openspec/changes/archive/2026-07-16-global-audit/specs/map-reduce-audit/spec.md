## ADDED Requirements

### Requirement: Map-Reduce 全书总检
系统 MUST 以 Map-Reduce 方式对全书总检：Map 阶段按章/实体分片抽取事实库骨架，Reduce 阶段跨片对撞检出
全局矛盾。

#### Scenario: Map 抽取骨架
- **WHEN** 启动一次全书总检
- **THEN** Map 阶段 MUST 从事实库按章/实体分片抽取骨架（实体状态时间线、伏笔状态机、人设特征弧光）

#### Scenario: Reduce 对撞全局矛盾
- **WHEN** Map 分片完成
- **THEN** Reduce 阶段 MUST 跨片对撞检出全局矛盾（时空死锁、伏笔悬空、人设崩塌/弧光断裂、状态矛盾）

### Requirement: 只对撞骨架不读水字
总检 MUST 只对撞结构化骨架，MUST NOT 逐字重读正文水字。

#### Scenario: 成本随骨架而非字数
- **WHEN** 执行总检
- **THEN** 对撞对象 MUST 是事实库结构化骨架
- **AND** MUST NOT 逐字重读全部正文
- **AND** 宏观语义检查 MAY 检索向量库辅助，但 MUST 以骨架对撞为主

### Requirement: 总检在 utilityProcess
Map-Reduce 计算属 CPU 密集且量大，MUST 在 utilityProcess/worker 执行。

#### Scenario: 计算不阻塞 UI
- **WHEN** 执行 Map-Reduce 总检
- **THEN** 计算 MUST 在 utilityProcess/worker 执行
- **AND** 主进程事件循环与 UI/IPC MUST NOT 被阻塞

### Requirement: 离线可中断
总检为离线批处理，MUST 可手动触发且可中断。

#### Scenario: 手动触发
- **WHEN** 作者在完稿或大节点请求总检
- **THEN** 系统 MUST 支持手动触发总检，且 MUST NOT 强制其嵌入常规写作流

#### Scenario: 长任务可中断
- **WHEN** 作者在总检运行中请求停止
- **THEN** 系统 MUST 按 abort 语义中断任务
- **AND** 已完成分片的结果 SHOULD 可保留供查看
