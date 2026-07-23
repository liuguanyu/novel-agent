## MODIFIED Requirements

### Requirement: IPC 三通道正交
系统 MUST 提供三条正交的 IPC 通道：正文流（manuscript-stream）、对话流（dialogue-stream）、控制事件（control-event）；三者职责不重叠。事实抽取的进度、完成、失败与冲突裁决事件 MUST 走控制事件通道。

#### Scenario: 正文与对话分离
- **WHEN** Writer 产生正文 token 同时某 agent 产生对话回复
- **THEN** 正文 token MUST 经 manuscript-stream 通道传递
- **AND** 对话内容 MUST 经 dialogue-stream 通道传递
- **AND** 两者 MUST NOT 混入同一通道

#### Scenario: 控制事件独立通道
- **WHEN** 发生挂起（interrupt）、恢复（resume）、中断（abort）、状态变更、事实抽取进度或错误
- **THEN** 该事件 MUST 经 control-event 通道传递，与内容流分离

#### Scenario: 事实抽取事件强类型
- **WHEN** 后端开始、完成或失败一次事实抽取
- **THEN** 后端 MUST 经 control-event 下发带 runId 的强类型事件
- **AND** 事件 SHOULD 包含章节 id、候选数量、自动入库数量、冲突数量与错误诊断
