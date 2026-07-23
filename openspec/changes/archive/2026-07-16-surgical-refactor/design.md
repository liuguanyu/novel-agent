## Context

外科手术式重构是本产品保护作者原创的核心机制：AI 只对“坏片段”做局部改写，程序以 diff/hunk 形式呈现，
作者逐 hunk 裁决，好文笔分毫不动。这直接落实 config 的核心交互不变量（写入必走局部 Diff、逐 hunk 接受、
绝不整章覆盖；重构 agent 只见待修片段）。本 change 只定义片段圈定、diff 引擎与 hunk 评审语义，不做召唤
入口、不做 diff 视图控件、不写代码。

## Goals / Non-Goals

**Goals:**
- 重构 agent 只接收待修片段 + 指令 + 只读上下文，隔离“好的部分”。
- 计算原文 vs 改写的最小 diff 并拆成可独立接受/拒绝的 hunk（utilityProcess）。
- 逐 hunk accept/reject，接受项精确拼回，未接受项原文不动；无整章覆盖路径。
- hunk 锚点复用稳定标识符，评审期文档编辑不导致拼回错位。
- 接受的变更作为可回滚步进入 checkpointer/事实版本。

**Non-Goals:**
- 不实现召唤入口与命令协议（on-demand-summon）。
- 不实现 diff 视图/accept-reject 控件（electron-shell-ui）。
- 不定义重构 agent 的提示词（agent-orchestration/prompt-loading）。
- 不编写实现代码。

## Decisions

### D1. 片段圈定：只喂坏片段
- 程序 MUST 从选区或指定节点范围裁出“待修片段”，连同作者指令与必要只读上下文（相关事实）交给重构 agent。
- 重构 agent MUST NOT 看到片段之外“写得好、无需改”的周边正文（防止连带改写）。
- 裁片段时 MUST 记录其稳定标识符锚点与在正文内的位置偏移，供拼回定位。

### D2. diff 引擎：最小差异 + hunk 拆分
- 系统 MUST 对“原片段 vs agent 改写”计算最小差异，拆分为可独立接受/拒绝的 hunk。
- 每个 hunk MUST 携带：锚点（稳定标识符 + 偏移）、原文、改写文本。hunk 结构 MUST 强类型，禁用 any。
- diff 计算属 CPU 密集，MUST 在 utilityProcess/worker 执行，主进程事件循环 MUST NOT 阻塞。

### D3. 逐 hunk 评审：绝不整章覆盖
- 作者 MUST 能对每个 hunk 独立 accept/reject。
- 被接受的 hunk MUST 精确拼回其原位；未被接受的部分原文 MUST NOT 改动。
- 系统 MUST NOT 提供“整章/整节点一键覆盖原文”的路径（对齐核心交互不变量）。

### D4. 锚点稳定性与偏移修正
- hunk 定位 MUST 基于 story-workspace 稳定标识符（重命名/移序/编辑不漂移）。
- 评审期间文档若被编辑，系统 MUST 按 ProseMirror 位置映射修正 hunk 偏移，防止拼回错位；
  无法安全映射时 MUST 标记该 hunk 失效并提示重新计算，MUST NOT 盲目拼回。

### D5. 变更可回滚
- 接受 hunk 产生的正文变更 MUST 作为可回滚步进入 checkpointer 与事实版本（供 human-in-the-loop
  time-travel 回退/分叉）。

### D6. 进程归属
- diff 计算在 utilityProcess（CPU 密集）；片段裁剪、拼回与状态写入的编排在 Main；hunk 经 IPC 传输；
  Renderer 只渲染 diff 与收集 accept/reject，不含业务逻辑。

## Risks / Trade-offs

- **风险：agent 改写偏离片段边界（越界改动）。** 缓解：只喂片段 + diff 仅在片段范围内计算，越界内容不产生 hunk。
- **风险：评审期并发编辑导致偏移失配。** 缓解：ProseMirror 映射修正 + 无法映射即失效重算，绝不盲拼。
- **风险：细碎 hunk 过多影响体验。** 取舍：可按语义合并相邻 hunk（呈现层），但 accept/reject 粒度仍以
  hunk 为准；合并策略细节留给 electron-shell-ui。
- **权衡：每次接受都落 checkpoint 增加存储。** 取舍：可回滚性是产品价值核心，值得。
