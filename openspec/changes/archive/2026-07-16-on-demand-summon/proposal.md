## Why

自动流水线之外，作者要能**随时把某个职责的 agent 呼出来干具体的活**：划词让审稿官盘一段的逻辑、
Cmd+K 唤架构师看全局大纲、右键让写手把一段洗出天津卫味儿。这就是从“自动拖拉机”变成“作者延伸出去
的金手指”——控制权始终在作者手里，AI 只在被召唤时充当特定职能挂件。

召唤不是新建一次性图，而是**向 agent-orchestration 的同一张持久化有状态图注入一条命令**，改变下一跳
路由，让目标 agent 干完活立刻把控制权弹回作者（走到 END/挂起），共享状态与 checkpointer 全程连续。

召唤要解决三件事：**统一命令协议**（哪个 agent、作用在什么范围、带什么光标/选区）、**上下文自动组装**
（把选区、相关事实、相关素材、对话历史拼成该次调用的输入，而非塞整库）、**双语义**（diagnose 只读诊断
 vs mutate 走局部 diff 写入）。

本 change 定义召唤的命令协议、上下文组装与执行语义（spec 层面）。三种入口的具体控件（气泡/命令面板/
侧边栏）属 electron-shell-ui；重构 diff 的计算与逐 hunk 接受属 surgical-refactor；不写代码。

## What Changes

- 定义 **统一召唤命令协议**：一条命令 MUST 声明 `agent`（目标专家）、`scope`（作用范围）、
  `anchor`（光标/选区的稳定标识符定位）、`mode`（diagnose/mutate）、可选 `instruction`（作者自然语言指令）。
  三入口（划词气泡 / Cmd+K 命令面板 / 侧边栏工具箱）产出**同一种命令**，仅入口不同。
- 定义 **作用范围 scope**：selection（选区）/ node（场景/章/卷节点）/ document（全文）/ project（跨项目，
  仅素材类），复用 story-workspace 稳定标识符锚定。
- 定义 **上下文自动组装**：按 agent 与 scope 自动装配输入——选区正文、相关事实（按作用域/版本引用检索）、
  相关素材（语义检索）、近期对话历史；MUST NOT 塞整库，MUST 以引用/检索结果进入。
- 定义 **注入而非新建**：召唤 MUST 通过向持久化图注入命令改变 `currentAction`/路由实现，复用共享状态与
  checkpointer；干完活 MUST 把控制权交还作者（END 或按 human-in-the-loop 挂起）。
- 定义 **diagnose vs mutate 双语义**：diagnose MUST 只读、只产出诊断（不改正文）；mutate MUST 经
  surgical-refactor 的局部 diff 通道，MUST NOT 整章覆盖。

## Capabilities

### New Capabilities
- `summon-command`: 三入口统一召唤命令协议与 scope 定义。
- `context-assembly`: 按 agent+scope 自动组装调用上下文（引用/检索，非整库）。
- `summon-modes`: diagnose（只读诊断）与 mutate（走局部 diff）双执行语义。

### Modified Capabilities
<!-- 无。 -->

## Impact

- 依赖 `agent-orchestration`（注入命令改路由、复用有状态图与 checkpointer、`currentAction` 字段）、
  `story-workspace`（scope 的稳定标识符锚定）、`story-bible`（相关事实检索）、`corpus-library`
  （相关素材语义检索）、`human-in-the-loop`（mutate/诊断后挂起待裁决）、`bootstrap-foundation`（IPC 命令通道）。
- 为 `surgical-refactor`（mutate 的 diff 执行）、`global-audit`（可复用召唤审稿官做局部检查）、
  `electron-shell-ui`（三入口控件、命令面板、气泡菜单）提供命令与上下文契约。
- 召唤命令处理位于 Main/utilityProcess，绝不在 Renderer；语义检索/组装若 CPU 密集 MUST 在 utilityProcess。
