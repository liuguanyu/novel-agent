## ADDED Requirements

### Requirement: 事实库 SQLite schema
系统 MUST 在 SQLite 中持久化事实库实体、属性、别名、时间线、关系、伏笔与出处信息，作为后续抽取与检查 worker 的运行时底座。

#### Scenario: 创建事实表
- **WHEN** SQLite migrations 首次运行
- **THEN** 系统 MUST 创建承载实体、别名、属性、时间线事件、关系、伏笔与出处的表
- **AND** 表结构 MUST 支持可扩展 JSON payload，以便后续事实类型演进不破坏既有数据

#### Scenario: 读取实体
- **WHEN** 上层按实体 id 与版本请求实体
- **THEN** 事实库存储 MUST 返回对应实体或 null
- **AND** 返回数据 MUST 经类型收窄后符合 core/story-bible 的实体契约

### Requirement: 事实版本增量写入
系统 MUST 以增量方式记录事实库变更，保留版本历史并可关联 checkpoint。

#### Scenario: 追加事实版本
- **WHEN** 一次事实写入发生
- **THEN** 系统 MUST 创建新的 fact version 记录
- **AND** MUST 追加 fact changes 记录本次新增或修改
- **AND** MUST NOT 覆盖或删除旧版本历史

#### Scenario: 关联 checkpoint
- **WHEN** 事实写入发生在某 checkpoint 上下文中
- **THEN** fact version 与 fact changes SHOULD 记录对应 checkpoint id

#### Scenario: 重启后读回
- **WHEN** 应用关闭并重新打开同一数据库
- **THEN** 事实版本、变更与实体数据 MUST 能被读回
