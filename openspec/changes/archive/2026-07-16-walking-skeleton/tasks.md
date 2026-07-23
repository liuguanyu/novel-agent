## 1. 真实 LLM provider adapter（core/model）

- [x] 1.1 落地 OpenAI 兼容 ModelProviderAdapter：complete() 聚合、stream() 消费 SSE 逐 delta 产出
- [x] 1.2 尊重 ModelCallOptions.signal（AbortSignal 中断断连），映射 finishReason（stop/length/aborted）
- [x] 1.3 分流 delta.content（正文）与 delta.reasoning_content（思考）：stream 只产出正文，reasoning 走旁路
- [x] 1.4 用内置 fetch，不引第三方 SDK；响应经 Zod 校验/收窄，禁 any

## 2. 模型配置加载（Main）

- [x] 2.1 读取项目根 config/models.json，Zod 校验为 providers 表 + ModelResolutionConfig，容忍 $comment
- [x] 2.2 apiKey 支持字面量或 env:VAR_NAME（从 process.env 读）；缺失/无效结构化报错，不硬编码、不写日志
- [x] 2.3 档位解析 perAgent[agentId][tier] > defaults[tier]，构造可用的 ModelAdapter

## 3. Main 真数据竖切

- [x] 3.1 NovelReader：真读 津门余味/ 卷/章文件构造章节树（带 NodeRef），排除 自省报告.md 等非正文
- [x] 3.2 IPC handler：取章节树、以 NodeRef 取某章正文
- [x] 3.3 IPC handler：发起对话/召唤 → 组 prompt → adapter.stream() → 分片经 manuscriptStream/dialogueStream 回推
- [x] 3.4 IPC handler：abort 触发对应 runId 的 AbortController，回推 aborted，不影响其他运行
- [x] 3.5 单 agent 直调，本波不引 LangGraph；LLM/读盘/prompt 组装均在 Main

## 4. 受限强类型 IPC 桥（preload）

- [x] 4.1 扩展 contextBridge：发命令（FrontendCommandMessage）/ 订阅流（BackendStreamMessage + 控制事件）
- [x] 4.2 不暴露原始 ipcRenderer/任意通道/Node·Electron 能力；下行 unknown 经 Zod 收窄，禁 any

## 5. React + Tailwind + TipTap 外壳

- [x] 5.1 引入 react/react-dom/@vitejs/plugin-react + tailwindcss/@tailwindcss/vite，接入 electron-vite renderer 构建
- [x] 5.2 src/renderer/index.ts 从占位替换为 createRoot 挂载 <App/>
- [x] 5.3 按 core/shell/layout.ts 的 AXIS_CAPABILITIES 落地三轴外壳 + 仪表盘抽屉 + Cmd+K 覆盖层（Tailwind 骨架级样式）
- [x] 5.4 组件仅依赖 shared/ 与 core/shell·core/summon；Renderer 无业务逻辑

## 6. 对话轴、命令面板、仪表盘、编辑器交互

- [x] 6.1 导航轴显示真实章节树；正文轴选中章经桥取真实正文并在 TipTap 显示
- [x] 6.2 对话轴呈现真实 chatHistory + 流式回复；reasoning 可折叠展示，正文只显示 content
- [x] 6.3 手刹操作经 core/shell/handbrake.ts 的 toControlCommand 映射并经桥上报（携 runId）
- [x] 6.4 审批弹窗原样呈现后端推送的强类型 InterruptPayload，不二次加工（骨架级：类型与通道就位，本波单 agent 直调无 interrupt 触发源，完整交互随 I2+ 编排接入）
- [x] 6.5 Cmd+K 命令面板产出 core/summon 的统一 SummonCommand，三入口收敛
- [x] 6.6 仪表盘抽屉呈现 QualityDashboard，点击问题经 toJumpIntent 触发正文轴一键跳章（骨架级：抽屉空态就位，本波无审计数据源，随 global-audit 实现波接入）
- [x] 6.7 TipTap 标注：bug 高亮/diff 双栏/hunk 控件承载；标注以 AnnotationAnchor 锚定、编辑时 mapping 修正、无法映射即 invalidated（骨架级：TipTap 只读承载就位，标注随修复/重构实现波接入）
- [x] 6.8 accept/reject 仅产出 HunkDecisionIntent 经桥上报，diff/拼回在后端（骨架级：同上，契约类型已就位）

## 7. 校验

- [x] 7.1 `openspec validate walking-skeleton --strict` 通过
- [x] 7.2 node/web typecheck、ESLint（strict + no-any）、electron-vite build 全绿
- [x] 7.3 确认与 electron-shell-ui/on-demand-summon/human-in-the-loop/surgical-refactor/global-audit/model-adapter 契约一致
- [x] 7.4 手动冒烟：三轴渲染、打开真实章节、对话调真实 LLM 流式回复、手刹中断可端到端跑通
- [x] 7.5 明确视觉设计（配色/排版/动效/主题）为后续独立迭代，不在本 change
