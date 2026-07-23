# renderer-editor Specification

## Purpose
TBD - created by archiving change walking-skeleton. Update Purpose after archive.
## Requirements
### Requirement: TipTap 编辑器承载标注
正文轴 MUST 用 TipTap/ProseMirror 承载 bug 高亮、diff 双栏视图与逐 hunk accept/reject 控件。正文轴 MUST 支持按证据引文的程序化定位：给定一段原文引文，编辑器 MUST 能在文档中定位该文本、滚动到可视区域，并以 ProseMirror `Decoration` 施加高亮，且 MUST 能清除该高亮。

#### Scenario: 承载三类标注
- **WHEN** 后端产出 bug 或改写提案
- **THEN** 正文轴 MUST 以 TipTap/ProseMirror 承载 bug 高亮、diff 双栏视图与逐 hunk accept/reject 控件
- **AND** diff 双栏与 hunk 数据 MUST 来自后端 DiffResult，Renderer MUST NOT 自行计算 diff

#### Scenario: accept/reject 只上报意图
- **WHEN** 用户对某 hunk 点击 accept/reject
- **THEN** Renderer MUST 仅产出 HunkDecisionIntent 并经 IPC 桥上报
- **AND** 实际 diff 计算与正文拼回 MUST 在后端（surgical-refactor 的 spliceAcceptedHunks）执行
- **AND** Renderer MUST NOT 执行 diff 计算或正文写入业务逻辑

#### Scenario: 按证据引文定位并高亮
- **WHEN** 作者选中一条带证据引文的审校问题
- **THEN** 正文轴 MUST 在文档中定位该引文文本、滚动到可视区域并施加高亮 decoration
- **AND** 取消选中或切换章节时 MUST 清除该高亮
- **AND** 引文在当前文档中无法定位时 MUST NOT 施加错位高亮

### Requirement: 标注锚定防漂移落地
所有标注 MUST 以稳定标识符 + ProseMirror 位置锚定，文档编辑时用 ProseMirror mapping 修正偏移，无法映射即失效。

#### Scenario: 编辑后按 mapping 修正
- **WHEN** 文档在存在标注时被编辑
- **THEN** 系统 MUST 用 ProseMirror Transaction 的 mapping 修正标注的 from/to（remapped）
- **AND** 高亮/hunk MUST NOT 漂移或错位

#### Scenario: 无法映射即失效
- **WHEN** 某标注因文档变化无法安全映射
- **THEN** 系统 MUST 将其标记为 invalidated 并提示重新计算
- **AND** MUST NOT 在错误位置渲染该标注

#### Scenario: 锚点复用稳定标识符
- **WHEN** 为一个标注建立锚点
- **THEN** 其 MUST 使用 electron-shell-ui 的 AnnotationAnchor（NodeRef + ProseMirror 位置）
- **AND** MUST NOT 使用会随编辑失效的裸文本位置作为唯一锚

