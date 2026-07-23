## MODIFIED Requirements

### Requirement: 渲染层承载 diff 双栏与逐 hunk 控件

正文改写审阅界面 MUST 消费后端 `refactor-diff-computed` 控制事件，呈现「原片段 vs 改写片段」的 diff 双栏视图，并为每个 hunk 提供独立的 accept/reject 控件。界面 MUST 支持由外部（审校发现的「采纳并修改」动作）程序化预填「原片段 / 改写片段」输入并打开面板，预填后作者 MUST 仍可编辑后再发起 diff 计算；手动录入路径 MUST 保持可用。

#### Scenario: 计算 diff 后呈现双栏与逐 hunk 控件
- **WHEN** 作者提交「原片段 + 改写片段」发起 `compute-refactor-diff`，后端回传 `refactor-diff-computed`
- **THEN** 界面 MUST 呈现原片段与改写片段的 diff 双栏视图
- **AND** MUST 为回传的每个 hunk 呈现独立的 accept/reject 控件

#### Scenario: diff 计算失败结构化提示
- **WHEN** 后端回传 `refactor-diff-failed`
- **THEN** 界面 MUST 展示结构化错误信息
- **AND** MUST NOT 进入逐 hunk 审阅态

#### Scenario: 由审校发现采纳并预填打开
- **WHEN** 作者在带证据引文的审校卡片上点击「采纳并修改」
- **THEN** 界面 MUST 以该发现的证据引文预填「原片段」、以其建议修复（无则为空）预填「改写片段」并打开面板
- **AND** 作者 MUST 能编辑预填内容后再发起 diff 计算
- **AND** 当预填的原片段无法在正文中唯一定位时，界面 MUST 展示结构化提示且 MUST NOT 进入逐 hunk 审阅态
