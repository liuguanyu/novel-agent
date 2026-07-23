## ADDED Requirements

### Requirement: Cmd+K 命令面板
系统 MUST 提供 Cmd+K 唤起的命令面板覆盖层，作为召唤三入口之一，产出统一召唤命令。

#### Scenario: 唤起并产出统一命令
- **WHEN** 作者按下 Cmd+K（或对应快捷键）
- **THEN** 系统 MUST 唤起命令面板覆盖层
- **AND** 由其发起的召唤 MUST 产出 on-demand-summon 的统一命令（agent/scope/anchor/mode/instruction）
- **AND** MUST NOT 自造另一套命令结构

### Requirement: 查阅架构看板
命令面板 MUST 可查阅 architect 维护的看板（时间线轴、并行情节线、核心人设集）。

#### Scenario: 呈现后端看板数据
- **WHEN** 作者经命令面板请求查阅看板
- **THEN** 系统 MUST 呈现时间线轴、并行情节线与核心人设集
- **AND** 看板数据 MUST 来自后端，Renderer MUST NOT 自行计算

### Requirement: 三入口产出同一命令
划词气泡、Cmd+K 命令面板与侧边栏工具箱 MUST 产出同一种召唤命令。

#### Scenario: 入口收敛
- **WHEN** 任一入口发起召唤
- **THEN** 三入口 MUST 产出同一种统一召唤命令
- **AND** 命令协议 MUST 归 on-demand-summon，前端仅作为入口
