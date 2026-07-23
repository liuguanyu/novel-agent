# process-model Specification

## Purpose
TBD - created by archiving change bootstrap-foundation. Update Purpose after archive.
## Requirements
### Requirement: 进程职责边界
系统 MUST 将工作负载划分到三类 Electron 进程，并遵守其职责边界：Renderer 仅负责渲染与交互，
Main 负责应用协调与异步 I/O，utilityProcess/worker 负责 CPU 密集任务。

#### Scenario: Renderer 不承载业务逻辑
- **WHEN** 任意业务逻辑（智能体编排、模型调用、数据库/文件访问、事实抽取、diff 计算）需要执行
- **THEN** 该逻辑 MUST NOT 运行在 Renderer 进程
- **AND** Renderer MUST 通过 IPC 契约向后端发起请求并接收结果

#### Scenario: LangGraph 编排不在 Renderer
- **WHEN** 运行 LangGraph 智能体图或任意 agent 节点
- **THEN** 该执行 MUST 位于 Main 进程或 utilityProcess，绝不在 Renderer

### Requirement: 工作负载归属判据
系统 MUST 依据“是否长时间占用 CPU 同步执行”这一唯一判据决定任务归属：异步 I/O 归 Main，
CPU 密集归 utilityProcess/worker。

#### Scenario: 异步 I/O 归 Main 进程
- **WHEN** 任务为异步 I/O（LLM API 调用、SQLite 读写、文件读写）
- **THEN** 该任务 MAY 在 Main 进程执行
- **AND** 该任务 MUST 以非阻塞方式（await/异步回调）执行，不得同步占用事件循环

#### Scenario: CPU 密集任务归 utilityProcess
- **WHEN** 任务为 CPU 密集型（embedding 计算、大文本 diff、全书 Map-Reduce 总检、大文档解析）
- **THEN** 该任务 MUST 在 utilityProcess 或 worker_threads 中执行
- **AND** MUST NOT 在 Main 进程中同步执行

#### Scenario: 长任务不阻塞 UI 与 IPC
- **WHEN** 一个可能持续超过约 50ms 的 CPU 密集任务被触发
- **THEN** 主进程事件循环 MUST 保持可响应
- **AND** 正在进行的 IPC 消息与 UI 交互 MUST NOT 因该任务被阻塞

### Requirement: 跨进程共享仅限类型与契约
系统 MUST 将跨进程共享的内容限制为类型定义与 IPC 契约，不得跨进程共享实现逻辑以避免耦合。

#### Scenario: 共享层不含实现
- **WHEN** 某模块被 Renderer、Main、worker 中多方引用
- **THEN** 该模块 MUST 仅包含类型、常量与契约定义
- **AND** MUST NOT 包含业务实现逻辑

