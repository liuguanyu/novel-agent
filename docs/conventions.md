# 项目工程约定 (Engineering Conventions)

> 本文件由 `bootstrap-foundation` change 落定，是**后续所有 change 的公共约束**。
> 任何后续实现若与本文件冲突，以本文件（及对应 OpenSpec spec）为准。
> 对应 spec：`process-model`、`ipc-contract`、`model-adapter`、`engineering-standards`。

---

## 1. 源码分层目录约定 (Task 1.1)

源码统一置于 `src/`，按**进程归属与依赖方向**分层：

| 目录 | 归属 | 职责 | 允许依赖 |
|------|------|------|----------|
| `src/main/` | Main 进程 | 应用生命周期、窗口管理、协调、异步 I/O（LLM/SQLite/文件）、派发 CPU 任务给 workers | `core/`、`shared/` |
| `src/preload/` | Preload（隔离桥） | 经 `contextBridge` 暴露受限 IPC API 给 Renderer；无业务逻辑 | `shared/` |
| `src/renderer/` | Renderer 进程 | 仅渲染与交互；经 preload 暴露的 API 通信 | `shared/`（仅类型） |
| `src/workers/` | utilityProcess / worker_threads | CPU 密集任务（embedding、大文本 diff、Map-Reduce 总检、大文档解析） | `core/`、`shared/` |
| `src/shared/` | 跨进程共享 | **仅类型与契约定义**（IPC 消息、枚举、常量）；无实现 | 无（叶子层） |
| `src/core/` | 进程无关业务域 | 编排、事实库、素材库、模型适配、提示词等纯业务逻辑；不感知进程/UI | `shared/` |

**依赖方向（单向，禁止成环）：**

```
renderer ─┐
main ─────┼─► core ─► shared
workers ──┘         ▲
preload ────────────┘   (preload 仅依赖 shared)
```

- `shared/` 是叶子，任何人都可依赖它，它不依赖任何人。
- `core/` 只依赖 `shared/`，**不依赖** main/renderer/workers/preload。
- 业务模块**绝不反向依赖** `renderer/`（UI）。

---

## 2. `shared/` 边界规则（仅类型与契约） (Task 1.2)

`src/shared/` **只允许**：类型定义（`type`/`interface`）、`enum`/联合常量、Zod schema、纯常量。

**反例清单（以下内容 MUST NOT 出现在 `shared/`）：**

- ❌ 任何函数**实现**（除类型层面的函数签名类型）。
- ❌ `import` 了 `electron`、`fs`、`better-sqlite3` 等运行时/宿主模块。
- ❌ 类的**方法体**含业务逻辑（可有纯数据类，但不含 I/O/副作用）。
- ❌ 读写文件、访问数据库、发起网络/LLM 请求。
- ❌ 依赖 `main/`、`core/`、`renderer/`、`workers/` 中的任何模块。
- ❌ React/Vue 组件或任何 UI 代码。
- ✅ 允许：`export interface IpcMessage {...}`、`export const CHANNELS = {...} as const`、`export const bugSchema = z.object({...})`。

判据：**把 `shared/` 单独拷到任意进程都能编译、且不引入任何副作用**。

---

## 3. 工作负载归属清单 (Task 1.3)

唯一判据：**「是否会长时间（约 >50ms）同步占用 CPU」**。是 → utilityProcess/worker；否（异步 I/O）→ Main 可接受。

| 工作负载 | 性质 | 归属 | 说明 |
|----------|------|------|------|
| LLM API 调用 | 异步 I/O（网络） | **Main** | `await`，不占事件循环 |
| SQLite 读写 | 异步 I/O | **Main** | 用异步/非阻塞驱动；避免大事务同步阻塞 |
| 文件读写 | 异步 I/O | **Main** | `fs/promises` |
| LangGraph 编排调度 | 协调（多为 await I/O） | **Main** | 节点内若含 CPU 密集子任务，派发给 worker |
| embedding 计算 | CPU 密集 | **worker** | 向量化本地计算 |
| 大文本 diff | CPU 密集 | **worker** | surgical-refactor 的 diff 引擎 |
| 全书 Map-Reduce 总检 | CPU 密集、量大 | **worker** | global-audit |
| 大文档解析（导入废稿等） | CPU 密集 | **worker** | project-import 的大文件解析 |
| 语义检索（大规模） | CPU 密集 | **worker** | 小规模可 Main，大规模走 worker |

**红线：**
- Agent 逻辑、LangGraph 编排、模型调用、数据库/文件访问 **绝不在 Renderer**。
- CPU 密集任务 **绝不在 Main 同步执行**（会卡 IPC → 卡 UI）。

---

## 4. Main ↔ utilityProcess 派发约定 (Task 1.4)

进程边界契约（**约定，不含实现**）：

- **派发**：Main 通过 `utilityProcess.fork()` 拉起 worker，用 `MessagePort` 传递**任务请求**。
- **任务请求/结果**统一为强类型消息，携带 `taskId`（关联请求与响应）与 `type`（判别任务种类）。
- **结果回传**：worker 完成后经 port 回传**结果消息**或**错误消息**（错误作为一等消息，不抛异常穿越进程边界）。
- **进度/流式**：长任务 MAY 分片回传进度消息（含 `taskId`）。
- **取消**：Main 可发 abort 消息（含 `taskId`），worker 尽快停止并回传已完成部分或中止确认。
- 生命周期：worker 无状态优先；每类 CPU 任务的 worker 入口置于 `src/workers/`。
- 任务消息类型定义的归属：
  - 若任务消息**仅携带基础标量/通用类型**（不依赖 core 域模型）→ 置于 `src/shared/`（与 IPC 同层）。
  - 若任务消息**携带 core 域类型**（如 `ImportParseResult`）→ 置于 `src/core/<域>/`。
    因：`shared/` 是依赖叶子（§2）不得依赖 `core/`；而 worker 任务仅 Main↔worker 可见、renderer 不涉，
    放入 `core/` 既不破坏叶子约束，也避免 renderer 构建连带编译 core。

> 注：Main↔Renderer 用 Electron IPC（见 `src/shared/ipc/`）；Main↔worker 用 utilityProcess MessagePort。两者都遵循「强类型 + 判别字段 + 关联 id + 错误即消息」四原则。

---

## 5. 工程规范 (Tasks 4.1–4.3)

### 5.1 类型安全与禁用 any (Task 4.1)
- `tsconfig` 启用 `strict: true`、`noImplicitAny: true`（strict 已含，显式再声明以示强调）。
- ESLint 将 `@typescript-eslint/no-explicit-any` 置为 **error**。
- 违反即 CI 失败；不允许 `// eslint-disable` 绕过（除非有 review 批准的极少数边界）。

### 5.2 未知数据用 unknown + 收窄/Zod (Task 4.2)
- 外部输入（第三方库返回、LLM 输出、IPC 反序列化）一律先以 `unknown` 承接。
- 再经**类型收窄**（`typeof`/`in`/判别字段）或 **Zod `.parse()/.safeParse()`** 校验转强类型后方可使用。

  ```ts
  // ✅ 正确
  const raw: unknown = JSON.parse(text);
  const result = bugListSchema.safeParse(raw);
  if (!result.success) return handleInvalid(result.error);
  const bugs = result.data; // 强类型

  // ❌ 错误
  const bugs = JSON.parse(text) as any;
  ```

### 5.3 职责单一与依赖方向 (Task 4.3)

各层**禁止事项**：

- **agent 节点**：只「组装 prompt → 调模型 → 解析输出（Zod 校验）」。禁止：直接持久化、直接 IPC、任何 UI 逻辑。
- **模型适配层（`core/model`）**：只统一调用与 provider 切换。禁止：任何小说业务逻辑。
- **数据层（事实库/素材库/正文）**：只数据读写与查询。禁止：依赖或感知 UI/渲染层。
- **IPC 层（`shared/ipc` + main 侧路由）**：只消息路由与序列化。禁止：业务判断。
- **依赖方向**：业务模块 → 契约/共享类型（单向）。禁止：业务模块反向依赖 `renderer/`。

---

## 6. 本文件与 OpenSpec 的关系 (Task 4.4)

- 本文件是 `bootstrap-foundation` 四个 spec（process-model / ipc-contract / model-adapter / engineering-standards）的**落地约定汇总**。
- 后续每个 change 的实现 MUST 遵守本文件；如需变更约定，先改对应 OpenSpec spec，再同步本文件。
- 构建顺序与依赖见 `openspec/ROADMAP.md`。
