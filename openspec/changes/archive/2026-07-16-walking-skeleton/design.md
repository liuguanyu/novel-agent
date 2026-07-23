## Context

实现阶段第一波。地基（W0–W8）已把后端契约铺满，`core/shell` 定义了 Renderer 该呈现什么与如何锚定，
`core/model` 定义了 ModelAdapter 接口但无 provider 实现。本波首次落地可运行代码，交付一条**端到端接真实
数据**的竖切：TipTap 打开真实小说、右轴对话调真实 LLM 流式回推。**不做 mock**。严守进程模型：Renderer 只
渲染与交互，读盘/LLM/编排在 Main（LLM 调用属异步 I/O，归 Main）。

## Goals / Non-Goals

**Goals:**
- 落地 OpenAI 兼容 provider adapter（SSE 流式、可中断、reasoning/content 分流），配置驱动、换模型不改码。
- Main 侧真读 `津门余味/` 卷/章文件、IPC handler、单 agent 直调 LLM，经 IPC 流式回推。
- React 18 + Tailwind + TipTap 三轴外壳落地：正文轴显示真章节、对话轴显示真流式回复、手刹/Cmd+K/仪表盘可交互。
- preload 受限强类型桥;全程消费 `core/shell`/`core/summon` 契约与纯 mapper，Renderer 无业务逻辑。

**Non-Goals:**
- 不做 mock 数据源——一律接真实后端。
- 不做视觉设计（配色/字体/间距/动效/主题）——Tailwind 只做"结构可用"骨架级样式。
- 不做 SQLite 持久化（本波直接读文件系统）、不引 LangGraph 多智能体编排（本波单 agent 直调）、
  不做 diff/embedding/Map-Reduce worker（留后续波次）。
- 不在 Renderer 写 LLM 调用、diff 计算、正文拼回、编排、持久化。

## Decisions

### D1. OpenAI 兼容 provider adapter（`core/model`）
- 实现 `ModelProviderAdapter`（providerId 由配置定;`create(model, auth)` 返回 `ModelAdapter`）。
- `stream()` MUST 用 `POST {baseUrl}/chat/completions` + `stream:true` 消费 SSE，逐 delta 产出;
  `complete()` 聚合为 `ModelResult`。二者 MUST 尊重 `ModelCallOptions.signal`（AbortSignal 中断断连）。
- 响应 MUST 区分 `delta.content`（正文）与 `delta.reasoning_content`（思考过程）：`stream()` 的
  AsyncIterable 仅产出正文 content;reasoning 经单独的可选回调/事件旁路（供对话轴折叠展示），
  MUST NOT 把 reasoning 混入正文。此为已确认的智汇云 v4-pro/flash 推理型特性所必需。
- 用内置 `fetch`（Node ≥20 / Electron 环境）读 SSE，不引第三方 SDK，保持 provider 无关。
- 外部响应为 unknown，MUST 经 Zod 校验/收窄后使用，禁 any。

### D2. 模型配置加载（Main 侧）
- Main 启动读项目根 `config/models.json`，Zod 校验为 `ModelResolutionConfig` + providers 表。
- `apiKey` 支持字面量或 `env:VAR_NAME`（后者从 `process.env` 读）;缺失/无效 MUST 结构化报错
  （不崩溃、经 IPC error 呈现给作者），MUST NOT 硬编码密钥。`$comment` 字段 MUST 被容忍忽略。
- 解析优先级 `perAgent[agentId][tier] > defaults[tier]`（复用 model-config 契约语义）。

### D3. Main 真数据竖切（暂不持久化、暂不编排）
- Main 侧 `NovelReader`：真读 `津门余味/` 目录（卷=子目录、章=`.md`;`自省报告.md` 非正文需排除;
  同名"第十六章"歧义按 story-workspace 的 import-ambiguity 语义标注但本波可先都列出）构造章节树 + 正文。
- IPC handler（Main）：取章节树、取某章正文、发起对话/召唤（组 prompt→调 adapter→SSE 分片经
  `manuscriptStream`/`dialogueStream` 回推）、手刹控制（abort 触发对应 run 的 AbortController）。
- 单 agent 直调：本波不引 LangGraph;一次召唤 = 组 system+user prompt → adapter.stream → 流式回推。
  多智能体编排留 `main-runtime-full`。

### D4. 受限强类型 IPC 桥（preload）
- preload MUST 经 contextBridge 暴露受限收发 API（发 `FrontendCommandMessage` / 订阅
  `BackendStreamMessage` 与控制事件），面向 `shared/ipc` 契约强类型化;MUST NOT 暴露原始 ipcRenderer、
  任意通道或 Node/Electron 能力。下行 unknown 经 Zod 收窄。

### D5. React + Tailwind + TipTap 外壳
- `src/renderer/index.ts` MUST 从占位替换为 `createRoot(...).render(<App/>)`;组件仅依赖 `shared/`
  （类型）与 `core/shell`/`core/summon`（视图契约与纯 mapper）;MUST NOT 依赖 main/workers、MUST NOT 做 I/O。
- 三轴外壳按 `AXIS_CAPABILITIES` 渲染;正文轴 TipTap 显示真章节;对话轴显示真流式回复 + 可折叠 reasoning;
  Cmd+K 产出统一 SummonCommand;仪表盘抽屉 + 一键跳章（toJumpIntent）。
- Tailwind 经 `@tailwindcss/vite` 接入 renderer 构建;样式 MUST 仅保证结构可用，MUST NOT 做视觉设计。

### D5a. shadcn/ui 提供交互原语（wave 内追加决策）
- 交互原语（Dialog / Command / Sheet / Collapsible / ScrollArea / Button）用 shadcn/ui，经官方 CLI
  shadcn add 拷贝源码组件进 src/renderer/components/ui/（非黑盒依赖，可改、受 strict TS 检查）。
  别名 @/* 指向 src/renderer/*（web tsconfig paths + electron-vite renderer resolve.alias）。
- shadcn 是交互原语 + 中性骨架，非视觉设计：base color neutral，仅提供结构可用的 token;
  配色/主题/动效仍后置到 I8，不违反本波视觉后置约定。
- 三根静态轴（章节树 / 正文 / 对话列表）用朴素 Tailwind，不套组件，避免噪音。
- vendored components/ui/** 与 lib/utils.ts 从 ESLint 豁免（上游拷贝，不受本仓红线约束），
  但仍纳入 tsc web typecheck 保证类型正确。

### D6. 契约消费而非重定义
- 手刹意图→命令用 `handbrake.ts` 的 `toControlCommand`;跳章用 `dashboard-drawer.ts` 的 `toJumpIntent`;
  召唤产出 `summon-command.ts` 的 `SummonCommand`;标注锚点用 `editor-annotation.ts` 的 `AnnotationAnchor`。
  Renderer MUST NOT 复制/重写这些纯函数/类型。

## Risks / Trade-offs

- **风险：reasoning 型模型把思考混入正文/费 token。** 缓解：adapter 严格分流 content/reasoning，
  正文只取 content;max_tokens 给足默认值;reasoning 折叠旁路展示。
- **风险：LLM 调用密钥泄漏。** 缓解：config 文件 gitignore、支持 env 引用、绝不硬编码、绝不写日志。
- **风险：Renderer 越权承载业务逻辑。** 缓解：组件依赖限定 shared/ + core/shell;LLM/读盘/编排均在 Main;评审守边界。
- **风险：标注在编辑期漂移。** 缓解：统一走 ProseMirror mapping 修正，无法映射即 invalidated 不盲渲染。
- **风险：本波竖切与后续 SQLite/LangGraph 冲突返工。** 取舍：IPC 契约与桥接口在本波定型且面向既有
  shared/ipc 契约，后续用 SQLite/编排替换 Main 内部实现即可，桥与 renderer 不需改。
- **风险：引入 React/TipTap/Tailwind 依赖膨胀。** 取舍：均为编辑器/界面刚需且限定 renderer 侧，不污染 main/workers/shared。
