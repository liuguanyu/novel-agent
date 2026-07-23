# time-travel Specification

## Purpose
TBD - created by archiving change human-in-the-loop. Update Purpose after archive.
## Requirements
### Requirement: checkpoint 历史查询
系统 MUST 支持查询运行的 checkpoint 历史，供作者回溯。

#### Scenario: 查询历史
- **WHEN** 作者请求查看历史
- **THEN** 系统 MUST 返回可回溯的 checkpoint 序列及其标识

### Requirement: 回退与分叉
系统 MUST 支持回退到指定 checkpoint，并支持从指定 checkpoint 分叉出新分支。

#### Scenario: 回退到历史点
- **WHEN** 作者选择回退到某历史 checkpoint（如“退回三步前那版大纲”）
- **THEN** 系统 MUST 将运行状态还原到该 checkpoint

#### Scenario: 从历史点分叉
- **WHEN** 作者从某历史 checkpoint 发起新的尝试
- **THEN** 系统 MUST 从该 checkpoint 分叉出新分支，不破坏原分支历史

### Requirement: 事实版本联动回滚
time-travel 回退/分叉 MUST 与 story-bible 事实版本联动：还原到某 checkpoint 时事实库呈现该时刻视图。

#### Scenario: 事实库随回退还原
- **WHEN** 运行回退到某 checkpoint
- **THEN** 事实库 MUST 呈现该 checkpoint 时刻的事实视图
- **AND** MUST NOT 保留回退点之后才引入的事实

### Requirement: 与 abort 语义区分
time-travel MUST 与 abort 在语义上明确区分：abort 丢弃未提交当前步，time-travel 从已提交历史回溯或分叉。

#### Scenario: 语义不混淆
- **WHEN** 系统提供中断与回溯能力
- **THEN** abort MUST 表示丢弃未提交的当前步（不涉及历史）
- **AND** time-travel MUST 表示从已提交的历史 checkpoint 回溯或分叉

### Requirement: 时间旅行运行时落地
`time-travel` 契约 MUST 在本波落地为真运行时：沿 SQLite checkpointer 的 parent 链回溯历史 checkpoint，并可选定任一历史 checkpoint 作为新分支起点重开运行，回溯重开 MUST NOT 破坏既有 checkpoint 链。

#### Scenario: 回溯并重开分支
- **WHEN** 作者选定某历史 checkpoint 请求从该点重开
- **THEN** 运行时 MUST 从该 checkpoint 的状态恢复图并重开运行
- **AND** 新运行产生的 checkpoint MUST 作为新分支挂到选定 checkpoint 之下，MUST NOT 破坏既有链

#### Scenario: 历史链可查询
- **WHEN** 请求某 checkpoint 的历史链
- **THEN** 运行时 MUST 沿 parent 链返回可查询的 checkpoint 列表

