## MODIFIED Requirements

### Requirement: IPC 三通道正交
系统 MUST 提供三条正交的 IPC 通道：正文流（manuscript-stream）、对话流（dialogue-stream）、控制事件（control-event）；三者职责不重叠。事实抽取的进度、完成、失败与冲突裁决事件 MUST 走控制事件通道。全书总检的 started/progress/completed/failed 事件 MUST 走控制事件通道。Story Bible 事实确认的完成/失败事件 MUST 走控制事件通道。Story Bible 事实编辑的完成/失败事件 MUST 走控制事件通道。Story Bible 事实删除与实体合并的完成/失败事件 MUST 走控制事件通道。审校类 agent（reviewer / fact-checker / plagiarism-checker）诊断出的结构化一致性问题清单 MUST 经控制事件通道以强类型 `review-completed` 事件下行，MUST NOT 混入内容流通道。

#### Scenario: Story Bible 删除/合并事件强类型
- **WHEN** Story Bible 事实删除或实体合并完成或失败
- **THEN** 后端 MUST 经 control-event 下发带 runId 的强类型事件
- **AND** 成功事件 MUST 包含操作目标与最新 factVersion

#### Scenario: 审校结果结构化下行
- **WHEN** 审校类 agent 运行结束（正常完成或因需人工裁决而挂起）且产出非空一致性问题清单
- **THEN** 后端 MUST 经 control-event 下发 `review-completed` 事件，携 `runId`、产出 agent 标识与强类型 `ConsistencyIssueDto[]`
- **AND** 该结构化清单 MUST NOT 以裸文本形态经内容流通道传递
- **AND** 需人工裁决时既有 `interrupt-raised` 裁决通路 MUST 不受影响并可与 `review-completed` 并存
