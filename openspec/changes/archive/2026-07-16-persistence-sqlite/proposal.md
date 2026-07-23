## Why

`walking-skeleton` 已经让应用第一次端到端跑通：Renderer 能打开真实 `津门余味/` 文件，右轴能调用真实 LLM 流式对话。但 I1 仍是“直接扫目录 + 运行期内存态”的骨架：

- 节点 id 暂以相对路径充当，文件重命名/移动后锚点会漂移；
- 没有 `workspace.json` / `manuscript.json`，无法表达“一本书 = 一个可重开、可迁移、可 Git 管理的项目工作区”；
- checkpoint、事实库、事实版本仍只有 core 契约，没有实际 SQLite schema 与读写实现；
- 后续 I3 LangGraph 编排、I4 事实抽取、I6 改文回滚都缺少可落地的持久化底座。

本 change 是实现阶段第二波（I2），目标是把 I1 的直接读盘竖切升级为**可持久化的本地项目**：正文继续以 Markdown 文件落盘，结构/映射以可读 JSON 落盘，SQLite 只承载不适合放进正文目录的运行态/索引态数据（checkpoint、事实库、事实版本）。

## What Changes

- **工作区文件层持久化**：落地 `workspace.json`（书名/体裁/语言等元数据）与 `manuscript.json`（章节树、稳定 id、id↔path 映射、contentHash）。正文仍是 Markdown 文件，MUST NOT 存入 SQLite。
- **I1 NovelReader 升级**：从“相对路径即 id”升级为“manifest 稳定 id → Markdown 路径”。首次打开现有 `津门余味/` 时可导入/生成 manifest；后续重开保持稳定 id。
- **鲁棒映射重建**：当用户在系统外重命名/移动 `.md` 文件时，使用 contentHash 与路径检测识别 missing/moved/ambiguous 状态，给出结构化结果，MUST NOT 静默错配。
- **SQLite 基础设施**：Main 侧使用 Node 24 内置 `node:sqlite`（不引 native 依赖）创建/迁移 `novel-agent.db`，以异步 API 包装同步 sqlite 调用，避免 Renderer 直接接触数据库。
- **Checkpoint 存储实现**：实现 `core/orchestration/checkpointer.ts` 的 Main 侧 SQLite-backed 存储：commit/get/history；本波仅提供 API 与 smoke 验证，不接 LangGraph 运行时。
- **事实库与版本表 schema**：落地实体、属性、别名、时间线、关系、伏笔、出处、事实版本、事实变更表的 schema 与最小读写 API；本波不做自动抽取、不做审计 worker。
- **IPC/Renderer 影响最小化**：章节树/正文查询继续走 preload 强类型桥；Renderer 仍只渲染，不读文件、不读 SQLite。

## Capabilities

### New Capabilities

- `workspace-persistence`: 工作区文件层持久化（metadata/manifest/content）、稳定 id 映射、导入现有小说目录。
- `sqlite-persistence`: Node 内置 SQLite 数据库初始化、迁移、连接生命周期、Main-only 存储服务。
- `fact-store-runtime`: 事实库与事实版本的 SQLite schema + 读写 API。

### Modified Capabilities

- `main-backend-slice`: 章节树/正文从 manifest 稳定 id 解析，而不是把相对路径直接当 id。
- `project-storage`: 明确 I2 的双后端落地：正文与结构仍为可读文件，SQLite 不存正文。
- `checkpointer`: 从纯契约推进为 Main 侧 SQLite-backed 实现。

## Impact

- 依赖 `walking-skeleton`（已有 Electron/React/preload/Main IPC 竖切）、`story-workspace`（workspace/project-storage/manuscript manifest 契约）、`story-bible`（fact-store/fact-versioning 契约）、`agent-orchestration`（checkpointer/NovelState 契约）、`bootstrap-foundation`（进程模型、工程规范）。
- 新增运行时依赖：无第三方 SQLite 依赖；使用 Node 24 内置 `node:sqlite`。若 Electron 打包环境的 Node 版本/flag 与开发环境不一致，需在实现中显式验证并给出结构化错误。
- 正文仍为 Markdown 文件；`config/models.json` 与密钥不进入数据库、不进入日志。
- 本波不引 LangGraph、不做自动事实抽取、不做 diff 拼回；只把后续波次需要的持久化底座打牢。
