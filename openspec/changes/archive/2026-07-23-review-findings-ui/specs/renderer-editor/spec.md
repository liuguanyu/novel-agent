## MODIFIED Requirements

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
