## ADDED Requirements

### Requirement: 渲染层承载 diff 双栏与逐 hunk 控件

正文改写审阅界面 MUST 消费后端 `refactor-diff-computed` 控制事件，呈现「原片段 vs 改写片段」的 diff 双栏视图，并为每个 hunk 提供独立的 accept/reject 控件。

#### Scenario: 计算 diff 后呈现双栏与逐 hunk 控件
- **WHEN** 作者提交「原片段 + 改写片段」发起 `compute-refactor-diff`，后端回传 `refactor-diff-computed`
- **THEN** 界面 MUST 呈现原片段与改写片段的 diff 双栏视图
- **AND** MUST 为回传的每个 hunk 呈现独立的 accept/reject 控件

#### Scenario: diff 计算失败结构化提示
- **WHEN** 后端回传 `refactor-diff-failed`
- **THEN** 界面 MUST 展示结构化错误信息
- **AND** MUST NOT 进入逐 hunk 审阅态

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
