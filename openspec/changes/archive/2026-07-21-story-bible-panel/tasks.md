# story-bible-panel 任务

> 五道门：node typecheck / web typecheck / eslint / electron-vite build / `openspec validate story-bible-panel --strict`。

## 1. 查询契约与 Main 只读投影

- [x] 1.1 在 shared IPC query 契约中新增 Story Bible DTO 与 `getStoryBible` 查询通道。
- [x] 1.2 Main 侧从 `SqliteFactStore.getLatestVersion/getView` 读取当前事实视图。
- [x] 1.3 Main 侧将 core `FactView` 投影为纯可序列化 DTO，包含实体/别名/属性/时间线/关系/伏笔/provenance quote。
- [x] 1.4 无事实库或无版本时返回空态 DTO，不让异常穿透 Renderer。

## 2. Preload 受限桥

- [x] 2.1 `NovelAgentBridge` 新增 `getStoryBible()`。
- [x] 2.2 preload 用 query channel invoke，仍不暴露 ipcRenderer/任意通道/DB。

## 3. Renderer 面板

- [x] 3.1 新增 `useStoryBible` hook：加载、刷新、错误状态。
- [x] 3.2 新增 Story Bible 面板组件：展示 latest version、实体/别名/属性、时间线、关系、伏笔。
- [x] 3.3 支持最小关键词过滤实体。
- [x] 3.4 展示空态与刷新按钮。
- [x] 3.5 接入 App 顶部入口，不替代现有事实抽取 UI。

## 4. 验证

- [x] 4.1 TypeScript node/web 通过。
- [x] 4.2 ESLint 通过。
- [x] 4.3 electron-vite build 通过。
- [x] 4.4 OpenSpec strict validate 通过。
