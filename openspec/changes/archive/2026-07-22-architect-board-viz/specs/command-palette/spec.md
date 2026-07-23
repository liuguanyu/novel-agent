## ADDED Requirements

### Requirement: 架构看板取数与呈现落地

命令面板对 architect 架构看板的查阅 MUST 落地为可用运行：命令面板 MUST 提供打开看板的查阅入口，看板呈现 MUST 展示时间线轴、并行情节线与核心人设集。看板数据 MUST 经后端投影查询取数（见 architect-board capability），Renderer MUST NOT 自行计算看板结构。看板查阅入口 MUST NOT 产出 on-demand-summon 的召唤命令（看板是查阅、非召唤）。

#### Scenario: 命令面板提供看板查阅入口

- **WHEN** 作者唤起命令面板
- **THEN** 命令面板 MUST 提供一个打开架构看板的查阅入口
- **AND** 该入口 MUST NOT 产出 on-demand-summon 的召唤命令（区别于召唤专家 agent 的项）

#### Scenario: 看板呈现三轴且数据来自后端

- **WHEN** 作者经命令面板打开架构看板
- **THEN** 系统 MUST 呈现时间线轴、并行情节线与核心人设集
- **AND** 看板数据 MUST 经后端投影查询取数，Renderer MUST NOT 自行计算或推导
