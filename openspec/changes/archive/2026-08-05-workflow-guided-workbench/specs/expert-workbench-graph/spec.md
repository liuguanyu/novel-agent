## ADDED Requirements

### Requirement: 专家工作台呈现长期业务阶段计划

当项目存在活动或暂停的工作流时，专家工作台 MUST 在真实节点轨迹之上呈现业务阶段计划，至少包括工作流类型与目标、完整已实例化阶段、当前阶段、阶段状态、总进度、阻塞/等待原因和下一步。阶段 MUST 区分 system、expert、author 与 quality-gate actor，并可辨识 pending、running、blocked、awaiting-confirmation、completed、skipped 与 failed 状态。

#### Scenario: 人物设计阶段可解释
- **WHEN** 新书工作流当前处于人物设计并等待作者确认
- **THEN** 上层计划 MUST 标识人物设计为当前阶段并显示“等待作者确认”
- **AND** MUST 显示已完成阶段与模板定义的下一阶段
- **AND** MUST NOT 把一次 reviewer/writer 节点时间线冒充完整新书流程

#### Scenario: 折叠后保留关键摘要
- **WHEN** 作者收起专家工作台
- **THEN** 收起态 MUST 仍显示工作流类型、当前阶段及下一步或阻塞原因
- **AND** MUST NOT 只显示最近一个 LangGraph 节点名

### Requirement: 工作台区分主阶段与横切资产澄清

工作台 MUST 将待确认的资产 change set、正在执行的 asset-maintenance activity 和资产影响提醒与主业务阶段分开展示。资产澄清 MUST 显示目标资产、版本、状态和影响数量，但 MUST NOT 改写当前阶段标识；只有影响分析导致当前阶段 stale/blocked 时，主阶段状态才可按后端快照变化。

#### Scenario: 写作中澄清人物
- **WHEN** 正文写作阶段发起人物资产澄清
- **THEN** 工作台 MUST 继续显示正文写作为当前主阶段
- **AND** MUST 单独显示“人物资产变更待确认”及目标人物
- **AND** MUST NOT 显示工作流已退回人物设计阶段

#### Scenario: 资产影响阻塞当前阶段
- **WHEN** 已确认资产变更使当前章节核心前置条件冲突
- **THEN** 工作台 MUST 根据后端快照将当前阶段显示为 stale 或 blocked
- **AND** MUST 展示立即处理、记录待办或继续并记录风险等允许动作

### Requirement: 当前阶段内部继续呈现真实运行轨迹

工作台下层 MUST 继续按后端 `graph-node-activated` 事件的真实到达顺序呈现当前阶段选中或最近一次 `runId` 的节点步骤。新 `runId` MAY 重置下层单次轨迹，但 MUST NOT 清除上层工作流阶段历史或跨 run 关联。

#### Scenario: 同阶段新运行只重置下层
- **WHEN** 作者在人物设计阶段提交第二轮意见并产生新 `runId`
- **THEN** 下层 MUST 开始显示第二轮真实节点轨迹
- **AND** 上层人物设计阶段 MUST 保持当前状态并保留该阶段已有运行计数/历史

#### Scenario: standalone 运行保持兼容
- **WHEN** 当前运行没有 `workflowId` / `stageId`
- **THEN** 工作台 MUST 使用既有“本轮目标 + 真实执行步骤”视图
- **AND** MUST NOT 展示虚构的业务阶段计划

### Requirement: 工作台动作只上报工作流意图

工作台 MAY 提供开始当前阶段、确认、重试、跳过、暂停、恢复或继续下一项等适用动作，但 Renderer MUST 只根据后端快照展示允许动作并经 IPC 上报意图；Renderer MUST NOT 自行计算合法转换、推进阶段或关闭问题。

#### Scenario: 非法阶段动作由 Main 拒绝
- **WHEN** Renderer 因旧快照提交已不再合法的确认命令
- **THEN** Main MUST 返回结构化失败及最新工作流快照
- **AND** Renderer MUST 以最新快照纠正显示，MUST NOT 本地强制推进
