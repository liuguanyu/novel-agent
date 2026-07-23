## Why

I10 子阶段 C：`command-palette` spec 早已要求「查阅架构看板」（时间线轴 / 并行情节线 / 核心人设集，数据来自后端、Renderer MUST NOT 自行计算），`core/shell/command-palette.ts` 也备好了 `ArchitectBoardView` 契约——但**运行层从未落地**：

- 没有任何后端查询把 `FactView` 投影为看板视图；
- preload 受限桥无看板方法；
- 命令面板/UI 无任何入口可查阅看板。

同时 I10 子阶段 B 已让对话轴按发言专家标注助手消息，但**多 agent 召唤运行的编排态**（当前哪个专家在跑、跑到哪一步）在「生成中…」处仍是笼统文案，未标注目标 agent。

本 change 为 I10 子阶段 C：**落地 architect 架构看板的取数与呈现（数据全部来自后端）+ 命令面板可查阅入口 + 召唤运行编排态标注目标 agent**。依赖 I5（audit-worker-runtime，已归档，确认 worker 运行时地基）与 I10-A（AGENT_CATALOG）。

## What Changes

- 新增看板取数契约（shared/ipc）：`ArchitectBoardDto`（时间线轴 / 情节线 / 人设集的纯可序列化投影，**复用既有 Story Bible DTO 子结构**，不另立模型）+ 查询通道 `getArchitectBoard`。
- Main 侧新增只读投影 `projectArchitectBoard(view): ArchitectBoardDto`（复用 `projectStoryBible` 的子投影，**后端计算/排序，Renderer 只呈现**）+ `getArchitectBoard` handler（无最新版本时回空看板）。
- preload 受限桥新增 `getArchitectBoard()`（仅 invoke 查询通道，MUST NOT 暴露 DB/fs/任意通道）。
- Renderer 新增 `useArchitectBoard` hook + `ArchitectBoardDrawer` 组件：三栏呈现时间线轴（按 tick 排序）/ 并行情节线（按状态分组）/ 核心人设集；经命令面板（Cmd+K）与顶栏入口打开。
- 命令面板（`CommandPalette.tsx`）新增「查阅架构看板」项，与召唤项并列（看板是查阅、非召唤，不产 SummonCommand）。
- 对话轴召唤运行编排态：`DialogueAxis` 的「生成中…」标注当前运行的目标专家名（据 `activeRunId` 对应 turn 的 agent + 权威目录），使多 agent 召唤运行的编排态可见。

## Impact

- Affected specs:
  - `command-palette`（新增 Requirement「架构看板取数与呈现落地」——看板 MUST 经后端投影查询取数、Renderer MUST NOT 自算；命令面板 MUST 提供查阅入口）。
  - 新增 capability `architect-board`（看板取数契约 + 后端投影 + 受限桥 + 呈现职责边界）。
- Affected code: `src/shared/ipc/query-messages.ts`、`src/shared/ipc/channels.ts`、`src/shared/ipc/bridge.ts`、`src/main/story-bible-dto.ts`、`src/main/ipc-handlers.ts`、`src/preload/index.ts`、`src/renderer/hooks/useArchitectBoard.ts`（新）、`src/renderer/components/ArchitectBoardDrawer.tsx`（新）、`src/renderer/components/CommandPalette.tsx`、`src/renderer/components/DialogueAxis.tsx`、`src/renderer/App.tsx`。
- 依赖 I5（audit-worker-runtime 已归档）+ I10-A（agent-summon-catalog 已归档）。
- 兼容性：看板取数为只读查询（与 `getStoryBible` 同构），不改流式/控制协议、不改图、不改运行层。build/lint/tsc/smoke 保持绿。
