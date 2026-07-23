## Why

I4 已经让正文事实自动进入 `SqliteFactStore`，`fact-extraction-ui` 也提供了“抽取本章/补抽全书”的入口。但作者仍无法直接查看事实库当前态：不知道系统登记了哪些人物、别名、属性、关系、时间线事件与伏笔，也不能核对 provenance quote。

下一步需要一个只读 Story Bible 面板，把事实库作为可见、可核查的创作资产呈现出来。确认/编辑事实可在后续迭代做；本 change 先建立只读查询 IPC 与 Renderer 面板。

## What Changes

- Main 侧新增只读事实库查询：读取 latest fact version 的 `FactView`，投影为 shared/ipc DTO。
- preload 桥新增受限查询方法 `getStoryBible()`；Renderer 不直接访问 DB。
- Renderer 新增 Story Bible 面板/抽屉，展示：实体、别名、属性、时间线事件、关系、伏笔、状态、来源 quote。
- 面板提供最小过滤/空态：按实体名关键词过滤实体；展示 latest version id。
- 不做事实编辑、不做 inferred→confirmed 写入、不做复杂图谱布局。

## Impact

- 修改 `shared/ipc/query-messages.ts` 与 `bridge.ts`，新增 DTO 与查询通道。
- 修改 `preload/index.ts` 与 `main/ipc-handlers.ts`，接通只读查询。
- 新增 Renderer hook/component，并接入现有顶部入口或仪表盘抽屉。
- 保持 Renderer 无 DB/LLM/fs 能力。
