# command-palette Specification

## Purpose
TBD - created by archiving change electron-shell-ui. Update Purpose after archive.
## Requirements
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
划词气泡、Cmd+K 命令面板与侧边栏工具箱 MUST 产出同一种召唤命令。侧边栏工具箱现以常驻工具条（summon-toolbox）落地，其 Agent 排 MUST 与命令面板共用同一权威 agent 目录驱动、产出同构的统一召唤命令；后端 MUST NOT 依据来源入口分支处理。

#### Scenario: 入口收敛
- **WHEN** 任一入口发起召唤
- **THEN** 三入口 MUST 产出同一种统一召唤命令
- **AND** 命令协议 MUST 归 on-demand-summon，前端仅作为入口

#### Scenario: 工具条与命令面板同构
- **WHEN** 作者从常驻工具条 Agent 排发起召唤
- **THEN** 其产出的召唤命令 MUST 与命令面板从同一 agent 发起时同构
- **AND** 后端 MUST NOT 依据来源入口（工具条 / 命令面板 / 划词气泡）分支处理

### Requirement: 召唤目录覆盖全部专家 agent
命令面板的召唤项 MUST 由权威 agent 目录驱动，覆盖 orchestration 已落地的全部专家节点；
MUST NOT 硬编码召唤项子集而遗漏任何已落地 agent。

#### Scenario: 目录驱动且覆盖全部专家
- **WHEN** 作者唤起命令面板查看可召唤动作
- **THEN** 系统 MUST 依据权威 agent 目录渲染召唤项，目录 MUST 覆盖 orchestration 已落地的全部专家节点（writer/scene-generator/reviewer/fact-checker/plagiarism-checker/editor/style-editor/architect/character-generator/worldbuilding/concept-generator/scene-outliner/researcher）
- **AND** MUST NOT 硬编码召唤项子集而遗漏已落地 agent

#### Scenario: 目录与图拓扑不漂移
- **WHEN** orchestration 新增或移除一个专家节点
- **THEN** agent 目录 MUST 与图拓扑的专家节点清单保持同一事实源约束，遗漏登记 MUST 在编译期暴露
- **AND** 命令面板 MUST NOT 各自维护一份与图拓扑漂移的 agent 清单

#### Scenario: 召唤项据目录构造统一命令
- **WHEN** 作者从命令面板选择某专家的召唤项
- **THEN** 系统 MUST 依据该 agent 目录条目声明的默认 mode 与作用范围构造 on-demand-summon 的统一召唤命令
- **AND** 当条目要求节点锚点而当前无选中章节时 MUST 禁用该召唤项
- **AND** MUST NOT 自造另一套命令结构

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

