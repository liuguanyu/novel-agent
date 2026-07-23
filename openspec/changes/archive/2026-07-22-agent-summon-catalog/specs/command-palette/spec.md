## ADDED Requirements

### Requirement: 召唤目录覆盖全部专家 agent
命令面板的召唤项 MUST 由权威 agent 目录驱动，覆盖 orchestration 已落地的全部专家节点；
MUST NOT 硬编码召唤项子集而遗漏任何已落地 agent。

#### Scenario: 目录驱动且覆盖全部专家
- **WHEN** 作者唤起命令面板查看可召唤动作
- **THEN** 系统 MUST 依据权威 agent 目录渲染召唤项，目录 MUST 覆盖 orchestration 已落地的全部专家节点（writer/scene-generator/reviewer/fact-checker/plagiarism-checker/editor/style-editor/architect/character-generator/worldbuilding）
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
