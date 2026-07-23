## Context

编排层用 LangGraph.js 把数据支柱与地基编织成可运行的多智能体系统：有状态、可路由、可循环、可中断、
可持久化。它是“副驾开车”的引擎，也是 human-in-the-loop、召唤、重构、总检的共同运行基座。本 change
定义状态、图、节点契约、提示词加载与 checkpointer，不实现上层控制面，不写代码。

提示词借鉴 LibriScribe（MIT）的角色分工与 YAML 外置结构（存档于 `references/libriscribe-prompts/`），
但本项目要求结构化、可锚定输出（问题带 type/severity/锚点/是否需人工决策）。

## Goals / Non-Goals

**Goals:**
- 定义精确类型的共享状态与 reducer 语义（对话累加、activeBugs 可覆写等）。
- 定义 supervisor 路由 + 专家节点的图拓扑，支持条件路由与写-审-改循环。
- 定义 agent 节点的单一职责契约与输出 schema 校验。
- 定义 YAML 外置提示词的加载、变量填充、缺失回退与能力档位声明。
- 定义 SQLite checkpointer，在节点边界持久化状态并产出可查询的 checkpoint 标识。

**Non-Goals:**
- 不实现 interrupt/resume/abort/time-travel 的控制面（human-in-the-loop）。
- 不实现召唤命令路由（on-demand-summon）。
- 不实现重构 diff 计算与应用（surgical-refactor）。
- 不实现全书总检调度与仪表盘（global-audit）。
- 不编写实现代码。

## Decisions

### D1. 共享状态 NovelState（精确类型 + reducer）
- 用 LangGraph.js `Annotation.Root` 风格定义状态，字段精确类型，禁用 any。
- 关键字段（示意，最终以类型定义为准）：
  - `currentChapterId` / 相关章节标识（复用 story-workspace 稳定标识符）
  - `currentDraft`（当前正文草稿片段）
  - `chatHistory`（对话历史，**累加 reducer**，messages 风格）
  - `activeBugs`（一致性问题列表，**可覆写 reducer**——支持作者增删改某个 bug）
  - `currentAction`（当前动作/召唤命令，供路由）
  - `agentStatus`（writing/reviewing/paused_by_user 等）
  - 事实库/素材库以引用（版本/作用域）方式进入上下文，不整库塞入状态。
- reducer 语义 MUST 明确：对话累加、activeBugs 可被人工覆写（对应 story-bible 的 requiresHumanDecision）。

### D2. 图拓扑：supervisor 路由 + 专家节点 + 循环
- 入口经 supervisor（对应 LibriScribe 的 project_manager）按 `currentAction`/意图路由到专家节点。
- 专家节点（借鉴 LibriScribe 分工）：writer（章节写手）、scene-generator、reviewer（内容审稿）、
  fact-checker（事实/一致性核查）、editor（编辑）、style-editor（文风）、architect（大纲/复盘，
  对应 outliner）、character-generator、worldbuilding 等。
- 支持条件路由（addConditionalEdges）与循环（写→审→改→再审）。
- 图 MUST 是**同一张有状态图**，召唤只是改变下一跳的路由，不新建无状态单发图（为 on-demand-summon 铺垫）。

### D3. agent 节点契约（单一职责）
- 每个节点 MUST 仅：组装 prompt（填充 YAML 模板）→ 调用 model-adapter（按其能力档位）→
  解析输出并经 schema 校验 → 将强类型结果写入共享状态。
- 节点 MUST NOT 直接持久化、发 IPC、操作 UI（这些由编排框架/上层负责）。
- 产出结构化结果时（如 reviewer/fact-checker 产出 activeBugs），MUST 遵循 story-bible 的一致性
  问题模型契约。

### D4. YAML 外置提示词加载
- 提示词以 YAML 外置：`name`/`description`/`template`（含 `{变量}` slot）/`variables.required`/
  `settings`（含能力档位）。结构对齐 LibriScribe 模板，便于移植。
- 加载器 MUST：运行时加载模板、校验必填变量齐备、填充 slot、模板缺失时回退（内置默认或报错，
  不静默产出错误 prompt）。
- 提示词与代码解耦：修改 persona/风格 MUST 仅改 YAML，不改代码。
- 各节点通过档位声明选择模型（prose/reasoning/cheap-fast），经 model-adapter 解析。

### D5. checkpointer（节点边界持久化）
- 使用 SQLite 作为 checkpointer，在每个节点边界（super-step）持久化图状态。
- 每次 checkpoint 产出可查询的 **checkpoint 标识**，供：
  - human-in-the-loop 的 time-travel（回滚/分叉）
  - story-bible 的事实版本对齐（fact-versioning 的 checkpoint 关联）
- 关键性质：由于持久化在节点边界，流式生成中途 abort 时当前节点未提交，最近 checkpoint 天然为
  “干净态”——为 human-in-the-loop 的 abort 语义提供基础。
- checkpointer 读写为异步 I/O，归 Main。

## Risks / Trade-offs

- **风险：状态膨胀（把整库塞进 state）。** 缓解：事实/素材以引用（版本/作用域）进入，节点按需检索。
- **风险：图拓扑复杂导致难维护。** 缓解：supervisor 集中路由 + 节点单一职责 + 统一节点契约。
- **风险：LangGraph.js API 演进。** 缓解：节点契约与状态定义与框架细节隔离，降低耦合。
- **权衡：checkpoint 粒度（节点边界）。** 取舍：节点边界足以支撑 abort/time-travel/版本对齐，
  避免逐 token 持久化的开销。
