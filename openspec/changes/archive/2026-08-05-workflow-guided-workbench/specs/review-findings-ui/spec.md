## ADDED Requirements

### Requirement: 工作流问题卡片呈现生命周期与下一动作

当审校问题属于工作流时，结构化卡片 MUST 展示其 `open`、`fixing`、`verifying`、`resolved` 或 `dismissed` 状态，并根据后端工作流快照呈现适用的定位、开始修复、继续修复、运行复检或填写理由后忽略动作。卡片 MUST 保留严重度、类型、描述、证据与建议修复等既有信息。

#### Scenario: 已落盘问题显示待复检
- **WHEN** 某问题已关联 checkpoint 且状态为 verifying
- **THEN** 卡片 MUST 显示“待复检”及适用复检动作
- **AND** MUST NOT 因正文已修改而显示为已解决

#### Scenario: 已解决与已忽略可区分
- **WHEN** 问题列表同时包含 resolved 与 dismissed 问题
- **THEN** 卡片 MUST 以状态和原因明确区分两者
- **AND** dismissed MUST 展示作者记录的理由

### Requirement: 卡片动作保持章节与问题锚点

从问题卡片发起定位或修复时，Renderer MUST 上报稳定 `issueId`、工作流/阶段引用与问题章节/节点锚点；无可用锚点时 MUST 禁用写入型修复入口并显示原因。`suggestedFix` MUST 作为修改建议展示，MUST NOT 作为已生成的正文改写片段上报。

#### Scenario: 从全书问题切换到目标章节
- **WHEN** 作者从质量问题卡片发起修复且问题锚定其他章节
- **THEN** 界面 MUST 切换并等待目标章节正文加载后再开放改写输入
- **AND** 修复命令 MUST 保持原 `issueId` 与章节锚点

#### Scenario: 只有建议时要求实际改写
- **WHEN** 问题只有 `suggestedFix` 而没有实际 rewritten text
- **THEN** 界面 MUST 将其显示为只读修改建议
- **AND** 必须由作者或改写专家提供实际改写正文后才能计算 diff
