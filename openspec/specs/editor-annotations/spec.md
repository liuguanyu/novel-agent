# editor-annotations Specification

## Purpose
TBD - created by archiving change electron-shell-ui. Update Purpose after archive.
## Requirements
### Requirement: 编辑器承载标注
正文轴基于 TipTap/ProseMirror，MUST 承载 bug 高亮、diff 双栏视图与逐 hunk accept/reject 控件。

#### Scenario: 承载三类标注
- **WHEN** 后端产出 bug 或改写提案
- **THEN** 正文轴 MUST 以 TipTap/ProseMirror 承载 bug 高亮、diff 双栏视图与逐 hunk accept/reject 控件

#### Scenario: accept/reject 只上报意图
- **WHEN** 作者对某 hunk 点击 accept/reject
- **THEN** 前端 MUST 仅收集意图并经 IPC 上报
- **AND** 实际 diff 计算与正文拼回 MUST 在后端（surgical-refactor）执行
- **AND** Renderer MUST NOT 执行 diff 计算或正文写入业务逻辑

### Requirement: 标注锚定防漂移
所有标注 MUST 以稳定标识符 + ProseMirror 位置锚定，文档编辑时按位置映射修正，不漂移。

#### Scenario: 编辑后不漂移
- **WHEN** 文档在存在标注时被编辑
- **THEN** 系统 MUST 按 ProseMirror 位置映射修正标注位置
- **AND** 高亮/hunk MUST NOT 漂移或错位

#### Scenario: 无法映射即失效
- **WHEN** 某标注因文档变化无法安全映射
- **THEN** 系统 MUST 将其标记为失效并提示重新计算
- **AND** MUST NOT 在错误位置渲染标注

### Requirement: 标注锚点复用稳定标识符
标注锚点 MUST 复用 story-workspace 稳定标识符。

#### Scenario: 复用稳定标识符
- **WHEN** 为一个标注建立锚点
- **THEN** 其 MUST 复用 story-workspace 稳定标识符（重命名/移序/编辑不漂移）
- **AND** MUST NOT 使用会随编辑失效的裸文本位置作为唯一锚

