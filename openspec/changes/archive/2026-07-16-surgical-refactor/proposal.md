## Why

大模型“一改就改全章”是长篇创作的头号杀手：它会把作者写得极有味道的原创段落一起洗掉。本产品的核心
交互不变量是——**写入型操作必须走局部 Diff，逐 hunk 由作者接受/拒绝，绝不整章覆盖**。这保护了作者的
“好文笔”，让 AI 只做外科手术式的精准补丁。

要做到这一点，重构 agent **只能看到待修片段**，看不到“好的部分”。它接收一个坏片段 + 修正指令，返回
一段局部改写；由程序负责把改写与原文做 diff、拆成 hunk、拼回原位。作者对每个 hunk 单独接受或拒绝，
未接受的部分原文分毫不动。

diff 的锚定 MUST 复用 story-workspace 的稳定标识符（重命名/移序/编辑不漂移），使 hunk 能精确定位、
在文档变化后仍可靠映射。大文本 diff 属 CPU 密集，MUST 在 utilityProcess 计算，绝不阻塞主进程。

本 change 定义片段圈定、diff 引擎与逐 hunk 评审的语义与契约（spec 层面）。召唤入口属 on-demand-summon；
diff 的可视化控件属 electron-shell-ui；不写代码。

## What Changes

- 定义 **片段圈定（fragment scoping）**：重构 agent MUST 只接收待修片段（选区或指定节点范围）+ 作者指令
  + 必要的只读上下文（相关事实），MUST NOT 接收“写得好、无需改”的周边正文；程序负责裁出片段、记录其
  稳定标识符锚点与偏移。
- 定义 **diff 引擎（diff engine）**：对“原片段 vs agent 改写”计算最小差异，拆分为可独立接受/拒绝的
  hunk；每个 hunk MUST 携带锚点（稳定标识符 + 偏移）、原文、改写。diff 计算属 CPU 密集，MUST 在
  utilityProcess。
- 定义 **逐 hunk 评审（hunk review）**：作者对每个 hunk 独立 accept/reject；接受的 hunk 精确拼回原位，
  未接受的原文 MUST NOT 改动；MUST NOT 提供“整章覆盖”路径。
- 定义 **锚点稳定性**：hunk 定位 MUST 基于稳定标识符，文档在评审期间被编辑时 MUST 能按 ProseMirror
  映射修正偏移、防止拼回错位。
- 定义 **与 checkpoint 的关系**：接受 hunk 产生的正文变更 MUST 作为可回滚步进入 checkpointer/事实版本，
  供 human-in-the-loop time-travel。

## Capabilities

### New Capabilities
- `fragment-scoping`: 只喂待修片段给重构 agent，隔离“好的部分”。
- `diff-engine`: 原文 vs 改写的最小 diff 与 hunk 拆分（utilityProcess）。
- `hunk-review`: 逐 hunk 接受/拒绝、精确拼回、绝不整章覆盖。

### Modified Capabilities
<!-- 无。 -->

## Impact

- 依赖 `story-workspace`（稳定标识符锚定、正文读写）、`agent-orchestration`（重构节点产出改写）、
  `on-demand-summon`（mutate 召唤进入此通道）、`human-in-the-loop`（改写提案挂起待裁决、变更可回滚）、
  `bootstrap-foundation`（utilityProcess 承载 diff 计算、IPC 传输 hunk）。
- 为 `electron-shell-ui`（双栏 diff 视图、逐 hunk accept/reject 控件、TipTap 锚定高亮）与
  `global-audit`（一键修复走同一 diff 通道）提供写入契约。
- diff 计算位于 utilityProcess（CPU 密集），拼回与状态写入的编排位于 Main；绝不在 Renderer 做业务逻辑。
