## Why

I1 让应用第一次端到端跑通（真读小说 + 真 LLM 流式 + 三轴 UI），I2 把它升级为可持久化本地项目（`workspace.json` / `manuscript.json` / Markdown 正文 + SQLite checkpoint/事实库底座）。但当前对话仍是 **`ipc-handlers.ts` 里的单 agent 直调**：一次召唤 = 组 prompt → 单模型 stream → 回推，**没有编排、没有状态机、没有手刹**。

- 无 supervisor 路由：写手/审校/连续性检查等专家角色无法协作，"写→审→改→再审"的迭代环路不存在。
- 无共享状态运行时：`NovelState` / reducer / `ContextRefs` 仍只是 core 契约，没有被任何运行时驱动。
- 无手刹：作者无法在 agent 跑一半时中断、带决策恢复、或回溯到某个 checkpoint 重来（time-travel）。I2 建好的 `SqliteCheckpointer` 还没有任何编排在往里写。
- 无历史事实召回：作者说"上一章那个伏笔""第 16 章有相关描述"时,系统只能靠把正文塞进 prompt,既不结构化、也不能在作者记错章号时纠偏。I2 建好的 `SqliteFactStore`（entities/plot_hooks/timeline…）读接口还没有任何对话回合在查。

本 change 是实现阶段第三波（I3），也是路线图标注的"最硬一波、产品灵魂"：把内存态单 agent 直调**升级为 LangGraph 多智能体真编排**，让共享状态、checkpoint、手刹（中断/恢复/时间旅行）真正跑通，并接上"作者指涉历史事实/伏笔 → 结构化召回 → 冲突时纠偏问话"的检索回路。

## What Changes

- **LangGraph 编排运行时**：在 Main 侧落地单一有状态 `StateGraph`，以 `NovelState`（复用 core 契约、含既有 reducer 语义）为共享状态，`SqliteCheckpointer` 为持久化 checkpointer。supervisor 入口按 `currentAction`/召唤命令路由到专家节点（本波至少 writer + reviewer，形成"写→审→改→再审"可迭代环路），新专家节点可扩展接入而不破坏既有节点。
- **召唤复用有状态图**：`ipc-handlers.ts` 的 `summon-run` 从"单 agent 直调"改为"向同一张持久化图注入命令改变下一跳路由"，MUST NOT 为每次操作新建无状态单发图。LLM 流式分片继续经既有 `dialogueStream` / `BackendStreamMessage` 回推。
- **手刹：条件性中断 + 带决策恢复**：审校/连续性节点发现需作者裁决的问题时，以强类型 payload（复用 `ConsistencyIssue` / `activeBugs`）**条件性中断**（无需介入则不挂起）；作者经 control-event 通道以 approve / reject / modify 三类决策恢复，修改后覆写状态并从挂起点继续，MUST NOT 重跑已完成节点。接通 I2 起搁置的 `resume-run` 语义。
- **手刹：时间旅行**：作者可沿 checkpoint parent 链回溯到任一历史 checkpoint 并从该点重开分支运行（复用 I2 `SqliteCheckpointer.history`）。
- **历史事实检索与上下文组装**：落地 `context-assembly` 运行时——按 agent + scope 从 `SqliteFactStore` 结构化召回相关事实（实体/伏笔/时间线，各带 provenance 出处章节），以引用而非整库进入 `NovelState.contextRefs`。
- **软锚点检索 + 章号纠偏**（human-in-the-loop 核心体验）：
  - **硬锚点**（`SummonCommand{scope:node/selection}`，作者鼠标精确指定）：忠实照做，MUST NOT 自作主张扩散到其他章节。
  - **软提示**（对话自然语言提及"第 3 章那个伏笔"）：按内容/实体/伏笔语义召回，作者陈述的章号**仅作软排序提示、MUST NOT 硬过滤**。
  - **纠偏回路**：当召回命中的真实 provenance 与作者陈述章号不一致时，系统 MUST 产出确认/纠偏提示交作者裁决（候选按接近度排序、标注"最接近"但 MUST NOT 默认替作者勾选），MUST NOT 静默采用任一方。
  - **冲突硬阻断**：当作者指令与事实库既有事实冲突（如"让某角色首次登场"但其已在前文登场）时，系统 MUST 硬阻断并要求作者裁决；但 MUST 始终提供"知情放行"（照作者说的写）的逃生选项。
- **进程归属**：编排图与 agent 执行位于 Main（或 utilityProcess），绝不在 Renderer；CPU 密集的大规模检索/大文本装配 MUST 在 utilityProcess。Renderer 仍只经 preload 桥收发强类型消息。

## Capabilities

### New Capabilities

- `orchestration-runtime`: LangGraph 有状态图的 Main 侧运行时实现（supervisor + 专家节点 + 条件路由/循环 + checkpointer 接线）。
- `historical-fact-retrieval`: 对话/召唤中对历史事实与伏笔的结构化召回、软锚点 vs 硬锚点语义、章号纠偏与冲突阻断回路。

### Modified Capabilities

- `orchestration-graph`: 从纯契约推进为 Main 侧 LangGraph 运行时（单一有状态图、supervisor 路由、写-审-改循环真跑通）。
- `orchestration-state`: `NovelState` / reducer / `ContextRefs` 从契约推进为驱动运行时图的实际共享状态。
- `context-assembly`: 从契约推进为按 agent+scope 组装上下文的运行时（事实以引用进入、密集检索归 utilityProcess）。
- `interrupt-resume`: 从契约推进为真中断/恢复运行时（条件挂起 + approve/reject/modify + 从挂起点继续）。
- `time-travel`: 从契约推进为沿 checkpoint 链回溯并重开分支的运行时。
- `main-backend-slice`: `summon-run` 从单 agent 直调改为向有状态图注入命令；接通 `resume-run`。

## Impact

- 依赖 `persistence-sqlite`（I2：`SqliteCheckpointer` / `SqliteFactStore` / DB 生命周期）、`walking-skeleton`（I1：Electron/preload/IPC/LLM adapter 竖切）、`agent-orchestration`（`NovelState`/reducer/`ContextRefs`/checkpointer 契约）、`human-in-the-loop`（interrupt-resume/time-travel 契约）、`on-demand-summon`（`SummonCommand`/context-assembly 契约）、`story-bible`（事实/伏笔/provenance 模型）、`bootstrap-foundation`（进程模型、工程规范）。
- 新增运行时依赖：LangGraph.js（`@langchain/langgraph`）。选版需与 Electron 37 内置 Node 22 兼容；`NOVEL_STATE_REDUCERS` 到 LangGraph `Annotation` 的桥接在实现层完成，core 契约不耦合框架类型（对齐 orchestration-state design「框架演进」风险）。
- LLM 密钥继续只在 `config/models.json`，MUST NOT 进入 SQLite / 日志 / checkpoint state。
- 本波不做事实自动抽取（I4：读正文→入库仍为空表手工/最小写入）、不做全书总检 worker（I5）、不做局部重构 diff 拼回（I6）、不做素材 embedding 检索（I7，本波 corpus 检索可留桩）。
