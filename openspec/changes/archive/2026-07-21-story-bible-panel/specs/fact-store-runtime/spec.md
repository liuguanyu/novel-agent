## MODIFIED Requirements

### Requirement: 事实库 SQLite schema
系统 MUST 在 SQLite 中持久化事实库实体、属性、别名、时间线、关系、伏笔与出处信息，作为后续抽取与检查 worker 的运行时底座。系统 SHOULD 提供 Main 侧只读查询，将 latest fact view 投影为 Renderer 可展示的 DTO。

#### Scenario: 创建事实表
- **WHEN** SQLite migrations 首次运行
- **THEN** 系统 MUST 创建承载实体、别名、属性、时间线事件、关系、伏笔与出处的表
- **AND** 表结构 MUST 支持可扩展 JSON payload，以便后续事实类型演进不破坏既有数据

#### Scenario: 读取实体
- **WHEN** 上层按实体 id 与版本请求实体
- **THEN** 事实库存储 MUST 返回对应实体或 null
- **AND** 返回数据 MUST 经类型收窄后符合 core/story-bible 的实体契约

#### Scenario: 查询当前 Story Bible 视图
- **WHEN** Renderer 请求查看 Story Bible
- **THEN** Main MUST 从事实库读取 latest fact version 的当前视图并投影为可序列化 DTO
- **AND** DTO SHOULD 包含实体、别名、属性、时间线事件、关系、伏笔、状态与 provenance quote
- **AND** Renderer MUST NOT 直接访问 SQLite 或 core DB 模块
- **AND** 无事实库或无版本时 MUST 返回空态 DTO
