## Context

I1 已跑通真实小说 + 真实 LLM + 三轴 UI，但仍直接扫描 `津门余味/`，节点 id 等同相对路径，且事实库/checkpoint 无运行时存储。I2 需要在不破坏 project-storage “正文和结构人类可读、Git 友好”契约的前提下，引入 SQLite 持久化底座。

## Goals / Non-Goals

**Goals:**

- 正文继续以 Markdown 文件保存；工作区结构与 id 映射以 `workspace.json` / `manuscript.json` 保存。
- 首次导入现有 `津门余味/` 后生成稳定 nodeId，后续重开、改名、移动文件时尽量保持 id 不变。
- 使用 Node 24 内置 `node:sqlite`，避免 `better-sqlite3` 等 native rebuild 风险。
- 实现 SQLite schema/migration 基础设施与 Main-only 存储服务。
- 落地 checkpoint、fact store、fact versioning 的最小 SQLite 读写 API，供 I3/I4/I6 接入。

**Non-Goals:**

- 不把正文本体写入 SQLite。
- 不在 Renderer 读写文件或数据库。
- 不引 LangGraph 真编排（I3）、不做事实自动抽取（I4）、不做改文 diff 拼回（I6）。
- 不做复杂协同编辑/冲突合并；本波只处理单用户本地工作区。

## Decisions

### D1. 双持久化后端

- **文件层**是 source of truth for workspace/manuscript：
  - `workspace.json`: 元数据（书名/体裁/语言/扩展字段）。
  - `manuscript.json`: `ManuscriptManifest`，包含稳定 id、kind/title/order/parentId、relativePath、contentHash。
  - Markdown 正文文件：保留在工作区内容目录或导入目录中，可由外部编辑器直接打开。
- **SQLite 层**只存运行态/索引态：checkpoint、事实实体与版本历史、出处、关系等。
- 原因：`project-storage` 要求结构与正文可读、可 diff；SQLite 不适合承载这些 Git 友好的源文件。

### D2. node:sqlite 封装为 Main-only async service

- 使用 `node:sqlite` 的 `DatabaseSync` 能力，但对上层暴露 Promise API。
- 所有 DB 调用归 Main 侧服务；Renderer 只能经 preload IPC 请求已收窄 DTO。
- 初始化时执行 migrations：`schema_migrations(version, applied_at)` 记录已应用迁移。
- DB 默认放在 `app.getPath('userData')/novel-agent.db`；若未来支持多工作区 DB，可在 I2 后扩展为 per-workspace DB。

### D3. 稳定 id 与 remap 策略

- 首次导入目录时，为每个 volume/chapter 生成稳定 id（不再使用路径当 id），并写入 `manuscript.json`。
- 每个章节条目记录 `relativePath` 与 `contentHash`。
- 重开工作区时：
  - 路径存在且 hash 匹配 → clean；
  - 路径不存在但 hash 在其他文件出现唯一命中 → moved；
  - 多个 hash 命中或 hash 不匹配 → ambiguous/changed，返回结构化 remap 结果；
  - MUST NOT 静默把旧 id 指到错误文件。

### D4. Checkpoint schema

- 表：`checkpoints(id, parent_id, at_node, state_json, created_at)`。
- `state_json` 为 `NovelState` 的 JSON 序列化；写入前/读出后经 Zod 或结构化收窄（若 core 尚无完整 schema，则先使用最小 unknown-safe 校验并在 Main 层隔离）。
- `history(from)` 沿 parent 链返回 checkpoint 历史。
- abort 期间不提交 checkpoint 的语义由 I3 调用层保证；I2 仅提供 commit/get/history 原子操作。

### D5. Fact store / versioning schema

- 核心表：
  - `fact_versions(id, parent_id, checkpoint_id, created_at)`
  - `fact_changes(id, version_id, op, kind, target_id, checkpoint_id, payload_json, created_at)`
  - `entities(id, type, canonical_name, status, provenance_json, introduced_version, updated_version)`
  - `entity_aliases(entity_id, alias, status, provenance_json, introduced_version)`
  - `entity_attributes(id, entity_id, key, value, status, provenance_json, introduced_version)`
  - `timeline_events(...)`, `relations(...)`, `plot_hooks(...)` 以 JSON payload 保留可扩展字段。
- 本波 API 以“写入/读取/按版本列出”为主，不承诺完整一致性视图算法；I4/I5 接入时可补齐更复杂查询。
- 增量非覆盖原则：事实变更历史 MUST 追加写入，不得覆盖/删除旧版本记录。

### D6. I1 UI 的最小接入

- 左轴章节树与正文读取仍保持现有体验，但 Main 从 workspace manifest 解析 id。
- 若首次启动发现无 manifest，可自动导入 `津门余味/` 并生成工作区文件；这不是 mock，而是真数据 import。
- 保存/编辑正文完整工作流可在本波实现最小 API，但 UI 编辑体验若超出范围可留 I6；至少必须保证读取链路使用稳定 id。

## Risks / Mitigations

- **`node:sqlite` 在 Electron 运行环境中不可用**：启动时 feature detect，若不可用给结构化错误；实现前用 dev 环境最小脚本验证。
- **同步 SQLite API 阻塞 Main**：本波操作轻量；上层 Promise 封装并保持短事务。后续高负载 worker 可迁移到 utility process。
- **manifest 与外部文件改动冲突**：依靠 contentHash remap，不静默错配；无法确定时返回 ambiguous 供 UI 后续处理。
