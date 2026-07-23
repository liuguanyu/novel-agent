## MODIFIED Requirements

### Requirement: 三入口产出同一命令
划词气泡、Cmd+K 命令面板与侧边栏工具箱 MUST 产出同一种召唤命令。侧边栏工具箱现以常驻工具条（summon-toolbox）落地，其 Agent 排 MUST 与命令面板共用同一权威 agent 目录驱动、产出同构的统一召唤命令；后端 MUST NOT 依据来源入口分支处理。

#### Scenario: 入口收敛
- **WHEN** 任一入口发起召唤
- **THEN** 三入口 MUST 产出同一种统一召唤命令
- **AND** 命令协议 MUST 归 on-demand-summon，前端仅作为入口

#### Scenario: 工具条与命令面板同构
- **WHEN** 作者从常驻工具条 Agent 排发起召唤
- **THEN** 其产出的召唤命令 MUST 与命令面板从同一 agent 发起时同构
- **AND** 后端 MUST NOT 依据来源入口（工具条 / 命令面板 / 划词气泡）分支处理
