## ADDED Requirements

### Requirement: Main-only SQLite 服务
系统 MUST 使用 Main 侧 SQLite 服务持久化 checkpoint 与事实库运行态，Renderer MUST NOT 直接访问 SQLite 或 Node 能力。

#### Scenario: 初始化数据库
- **WHEN** 应用启动并需要持久化服务
- **THEN** Main MUST 使用 Node 内置 `node:sqlite` 初始化数据库
- **AND** 数据库文件 SHOULD 默认位于 Electron `userData` 目录
- **AND** Renderer MUST 只能通过 preload 暴露的受限 IPC 能力访问派生数据

#### Scenario: node:sqlite 不可用
- **WHEN** 当前运行环境不支持 `node:sqlite`
- **THEN** 系统 MUST 返回结构化错误
- **AND** MUST NOT 因裸异常导致白屏或进程崩溃

### Requirement: 幂等 schema migration
系统 MUST 以幂等 migration 管理 SQLite schema。

#### Scenario: 首次迁移
- **WHEN** 数据库为空
- **THEN** 系统 MUST 创建 `schema_migrations` 表
- **AND** MUST 按顺序应用所有已定义迁移

#### Scenario: 重复启动
- **WHEN** 应用再次启动
- **THEN** 系统 MUST 跳过已记录的 migration
- **AND** MUST NOT 重复创建表或破坏已有数据
