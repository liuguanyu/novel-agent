## Why

前面的 change 定义了数据支柱（正文、事实库、素材库）与地基（进程/IPC/模型适配）。现在需要把它们
编织成一个可运行的多智能体系统——**编排层**。它用 LangGraph.js 构建一张有状态、可路由、可循环、
可中断、可持久化的图，让写手、审稿、事实核查、编辑、文风、架构师等专家协同工作。

编排层是“副驾开车”的引擎：它承载共享状态、supervisor 路由、各 agent 节点、YAML 提示词加载，
以及 checkpointer（供 human-in-the-loop 与事实库版本对齐）。它不直接实现中断/回滚的控制面
（human-in-the-loop）、召唤（on-demand-summon）、重构 diff（surgical-refactor），但为它们提供
底层的图、状态与 checkpoint 基础设施。

本 change 定义编排的状态模型、图拓扑、agent 节点契约、提示词加载与 checkpointer（spec 层面），
不写代码。

## What Changes

- 定义 **共享状态模型（NovelState）**：以精确类型（Annotation.Root 风格）承载正文上下文、章节标识、
  对话历史（累加 reducer）、活跃问题 activeBugs（可覆写 reducer）、当前动作、agent 状态等。
- 定义 **图拓扑**：supervisor 路由 + 专家节点（writer/reviewer/fact-checker/editor/style-editor/
  architect/character/worldbuilding 等），支持条件路由与循环（写→审→改环路）。
- 定义 **agent 节点契约**：每个节点只“组 prompt → 调模型 → 解析输出（schema 校验）”，产出写入
  共享状态，不碰持久化/IPC/UI。
- 定义 **YAML 提示词加载**：外置 YAML（persona + 变量 slot + settings + 能力档位），运行时加载、
  变量填充、缺失回退；借鉴 LibriScribe 的模板结构（存档于 references/）。
- 定义 **checkpointer**：以 SQLite 持久化图状态于节点边界（super-step），产出 checkpoint 标识，
  供 human-in-the-loop 的 time-travel 与 story-bible 的版本对齐使用。
- 定义 **per-agent 模型档位绑定**：每个 agent 声明能力档位，经 model-adapter 解析到具体模型。

## Capabilities

### New Capabilities
- `orchestration-state`: 共享状态模型与 reducer 语义。
- `orchestration-graph`: 图拓扑、supervisor 路由、专家节点与循环。
- `agent-node-contract`: agent 节点职责契约与输出 schema 校验。
- `prompt-loading`: YAML 外置提示词加载、变量填充与档位声明。
- `checkpointer`: 状态持久化于节点边界、checkpoint 标识与查询。

### Modified Capabilities
<!-- 无。 -->

## Impact

- 依赖 `bootstrap-foundation`（进程/IPC/模型适配/规范）、`story-workspace`（正文读写对象）、
  `story-bible`（审稿/核查对撞对象、版本对齐）、`corpus-library`（写作素材上下文）。
- 为 `human-in-the-loop`（interrupt/resume/abort/time-travel 依赖 checkpointer 与状态）、
  `on-demand-summon`（召唤即向图注入命令）、`surgical-refactor`（重构节点产出 diff）、
  `global-audit`（复用节点与提示词）提供运行基座。
- 编排与 agent 执行位于 Main 进程或 utilityProcess，绝不在 Renderer（遵循 process-model）。
- checkpointer 使用 SQLite（异步 I/O，归 Main）。
