## Why

I6 后端 `refactor-worker-runtime`（已归档）落地了局部重构的 **diff/hunk worker 运行时 + 落盘 + checkpoint + IPC 契约**：`compute-refactor-diff` / `apply-hunk-decisions` 命令与 `refactor-diff-computed` / `refactor-diff-failed` / `refactor-applied` / `refactor-apply-failed` 控制事件均已就位（强类型判别联合，preload 泛型通道可直接消费）。但**渲染层从未消费**这套契约——`editor-annotations` spec 要求的「正文轴 diff 双栏视图 + 逐 hunk accept/reject 控件 + 意图只上报」在 UI 侧仍是空白（`ManuscriptAxis` 注释明写「标注/diff/hunk 承载留后续波次接入」）。

本 change 是 I6 的**渲染层跟进子 change**（与 I10 的 A/B/C 拆分同构），把已落地的后端 diff/hunk 通道接成作者可用的改写审阅交互，收口 I6。

**改写片段来源（范围决策）**：调查发现渲染层当前无「把 agent 改写自动转成结构化 `rewrittenFragment` + 片段锚点」的通路——mutate 召唤只产出对话流文本。为保持范围有界，本 change 采用 **MVP 方案**：作者从 mutate 对话中得到改写建议后，在改写审阅面板手动确认「原片段」（默认取正文轴当前选区文本）与「改写片段」，据此驱动 `compute-refactor-diff`；「mutate agent 输出 → 自动结构化改写 → 自动 diff」的全自动通路留待后续 change。

**锚点策略（绕开 ProseMirror↔Markdown 偏移映射）**：后端 `computeRefactorDiff` 的 `anchor.from/to` 是章节 Markdown 文本（与渲染层 `useChapters.content` 同源）的**字符偏移**。故 MVP 由前端在章节正文字符串中定位原片段子串得出 `from/to`，无需在本 change 啃 ProseMirror 位置↔Markdown 偏移的完整映射。渲染层仍**只上报意图**：diff 计算与拼回落盘全在后端确定性执行。

## What Changes

- 新增 `src/renderer/hooks/useRefactor.ts`：改写审阅状态机 hook（镜像 `useFactExtraction`）。状态 `idle/computing/reviewing/applying/applied/failed`；`computeDiff(anchor, rewrittenFragment)` 发 `compute-refactor-diff`；消费 `refactor-diff-computed`（存 hunks/原片段/改写片段/锚点，进 reviewing）、`refactor-diff-failed`；本地逐 hunk accept/reject 意图（默认 accept）；`apply()` 发 `apply-hunk-decisions`；消费 `refactor-applied`（携 checkpointId，触发章节重载回调）、`refactor-apply-failed`。仅经 `sendCommand`/`onControlEvent`，不读盘/不算 diff/不写正文。
- 新增 `src/renderer/components/RefactorReviewPanel.tsx`：改写审阅面板——作者输入/确认「原片段」（默认可从当前章节正文选取）与「改写片段」→ 计算 diff → **diff 双栏视图**（原片段 vs 改写片段，逐 hunk 高亮）+ **逐 hunk accept/reject 控件** → 提交裁决 → 展示落盘结果（checkpointId）/失败原因。
- `src/renderer/App.tsx`：装配 `useRefactor` 与面板，`refactor-applied` 后重载当前章节正文（复用 `useChapters.selectChapter`）使磁盘变更即时呈现；面板入口置于顶栏（与仪表盘/Story Bible 抽屉同排）。
- 无需新增 preload 方法（复用 `sendCommand`/`onControlEvent` 泛型通道）；无需改后端（union 成员已落地）。

**范围切分**：本 change 只做渲染层 diff 双栏/逐 hunk 审阅 UI + 章节重载。ProseMirror 内联锚定标注（高亮不漂移/失效不盲渲染的完整位置映射）与「mutate agent 输出自动结构化改写」留待后续 change。本 change 以面板承载 diff 双栏（`editor-annotations` spec 的 MVP 落地形态），不改后端与既有 IPC 契约。

## Impact

- Affected specs: 新增 capability `refactor-review-ui`（ADDED：渲染层消费 diff/hunk 通道呈现 diff 双栏 + 逐 hunk accept/reject、accept/reject 只上报意图经 IPC、落盘成功后重载章节正文、失败结构化提示、渲染层不算 diff/不写正文）。不改 `editor-annotations`（本 change 是其 diff 双栏/逐 hunk 交互的 MVP 运行层兑现）。
- Affected code: `src/renderer/hooks/useRefactor.ts`（新）、`src/renderer/components/RefactorReviewPanel.tsx`（新）、`src/renderer/App.tsx`。
- 依赖 I6 `refactor-worker-runtime`（已归档，提供 compute/apply 命令与 refactor-* 控制事件）。
- 兼容性：既有命令/控制事件协议不变，仅渲染层消费既有成员。tsc(web)/eslint/build 保持绿；渲染层无 Node 冒烟（后端 diff/拼回已由 I6 冒烟覆盖）。
