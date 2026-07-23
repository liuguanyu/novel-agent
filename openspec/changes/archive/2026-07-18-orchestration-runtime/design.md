## Context

I2 建好了持久化底座（`SqliteCheckpointer` / `SqliteFactStore` / DB 生命周期），但对话仍是 `ipc-handlers.ts` 里的单 agent 直调，没有编排、状态机、手刹。core 侧 `NovelState` / reducer / `ContextRefs` / `SummonCommand` / `ConsistencyIssue` 等契约齐备但无运行时驱动。I3 要在不重设计契约的前提下，把这些"预制构件"接成一台真正会开车、且随时能被作者拉手刹的机器。

## Goals / Non-Goals

**Goals:**

- Main 侧单一有状态 LangGraph 图，以 `NovelState` 为共享状态、`SqliteCheckpointer` 为 checkpointer。
- supervisor + 至少 writer/reviewer 专家节点，"写→审→改→再审"条件循环真跑通。
- 手刹：条件性中断（有问题才挂起）+ approve/reject/modify 恢复（不重跑已完成节点）+ time-travel（沿 checkpoint 链回溯重开）。
- 历史事实/伏笔结构化召回，接入上下文组装；软锚点 vs 硬锚点语义；章号纠偏 + 冲突硬阻断。
- 召唤复用同一张持久化图（注入命令改路由），而非每次新建单发图。

**Non-Goals:**

- 不做事实自动抽取（I4）：本波 fact-store 仍靠 I2 的最小写入 API 或测试夹具填数据；检索读的是既有内容。
- 不做全书总检 worker（I5）、局部重构 diff 拼回（I6）、素材 embedding 检索（I7，corpus 检索留桩）。
- 不在 Renderer 跑图/agent/检索；不改 preload 桥的既有查询/控制通道形状（只接通 resume 语义）。
- 不做多用户协同 / 图的并发多 run 调度优化（本波单活跃 run 足够）。

## Decisions

### D1. LangGraph 运行时归 Main，core 契约不耦合框架

- 图的构建与执行在 Main（`src/main/orchestration/`）。core 侧只保留框架无关的 `NovelState` / reducer 语义标签（`NOVEL_STATE_REDUCERS`）。
- 实现层写一个 bridge：把 `NOVEL_STATE_REDUCERS` 的 `append`/`overwrite` 映射到 LangGraph `Annotation.Root` 的 reducer。理由：对齐 orchestration-state design「框架演进」风险，日后换编排框架不动 core。

### D2. 召唤 = 向有状态图注入命令，不新建单发图

- `summon-run` 把 `SummonCommand` 写进图状态的 `currentAction` 并触发下一跳，supervisor 据此路由。
- 图与其 checkpointer 长驻（按 runId / workspace 维系），MUST NOT 每次召唤 `new StateGraph()`。对齐 orchestration-graph「单一有状态图」。

### D3. 手刹三态基于 checkpointer

- **中断**：节点内条件性 `interrupt()`，payload 为强类型（`ConsistencyIssue[]` 等，禁 any），经 control-event 通道带 runId 推给 Renderer。无需介入则不挂起。
- **恢复**：作者经 `resume-run` 回传 approve/reject/modify + 决策数据；modify 覆写 `activeBugs`（走 overwrite reducer）后从挂起点继续，靠 checkpointer 状态不重跑已完成节点。
- **时间旅行**：读 `SqliteCheckpointer.history(id)` 沿 parent 链取历史 checkpoint，选定某点作为新分支起点重开。checkpoint id 即 time-travel 与 fact-version 的对齐锚（I2 已对齐标识空间）。

### D3.5. Checkpointer 采用「两个时间尺度」而非合成一套（方案 A，已与作者定案）

经查实：LangGraph 的 `interrupt()`→`Command({resume})` 挂起/续跑机械**必须**有一个 LangGraph checkpointer 才成立；而其唯一的官方持久 saver `@langchain/langgraph-checkpoint-sqlite` 底层依赖 `better-sqlite3`（native / ABI 绑定）——正是 I2 升 Electron 33→37（拿 Node 22 内置 `node:sqlite`）要躲开的东西。

**决策（方案 A，零 native 依赖走到底）：**

| 层 | 承担 | 生命周期 | 后端 |
|---|---|---|---|
| **运行态 checkpoint** | 图跑一半挂起、等作者答复、原地续跑（问话/纠偏/冲突骑在此管道上） | 秒~分钟，会话内，天生短命 | LangGraph `MemorySaver`（内存，零 native） |
| **里程碑态 checkpoint** | 作者可见的历史 time-travel、fact-version 锚（I4/I6 指着它） | 天~跨会话，必须持久 | I2 的 `SqliteCheckpointer`（`node:sqlite`） |

二者**非冗余**：是同一 checkpoint 概念在两个不同寿命上的体现，强行合成一套反而不合理（要么把短命态硬持久化=引 native，要么把持久态塞内存=重启全丢）。语义逻辑（纠偏/冲突/问话）在节点里、不在 saver 里，故换 saver 不丢特性。

**为何不选方案 B（官方持久 SqliteSaver 真·一套）：** B 能补一个边角（App 关闭时正卡在问话上→重启后原地续挂起态），但代价是①请回 `better-sqlite3` ABI 坑；②理性上应连 I2 数据层一并迁到 `better-sqlite3`（否则 app 内并存两个 SQLite 驱动），= 部分 I2 返工 + 让升 Node 22 的理由作废。用如此大代价换一个对本地单人写作工具几乎不发生的边角（真发生重新召唤一句即可），不划算。

**方案 A 唯一牺牲**：跨 App 重启后，LangGraph 图引擎内部的半途中断态不自动恢复；但语义 checkpoint 仍在，作者可从任一历史 checkpoint 重开分支（task 5.2 本就要做）。**升级路径**：待社区/官方出 `node:sqlite` 版持久 saver，把 MemorySaver 一换即真·收成一套，且因状态桥（D1）不动 core、不丢特性。

### D4. 历史事实检索：软锚点 vs 硬锚点（本 change 的体验核心）

作者指涉历史有两种意图，检索层 MUST 区分：

| 意图来源 | 例子 | 检索语义 |
|---|---|---|
| **硬锚点** | 划词 / 点章 → `SummonCommand{scope:node/selection}` | 忠实照做，只看该锚点范围，MUST NOT 扩散到别的章 |
| **软提示** | 对话自然语言"第 3 章那个伏笔" | 按内容/实体/伏笔语义召回；作者说的章号仅作软排序提示，MUST NOT 硬过滤 |

召回走 `SqliteFactStore` 结构化查询（实体名/别名匹配、plot_hook 状态/描述、timeline），每条命中带其真实 provenance（出处章节 NodeRef + 引文）。以引用进 `NovelState.contextRefs`，不塞整库（对齐 orchestration-state / context-assembly）。

### D5. 章号纠偏与冲突：帮你看清，但不替你踩；要撞墙先停，你坚持就放行

两个"手刹力度"旋钮，已与作者确认默认值：

- **纠偏（作者可能记错章号）**：软召回命中的真实 provenance 与作者陈述章号不一致时 → 产出确认/纠偏提示。候选**按接近度排序、可标注"最接近"，但 MUST NOT 默认替作者勾选**（排序是帮忙，勾选是越权）。作者裁决前 MUST NOT 静默采用任一方。
- **冲突（作者指令撞事实库）**：如"让某角色首次登场"但其已在前文登场 → **硬阻断**，不裁决不落笔。但选项里 MUST 永远留"知情放行（照我说的写，我知道会矛盾）"的逃生门，一键放行。理由：冲突意味着照写必然矛盾，正是手刹存在的意义；但作者拥有最终主权。

### D6. 进程归属

- 图/agent/中断在 Main（或 utilityProcess）。CPU 密集的大规模检索 / 大文本装配 MUST 在 utilityProcess（对齐 context-assembly / corpus-retrieval「进程归属」）。本波检索量小可先在 Main 非阻塞执行，但接口按"可迁移到 utilityProcess"设计。
- Renderer 只经 preload 桥收发强类型消息，MUST NOT 触碰图/db/fs/llm。

## Risks / Trade-offs

- **LangGraph.js 与 Electron 37 / Node 22 兼容性**：选版时验证；若 ESM/CJS 或 Node API 有坑，bridge 层隔离，必要时回退到自建最小状态机（core 契约不变，风险可控）。**已验证（task 1.1）**：`@langchain/langgraph@1.4.8` + `@langchain/core@1.2.3` 在 `ELECTRON_RUN_AS_NODE=1` 的 Electron 37.10.3 / Node 22.21.1 下最小 StateGraph invoke 跑通；peer `zod ^3.25.32` 已由现装 `zod@3.25.76` 满足。
- **图长驻的生命周期**：按 runId/workspace 维系图实例，需在 will-quit / 切换工作区时清理，避免泄漏。
- **软召回的准确率**：本波用结构化匹配（名字/别名/伏笔描述关键词），非向量语义（那是 I7）。可能漏召或误召——正因如此才要 D5 的"列候选交作者裁决"，不追求一次命中。
- **中断/恢复不重跑的正确性**：依赖 checkpointer 在节点边界的干净提交（I2 已保证"中途 abort 不提交")。恢复路径需 smoke 覆盖"modify 后不重跑已完成节点"。

## Migration / Rollout

- `ipc-handlers.ts` 的 `summon-run` 改造保持对 Renderer 的消息形状不变（仍 `dialogueStream` 回推），Renderer 无感。
- `resume-run` 从 I2 的空实现接通真语义。
- 无数据迁移：复用 I2 的 DB schema（checkpoint/fact 表），不加 migration（除非检索需要索引，则追加 v2 migration）。

## Open Questions

（无未决项。）本波专家节点为 supervisor + writer + reviewer；**连续性检查作为 reviewer 节点内的一个检查步骤，不独立铺 fact-checker 节点**（先不铺开节点数，冲突硬阻断由 reviewer 内的连续性检查步骤触发）。日后需要独立 fact-checker 时再按 orchestration-graph「专家节点可扩展」以新节点接入。
