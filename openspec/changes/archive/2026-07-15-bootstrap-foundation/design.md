## Context

“小说 IDE”由多个子系统组成：Electron 桌面壳、LangGraph.js 编排、SQLite 事实库、本地向量库、
多模型适配。它们共享同一套横切关注点：进程模型、IPC、类型规范、模型接口。本 change 固化这些地基，
后续能力域（story-workspace、story-bible、corpus-library、agent-orchestration、human-in-the-loop、
on-demand-summon、surgical-refactor、global-audit、electron-shell-ui）在此之上并行开发。

当前项目为空仓（仅有 `references/` 提示词存档与 `openspec/`）。本 change 不写实现代码，仅产出
契约与规范 spec。

## Goals / Non-Goals

**Goals:**
- 定义 Electron 三类进程职责边界与工作负载归属规则，杜绝 UI 卡顿的结构性成因。
- 定义强类型、可流式、可中断的 IPC 契约，三通道正交。
- 定义 per-agent 可配置、按能力档位声明、可流式可中断的模型适配层接口。
- 固化工程规范：TS strict、禁 any、职责单一、功能正交、LLM 输出 schema 校验。
- 定义顶层模块边界与依赖方向，防止子系统互相渗透。

**Non-Goals:**
- 不实现任何业务能力（写作、审稿、事实库、素材库、召唤、重构、总检等均由后续 change 负责）。
- 不选定具体模型/provider（仅定义接口与能力档位）。
- 不确定具体 UI 视觉设计（仅在 electron-shell-ui 定布局骨架）。
- 不编写实现代码；本阶段仅产出 spec。

## Decisions

### D1. 进程职责三分（Renderer / Main / utilityProcess）
- **Renderer**：仅渲染与交互，通过 IPC 与后端通信，不含任何业务逻辑、不直接访问文件系统/数据库/模型。
- **Main**：应用生命周期、窗口管理、协调，以及**异步 I/O**（LLM API 调用、SQLite 读写、文件读写）。
  依据：异步 I/O 基于 `await`，不占用事件循环，不会卡 UI。
- **utilityProcess / worker_threads**：**CPU 密集**任务（embedding 计算、大文本 diff、
  全书 Map-Reduce 总检、大文档解析）。依据：同步 CPU 工作会占满事件循环，即使在 Main 也会卡住 IPC → 卡 UI。
- 判定规则写入 spec：**“是否会长时间占用 CPU 同步执行”**是归属 utilityProcess 的唯一判据。

### D2. IPC 三通道正交
- **正文流通道（manuscript-stream）**：Writer 等产生正文 token 的流 → 编辑器。
- **对话流通道（dialogue-stream）**：Supervisor/各 agent 的思考与回复 → 右侧 Chat。
- **控制事件通道（control-event）**：interrupt 挂起、resume、abort、状态变更、错误。
- 所有消息为 discriminated union（以 `type` 判别），携带 `runId` 关联同一次运行，避免并发（边写边聊）串台。
- 后端→前端的流式消息与前端→后端的命令分别定义；错误作为一等消息类型，不用异常穿透 IPC。

### D3. 模型适配层按“能力档位”声明，不硬编码模型
- 统一接口 `ModelAdapter`：输入 messages + 选项（temperature、maxTokens、`AbortSignal`），
  输出流式 token 与最终结果。
- Agent 声明其需要的**能力档位**（如 `prose`/`reasoning`/`cheap-fast`），运行时由用户配置将档位映射到
  具体 provider+model。支持 per-agent 覆盖。
- 必须支持流式输出与 `AbortSignal` 中断（对应“随时拉手刹”省 token）。
- provider 差异（鉴权、请求格式、流式协议）封装在适配层内部，对上层 agent 透明。

### D4. 工程规范作为可校验约束
- TypeScript `strict: true`、`noImplicitAny: true`；ESLint `@typescript-eslint/no-explicit-any: error`。
- 未知数据用 `unknown` + 类型收窄；LLM 非结构化输出必须经 **Zod schema** 校验转强类型后方可进入系统。
- 职责单一：agent 节点只“组 prompt→调模型→解析输出”；模型适配层不含业务；数据层不感知 UI；
  IPC 层只路由与序列化。
- 依赖方向单向：Renderer → IPC 契约 ←（实现）Main；业务模块不反向依赖 UI。

### D5. 顶层模块边界（约定，不含实现）
- 划定源码分层目录约定：`main/`（Main 进程入口与协调）、`renderer/`（UI）、
  `workers/`（utilityProcess/worker 任务）、`shared/`（跨进程共享的类型与 IPC 契约）、
  `core/`（与进程无关的业务域模块：编排、事实库、素材库、模型适配、提示词等）。
- `shared/` 只放类型与契约，不放实现逻辑，供三类进程共享而不引入耦合。

## Risks / Trade-offs

- **风险：进程边界过度拆分带来通信开销与复杂度。** 取舍：仅按“CPU 密集 vs 异步 I/O”这一硬判据拆分，
  不过早细分，保持规则简单可判定。
- **风险：能力档位映射层增加一次间接。** 取舍：换取“不锁死模型 + per-agent 灵活配置”，符合产品长期诉求。
- **风险：禁 any 在对接 LLM/第三方库时提高成本。** 取舍：以 `unknown`+Zod 边界校验换取系统级类型安全，
  值得。
- **权衡：本 change 无用户可见产出。** 但它是所有后续能力的地基，先行固化可避免大规模返工。
