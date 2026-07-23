## 1. Specification

- [x] 1.1 新增 capability `architect-board` delta（ADDED：看板取数经后端投影查询、看板视图三轴结构、受限桥只读方法、Renderer 只呈现不自算）。
- [x] 1.2 `command-palette` delta（ADDED：架构看板取数与呈现落地——命令面板 MUST 提供查阅入口，看板数据 MUST 经后端投影查询取数）。

## 2. 取数契约与后端投影

- [x] 2.1 `shared/ipc/query-messages.ts`：新增 `ArchitectBoardDto`（复用 Story Bible 子 DTO：timelineEvents / plotHooks / entities），`QUERY_CHANNELS.getArchitectBoard`。
- [x] 2.2 `shared/ipc/channels.ts` 无需改（通道在 query-messages 的 QUERY_CHANNELS）；`shared/ipc/bridge.ts`：`NovelAgentBridge` 新增 `getArchitectBoard()`。
- [x] 2.3 `main/story-bible-dto.ts`：新增 `projectArchitectBoard(view): ArchitectBoardDto` + `emptyArchitectBoardDto()`，后端排序（时间线按 tick）。
- [x] 2.4 `main/ipc-handlers.ts`：`getArchitectBoard` handler（无最新版本回空看板）。

## 3. Preload 受限桥

- [x] 3.1 `preload/index.ts`：实现 `getArchitectBoard()`，仅 invoke 查询通道，不暴露 DB/fs/任意通道。

## 4. UI 呈现（renderer）

- [x] 4.1 `renderer/hooks/useArchitectBoard.ts`（新）：加载/刷新看板 DTO，暴露 board/loading/error/refresh。
- [x] 4.2 `renderer/components/ArchitectBoardDrawer.tsx`（新）：三栏呈现时间线轴/情节线/人设集，纯呈现（不排序不推导）。
- [x] 4.3 `renderer/components/CommandPalette.tsx`：新增「查阅架构看板」项（查阅、非召唤，不产 SummonCommand），打开看板抽屉。
- [x] 4.4 `renderer/components/DialogueAxis.tsx`：召唤运行「生成中…」标注当前目标专家名（据 activeRunId 对应 turn 的 agent + 权威目录）。
- [x] 4.5 `renderer/App.tsx`：装配 `ArchitectBoardDrawer`（顶栏入口 + 命令面板共享打开状态）。

## 5. Validation

- [x] 5.1 Run node and web TypeScript checks.
- [x] 5.2 Run ESLint.
- [x] 5.3 Run OpenSpec strict validation.
- [x] 5.4 Run production build.
- [x] 5.5 Run orchestration smoke.
