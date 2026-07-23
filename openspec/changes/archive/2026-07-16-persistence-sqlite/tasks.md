## 1. 工作区文件层持久化

- [x] 1.1 实现 workspace 文件布局：`workspace.json` + `manuscript.json` + Markdown 正文文件，正文不进 SQLite
- [x] 1.2 首次导入现有 `津门余味/`：生成 WorkspaceMetadata 与 ManuscriptManifest
- [x] 1.3 生成稳定 nodeId，替换 I1 中“相对路径即 id”的临时策略
- [x] 1.4 计算并持久化章节 contentHash，用于后续 remap
- [x] 1.5 重开工作区时从 manifest 恢复章节树，保持 id 与上次保存一致
- [x] 1.6 检测外部移动/重命名/修改：返回 clean/moved/changed/missing/ambiguous 结构化 remap 结果，不静默错配

## 2. Main 后端接入工作区

- [x] 2.1 将 NovelReader 改为 manifest-backed reader：NodeRef id → manifest entry → Markdown 文件
- [x] 2.2 IPC 取章节树/正文继续返回现有 DTO，Renderer 无需知道底层持久化变化
- [x] 2.3 首次启动无工作区文件时自动导入 `津门余味/`，保证 I1 冒烟路径继续可用
- [x] 2.4 路径校验继续防目录穿越；manifest 中的 relativePath 必须限制在工作区/内容根内

## 3. SQLite 基础设施（node:sqlite）

- [x] 3.1 使用 Node 24 内置 `node:sqlite` 创建 Main-only database service，不引 `better-sqlite3` 等 native 依赖
- [x] 3.2 数据库文件默认位于 `app.getPath('userData')/novel-agent.db`
- [x] 3.3 实现 migrations 与 `schema_migrations` 表，启动时幂等应用
- [x] 3.4 对上层暴露 Promise API；Renderer 不直接接触 SQLite/Node 能力
- [x] 3.5 启动时 feature detect `node:sqlite`，不可用时结构化报错，不白屏崩溃

## 4. Checkpointer SQLite 实现

- [x] 4.1 建表 `checkpoints(id, parent_id, at_node, state_json, created_at)`
- [x] 4.2 实现 `Checkpointer.commit(atNode, state, parent)`，写入完整 NovelState JSON 快照并返回 checkpoint
- [x] 4.3 实现 `Checkpointer.get(id)` 与 `history(from)`，沿 parent 链查询
- [x] 4.4 保持 abort 不提交 checkpoint 的边界语义；本波只提供存储原子操作，不接 LangGraph

## 5. Fact store / fact versioning SQLite 实现

- [x] 5.1 建表 `fact_versions` 与 `fact_changes`，支持版本链与 checkpoint 关联
- [x] 5.2 建表 `entities`、`entity_aliases`、`entity_attributes`，支持类型化实体、别名、属性、状态、出处
- [x] 5.3 建表 `timeline_events`、`relations`、`plot_hooks`，以 JSON payload 保留可扩展字段
- [x] 5.4 实现最小写入 API：追加 fact version + fact changes，MUST NOT 覆盖历史
- [x] 5.5 实现最小读取 API：按版本/实体 id 读取事实视图或实体；不存在返回 null/空集合
- [x] 5.6 所有外部 JSON payload 入库/出库经 Zod 或结构化收窄，禁 any

## 6. 校验

- [x] 6.1 `openspec validate persistence-sqlite --strict` 通过
- [x] 6.2 node/web typecheck、ESLint 全绿
- [x] 6.3 SQLite migration smoke：初始化 → 写 checkpoint/fact version/entity → 关闭重开 → 读回一致
- [x] 6.4 工作区 smoke：首次导入 `津门余味/` → 重开 id 不变 → 读取真实章节正文
- [x] 6.5 手工改名/移动一章文件后，remap 检测返回 moved/ambiguous 等结构化结果，不静默错配
- [x] 6.6 确认 Renderer 仍只通过 preload 桥取数据，不读文件、不读 SQLite
