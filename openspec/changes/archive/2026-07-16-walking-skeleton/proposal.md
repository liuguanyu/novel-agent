## Why

W0–W8 十波已把**后端契约地基**铺满：`core/` 下各业务域的类型契约、Zod schema、纯函数 helper 齐备，
`core/shell/` 更把 Renderer 该呈现什么、如何锚定、进程如何归属都定成了强类型契约。但地基阶段**刻意不写
运行时/UI 代码**——当前 `src/renderer` 只有一行 `textContent` 占位，`core/model` 只有接口没有 provider
实现，界面无法真正使用。

本 change 是**实现阶段第一波（I1）**，交付一条**端到端跑通真实数据的"行走骨架"（walking skeleton）**：
不做 mock、不自嗨。竖切一条最小但完整的链路，让作者第一次真正"用"到这个小说 IDE——

- 中正文轴用 **TipTap** 打开并显示**真实小说文件**（项目内 `津门余味/` 的卷/章）;
- 右对话轴发起对话/召唤 → Main 组 prompt → **调用真实 LLM**（用户配置的 OpenAI 兼容端点）→ 流式回推;
- 手刹（打断/继续/审批）、Cmd+K 命令面板、仪表盘抽屉按 `core/shell` 契约落地为可交互结构。

本波**顺带点亮最小后端竖切**（否则 renderer 无处取真数据）：`core/model` 的真实 provider adapter
（OpenAI 兼容、SSE 流式、可中断、区分 reasoning/content）、Main 侧读盘 + IPC handler + 单 agent 直调。
**暂缓**（留后续波次）：SQLite 持久化（先直接读文件系统）、完整 LangGraph 多智能体编排（先单 agent 直调）、
diff/embedding/Map-Reduce worker。这些不影响"真数据端到端"成立。

关键边界不变（`docs/conventions.md` §1、§5.3）：**Renderer 只渲染与交互**，业务（读盘/LLM/编排）在 Main;
LLM 调用属异步 I/O 归 Main;strict + 禁 any、依赖单向继续强制。视觉设计后置，本波用 **Tailwind CSS** 做
"结构可用"的骨架级样式（能分区、能滚动、能点击），不做视觉打磨。

> 阶段转换说明：自本 change 起进入**实现阶段**，"不写代码"的地基约定不再适用；工程红线继续强制。

## What Changes

- **真实 LLM provider adapter**：在 `core/model/` 落地一个 **OpenAI 兼容** `ModelProviderAdapter` 实现
  （`stream()` 走 SSE、`complete()` 聚合;支持 `AbortSignal` 中断;正确分流 `reasoning_content` 与 `content`）。
- **模型配置加载**：Main 侧读取项目根 `config/models.json`（Zod 校验），按 `ModelResolutionConfig` 解析
  档位→provider+model;`apiKey` 支持 `env:VAR_NAME` 引用;文件已 gitignore，MUST NOT 硬编码密钥。
- **Main 真数据竖切**：Main 侧真读 `津门余味/` 卷/章文件构造章节树与正文;IPC handler 处理"取章节树/取正文/
  发起对话召唤/手刹控制";单 agent 直调（组 prompt → 调 adapter → 流式经 IPC 回推），暂不引 LangGraph。
- **受限强类型 IPC 桥**：扩展 `src/preload/` contextBridge，暴露受限收发 API（发命令 / 订阅流），面向
  `shared/ipc` 契约;MUST NOT 暴露原始 ipcRenderer 或 Node/Electron 能力。
- **React + Tailwind + TipTap 外壳**：`src/renderer/index.ts` 从占位替换为 React 挂载入口;按
  `core/shell/layout.ts` 落地三轴外壳 + 仪表盘抽屉 + Cmd+K 覆盖层;Tailwind 做骨架级样式。
- **对话轴手刹**：呈现真实 `chatHistory` + 打断/继续/审批控件;操作经 `core/shell/handbrake.ts` 的
  `toControlCommand` 映射为 `AuthorControlCommand` 经桥上报;LLM"思考过程"(reasoning) 可折叠展示。
- **命令面板（Cmd+K）**：产出 `core/summon` 的统一 `SummonCommand`;三入口收敛;查阅 architect 看板。
- **TipTap 标注**：bug 高亮 / diff 双栏 / 逐 hunk 控件由编辑器承载;标注以 `AnnotationAnchor`（NodeRef +
  ProseMirror 位置）锚定，编辑期用 ProseMirror `mapping` 修正、无法映射即 `invalidated`;accept/reject
  只经 IPC 上报 `HunkDecisionIntent`。

## Capabilities

### New Capabilities
- `model-provider-openai-compat`: OpenAI 兼容 provider adapter 实现（SSE 流式、可中断、reasoning 分流）+ 配置加载。
- `renderer-app-shell`: React + Tailwind 三轴外壳、命令面板、仪表盘抽屉、手刹交互的可运行落地。
- `main-backend-slice`: Main 侧真读小说文件 + IPC handler + 单 agent 直调 LLM 的最小真数据竖切。
- `renderer-ipc-bridge`: preload contextBridge 暴露的受限强类型收发 API。
- `renderer-editor`: TipTap/ProseMirror 编辑器承载标注、锚定防漂移、意图只上报的可运行落地。

### Modified Capabilities
<!-- 无（新增实现，不修改既有 spec 语义）。 -->

## Impact

- 依赖 `electron-shell-ui`（消费其全部 `core/shell` 契约）、`bootstrap-foundation`（进程模型、IPC 契约、
  model-adapter 接口、工程规范）、`on-demand-summon`（`SummonCommand`）、`human-in-the-loop`（手刹映射的
  `AuthorControlCommand`/`InterruptPayload`/`ResumeDecision`）、`surgical-refactor`（`DiffHunk`/`HunkValidity`）、
  `global-audit`（`QualityDashboard`）、`story-workspace`（`NodeRef` 锚定、章节树、读盘）、`story-bible`
  （bug 高亮/看板数据模型）、`agent-orchestration`（`DialogueMessage`/chatHistory）。
- **新增运行时依赖**：`react`、`react-dom`（renderer）;`@tiptap/core`、`@tiptap/react`、`@tiptap/pm`（renderer）;
  `tailwindcss`、`@tailwindcss/vite`（renderer 构建）;`@vitejs/plugin-react`（构建期）。LLM 调用用内置
  `fetch`（Node ≥20 / Electron），不引 SDK，保持 provider 无关。均不进 shared/。
- **需要用户提供**：`config/models.json`（baseUrl + apiKey + 模型列表 + 档位绑定）。已确认连通
  （智汇云 OpenAI 兼容端点，v4-pro/v4-flash，reasoning 型）。
- 首个写运行时代码、且端到端接真数据的 change;后续 `main-runtime-full`（SQLite + LangGraph 多智能体编排）、
  `workers-compute`（diff/embedding/Map-Reduce）在此竖切之上扩展。
- Renderer MUST 只渲染与交互;LLM/读盘/编排 MUST 在 Main。
