## ADDED Requirements

### Requirement: 时间旅行运行时落地
`time-travel` 契约 MUST 在本波落地为真运行时：沿 SQLite checkpointer 的 parent 链回溯历史 checkpoint，并可选定任一历史 checkpoint 作为新分支起点重开运行，回溯重开 MUST NOT 破坏既有 checkpoint 链。

#### Scenario: 回溯并重开分支
- **WHEN** 作者选定某历史 checkpoint 请求从该点重开
- **THEN** 运行时 MUST 从该 checkpoint 的状态恢复图并重开运行
- **AND** 新运行产生的 checkpoint MUST 作为新分支挂到选定 checkpoint 之下，MUST NOT 破坏既有链

#### Scenario: 历史链可查询
- **WHEN** 请求某 checkpoint 的历史链
- **THEN** 运行时 MUST 沿 parent 链返回可查询的 checkpoint 列表
