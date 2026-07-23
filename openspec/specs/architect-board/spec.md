# architect-board Specification

## Purpose
TBD - created by archiving change architect-board-viz. Update Purpose after archive.
## Requirements
### Requirement: 架构看板取数经后端投影查询

architect 维护的架构看板（时间线轴 / 并行情节线 / 核心人设集）MUST 经后端只读投影查询取数：Main 从事实库读取最新 `FactView` 并投影为纯可序列化的看板 DTO；查询 MUST 复用既有 Story Bible 事实模型（时间线事件 / 伏笔 / 实体），MUST NOT 另立看板专用的事实结构。当事实库无最新版本时，查询 MUST 返回空看板（三轴均为空列表），MUST NOT 报错崩溃。

#### Scenario: 有事实时投影为看板视图

- **WHEN** 作者请求查阅架构看板且事实库存在最新版本
- **THEN** Main MUST 从最新 `FactView` 投影出时间线轴、并行情节线与核心人设集
- **AND** 投影产物 MUST 为纯可序列化 DTO（不暴露 core/db 类型）
- **AND** MUST 复用既有 Story Bible 事实模型，MUST NOT 另立看板专用事实结构

#### Scenario: 无事实时返回空看板

- **WHEN** 作者请求查阅架构看板但事实库无最新版本
- **THEN** 查询 MUST 返回三轴均为空列表的空看板
- **AND** MUST NOT 报错或崩溃

### Requirement: 看板取数经受限只读桥

看板取数 MUST 经 preload 的受限只读查询桥完成，Renderer MUST NOT 直接访问数据库、文件或任意 IPC 通道。

#### Scenario: 受限桥暴露看板查询方法

- **WHEN** Renderer 请求查阅架构看板
- **THEN** preload MUST 通过受限 `getArchitectBoard()` 方法调用 Main 的查询通道
- **AND** MUST NOT 暴露 SQLite、任意 SQL、任意文件或任意 IPC 通道调用能力

### Requirement: 看板排序与计算归后端

看板的排序与派生（如时间线按时间刻度排序）MUST 在后端完成，Renderer MUST 仅呈现后端产出的看板数据，MUST NOT 自行计算或推导看板结构。

#### Scenario: 时间线轴按后端排序呈现

- **WHEN** Renderer 呈现看板时间线轴
- **THEN** 时间线事件的先后顺序 MUST 取自后端投影的排序结果
- **AND** Renderer MUST NOT 自行重排或推导时间线结构

