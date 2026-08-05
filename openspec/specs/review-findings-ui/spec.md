# review-findings-ui Specification

## Purpose
TBD - created by archiving change review-findings-ui. Update Purpose after archive.
## Requirements
### Requirement: 结构化审校卡片呈现

渲染层 MUST 消费 `review-completed` 控制事件，把一致性问题清单渲染为**按严重度配色的结构化卡片**，取代裸文本转储。每张卡片 MUST 呈现严重度、问题类型、描述，并在有对应字段时呈现证据引文与建议修复。

#### Scenario: 审校结果渲染为分级卡片
- **WHEN** 后端下发 `review-completed`，携某次审校运行的问题清单
- **THEN** 渲染层 MUST 在该运行对应的对话回合下呈现结构化卡片
- **AND** 卡片 MUST 按严重度着色（critical / warning / info 各异）
- **AND** MUST 呈现问题描述，并在有证据引文/建议修复时一并呈现

#### Scenario: 严重度视觉可区分
- **WHEN** 一批问题含不同严重度
- **THEN** 每张卡片 MUST 以视觉（如边框/徽标配色）明确区分其严重度

### Requirement: 点击卡片定位并高亮原文

作者点击一张带证据引文的审校卡片时，系统 MUST 滚动正文轴到该引文所在处并高亮该文本；卡片本身 MUST 呈现选中态。

#### Scenario: 点击卡片跳转高亮
- **WHEN** 作者点击一张带证据引文的卡片
- **THEN** 系统 MUST 使正文轴滚动到引文处并高亮该文本
- **AND** 被点击卡片 MUST 呈现选中态

#### Scenario: 无证据不可定位
- **WHEN** 作者点击一张无证据引文的卡片
- **THEN** 系统 MUST NOT 触发正文跳转
- **AND** MUST NOT 高亮任意文本

#### Scenario: 取消选中清除高亮
- **WHEN** 作者取消选中当前卡片或切换选中到另一张卡片
- **THEN** 系统 MUST 清除上一处高亮

### Requirement: 卡片与原文连线指向

当前选中的审校卡片与其在正文中的高亮文本之间 MUST 以覆盖层连线视觉指向，连线 MUST 按问题严重度着色，并随滚动与尺寸变化保持贴合。

#### Scenario: 选中时画连线
- **WHEN** 作者选中一张带证据引文的卡片且正文已高亮对应文本
- **THEN** 系统 MUST 在卡片与高亮文本之间绘制一条连线
- **AND** 连线 MUST 按问题严重度着色

#### Scenario: 连线随视图更新
- **WHEN** 任一侧面板滚动或窗口尺寸变化
- **THEN** 连线 MUST 重新贴合卡片与高亮文本的最新位置
- **AND** 任一端不可见/缺失时 MUST NOT 绘制悬空连线

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

