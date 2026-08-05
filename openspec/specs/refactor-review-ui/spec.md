# refactor-review-ui Specification

## Purpose
TBD - created by archiving change refactor-review-ui. Update Purpose after archive.
## Requirements
### Requirement: 渲染层承载 diff 双栏与逐 hunk 控件

正文改写审阅界面 MUST 消费后端 `refactor-diff-computed` 控制事件，呈现「原片段 vs 改写片段」的 diff 双栏视图，并为每个 hunk 提供独立的 accept/reject 控件。界面 MUST 支持由外部（审校发现的「采纳并修改」动作）程序化预填「原片段」并打开面板，同时把 `suggestedFix` 独立显示为只读修改建议；`suggestedFix` MUST NOT 被当作实际改写正文预填到「改写片段」。作者或改写专家提供的实际改写片段 MUST 可编辑后再发起 diff 计算；手动录入路径 MUST 保持可用。

#### Scenario: 计算 diff 后呈现双栏与逐 hunk 控件
- **WHEN** 作者提交「原片段 + 实际改写片段」发起 `compute-refactor-diff`，后端回传 `refactor-diff-computed`
- **THEN** 界面 MUST 呈现原片段与改写片段的 diff 双栏视图
- **AND** MUST 为回传的每个 hunk 呈现独立的 accept/reject 控件

#### Scenario: diff 计算失败结构化提示
- **WHEN** 后端回传 `refactor-diff-failed`
- **THEN** 界面 MUST 展示结构化错误信息
- **AND** MUST NOT 进入逐 hunk 审阅态

#### Scenario: 由审校发现采纳并预填打开
- **WHEN** 作者在带证据引文的审校卡片上点击「采纳并修改」
- **THEN** 界面 MUST 以该发现的证据引文预填「原片段」、保持「改写片段」为空，并把建议修复独立显示为修改建议后打开面板
- **AND** 作者 MUST 能输入或编辑实际改写内容后再发起 diff 计算
- **AND** 当预填的原片段无法在正文中唯一定位时，界面 MUST 展示结构化提示且 MUST NOT 进入逐 hunk 审阅态

### Requirement: accept/reject 只上报意图

作者对 hunk 的 accept/reject MUST 仅在渲染层收集为意图并经 IPC（`apply-hunk-decisions`）上报；渲染层 MUST NOT 执行 diff 计算或正文写入业务逻辑。

#### Scenario: 提交裁决只上报意图
- **WHEN** 作者对各 hunk 选定 accept/reject 并提交
- **THEN** 渲染层 MUST 经 `apply-hunk-decisions` 上报逐 hunk 裁决意图
- **AND** 实际拼回与正文写盘 MUST 在后端执行
- **AND** 渲染层 MUST NOT 在本地计算 diff 或写入正文文件

### Requirement: 落盘成功后重载章节正文

逐 hunk 裁决拼回写盘成功（`refactor-applied`）后，界面 MUST 重载当前章节正文以呈现磁盘变更，并展示可回滚 checkpoint 标识。

#### Scenario: 应用成功后刷新正文
- **WHEN** 后端回传 `refactor-applied`
- **THEN** 界面 MUST 重载当前章节正文
- **AND** MUST 展示本次变更的 checkpoint 标识（若后端提供）

#### Scenario: 应用失败保留审阅态
- **WHEN** 后端回传 `refactor-apply-failed`
- **THEN** 界面 MUST 展示结构化错误信息与相关 hunk 标识（若提供）
- **AND** MUST NOT 误报为已落盘

### Requirement: 工作流改写结果关联问题与 checkpoint

从工作流问题发起的 diff/hunk 会话 MUST 保持 `workflowId`、`stageId`、`issueId` 和稳定正文锚点。`refactor-applied` 成功后，界面 MUST 以 Main 返回的工作流快照显示已关联 checkpoint 与问题 verifying 状态；Renderer MUST NOT 自行将问题标记 resolved。

#### Scenario: hunk 落盘后进入待复检
- **WHEN** 工作流问题的 hunk 裁决成功应用并返回 checkpoint id
- **THEN** 界面 MUST 重载目标章节并显示 checkpoint
- **AND** 问题状态 MUST 以后端快照呈现为 verifying
- **AND** MUST 提供下一步针对性复检入口

#### Scenario: 全部 hunk 拒绝不伪造修复
- **WHEN** 作者拒绝所有 hunk 且正文未发生变化
- **THEN** 系统 MUST NOT 创建“已修复”证据或把问题转为 verifying/resolved
- **AND** 工作流 MUST 保持问题 fixing 或返回作者选择

