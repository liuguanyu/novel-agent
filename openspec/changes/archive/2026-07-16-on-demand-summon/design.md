## Context

按需召唤把 agent-orchestration 的有状态图暴露为“随叫随到的兵器谱”：作者在任意时刻圈选、敲 Cmd+K 或点
侧边栏，就能定向调用某个专家 agent 干一件具体的活，干完立刻把控制权还回来。召唤的本质是**向同一张持久
化图注入命令**，不是新建一次性无状态图（见 orchestration-graph“单一有状态图”）。本 change 只定义命令
协议、上下文组装与执行语义，不做 UI 控件、不做 diff 计算、不写代码。

## Goals / Non-Goals

**Goals:**
- 三入口产出统一命令协议（agent + scope + anchor + mode + 可选 instruction）。
- 按 agent 与 scope 自动组装上下文（选区/相关事实/相关素材/对话历史），以引用/检索进入，不塞整库。
- 召唤=向持久图注入命令改路由，复用共享状态与 checkpointer，干完交还控制权。
- 明确 diagnose（只读）与 mutate（走局部 diff）两种语义边界。

**Non-Goals:**
- 不实现三入口的具体控件与视觉（electron-shell-ui：气泡/命令面板/侧边栏）。
- 不实现 mutate 的 diff 计算与逐 hunk 接受（surgical-refactor）。
- 不定义 agent 本身或其提示词（agent-orchestration）。
- 不编写实现代码。

## Decisions

### D1. 统一命令协议（入口无关）
- 一条召唤命令 MUST 含：`agent`（目标专家标识）、`scope`、`anchor`（稳定标识符 + 选区偏移，可空表示无选区）、
  `mode`（`diagnose` | `mutate`）、可选 `instruction`（作者自然语言）。
- 三入口仅在“如何产生这条命令”上不同；产出的命令结构 MUST 完全一致，后端不区分来源。
- 命令 MUST 为强类型（Zod 校验），禁用 any。

### D2. scope 分级并复用稳定标识符
- `scope` ∈ { `selection`（选区）, `node`（场景/章/卷节点）, `document`（当前全文）, `project`（跨项目，
  仅对素材类 agent 有意义） }。
- selection/node 的定位 MUST 复用 story-workspace 的稳定标识符（重命名/移序/改文不漂移），
  selection 附加 ProseMirror 位置偏移。

### D3. 注入而非新建（复用有状态图）
- 召唤 MUST 通过向持久化图注入命令、改变 `currentAction`/下一跳路由实现（见 orchestration-graph）。
- MUST NOT 为每次召唤新建脱离共享状态与 checkpointer 的一次性图。
- 被召唤 agent 干完活 MUST 把控制权交还作者：无写入的 diagnose 走到 END 返回诊断；有写入的 mutate
  按 human-in-the-loop 挂起，待作者逐 hunk 裁决。

### D4. 上下文自动组装（引用/检索，非整库）
- 组装器 MUST 按 `agent` 与 `scope` 装配输入：selection/node 正文文本、相关事实（story-bible 按作用域/
  版本引用检索）、相关素材（corpus-library 语义检索）、近期对话历史（orchestration-state 的 chatHistory）。
- MUST NOT 将整个事实库或素材库塞入；MUST 以引用/检索结果进入（对齐 orchestration-state“以引用进入状态”）。
- 不同 agent 组装策略不同（如审稿官重事实对撞、写手重素材与对话指令）；组装策略 MUST 可按 agent 声明。
- 语义检索/大文本装配若属 CPU 密集 MUST 在 utilityProcess，主进程事件循环 MUST NOT 阻塞。

### D5. diagnose vs mutate 双语义
- `diagnose` MUST 只读：产出结构化诊断（复用 story-bible 一致性问题模型），MUST NOT 修改正文。
- `mutate` MUST 经 surgical-refactor 的局部 diff 通道产出改写提案，逐 hunk 由作者接受/拒绝，
  MUST NOT 整章覆盖（对齐核心交互不变量）。
- 命令的 `mode` MUST 显式声明；后端 MUST 据此选择只读或写入路径，不得越权写入。

### D6. 经 IPC 命令通道
- 召唤命令 MUST 经 ipc-contract 通道下发，携带 runId；诊断/提案/错误作为一等消息回传。

## Risks / Trade-offs

- **风险：不同 agent 上下文组装策略发散、难维护。** 缓解：组装策略按 agent 声明为数据/配置，统一组装器执行。
- **风险：selection 偏移在文档编辑后漂移。** 缓解：以稳定标识符为锚 + 偏移，编辑后按 ProseMirror 映射修正
  （细节归 editor-annotations）。
- **风险：mode 被误用导致意外写入。** 缓解：mode 强类型显式声明，后端按 mode 严格分流，diagnose 路径无写权限。
- **权衡：跨项目 project scope 仅对素材有效，增加分支判断。** 取舍：素材库本就跨项目共享，值得。
