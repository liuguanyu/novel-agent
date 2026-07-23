## Why

I7 是「实现阶段」把素材库（Corpus）弱参考检索的 **embedding/检索契约**提升为本仓库**第三个 utilityProcess worker** 的一波，兑现路线图 I7「素材库 embedding 检索 worker」。

- `corpus-retrieval` / `corpus-extraction` spec 均明确「embedding 计算 MUST 在 utilityProcess，向量库读写 I/O 归 Main（非阻塞）」。契约地基（corpus-library，已归档）已备好 `CorpusItem`/`CorpusQuery`/`CorpusHit`/`CorpusRetrievalResult` 数据模型与 `EmbedTextsTaskRequest`/`EmbedCandidatesTaskRequest` ↔ `embed-done`/`embed-error` 跨进程任务契约，但 **embedding 算法从未实现、检索运行时从未落地**：`corpus-task.ts` 仅有消息类型，无向量计算；`corpus-retrieval.ts` 仅有查询/命中类型，无排序实现。
- 本仓库已有两个 utilityProcess worker（I5 audit-worker、I6 diff-worker）。I7 复用同一套「纯函数 + 薄壳 worker + 可注入 Runner + 内联回退」模式落地**第三个 worker**：查询 embedding 在 worker 算，向量库读写 I/O + 排序聚合归 Main。
- 弱参考语义（`corpus-model` spec）：素材 MUST NOT 进入一致性检查、MUST NOT 产 bug，仅在被**显式检索**时作为灵感输入——本 change 只落「显式检索」通路，绝不把素材接入总检/事实库。

本 change 落地：Main 据作者查询（+作用域/过滤/topK/minScore）→ 把查询文本派发给 embed worker 算查询向量 → worker 回传向量 → Main 用**纯函数** `rankCorpusHits` 对（已按作用域筛出的）素材条目做余弦相似度排序 + 过滤（类型/标签/来源）+ topK/minScore 截断 → 经 `corpus-retrieval-*` 控制事件下发命中列表。embedding 计算收敛为**纯确定性函数** `computeEmbeddings`（字符 n-gram 哈希 + L2 归一化，无外部模型依赖、无 I/O、无 Electron，可 Node 冒烟直调）；worker 仅为薄壳；Main 侧经可注入的 `EmbedRunner` 抽象派发并保留**内联回退**（utilityProcess 不可用/非 Electron 冒烟时降级为 Main 内联，语义/输出一致、仍可中断）。

**范围切分**：本 change 落地 embedding worker 运行时 + 语义检索路径（Main 排序/过滤/作用域）+ IPC 契约 + 冒烟。素材**导入/自动提炼落库/持久化向量库/挂载治理 UI**（`corpus-extraction`/持久化选型）留作后续 change——正如 I5 总检先需事实抽取就绪、本检索先需素材入库就绪；MVP 以可注入的内存素材快照驱动检索、以内联回退保证功能，向量库持久化选型仍不锁定（`CORPUS_RETRIEVAL_PLACEMENT.vectorStore='undecided'`）。

## What Changes

- 新增 `core/corpus/corpus-embedding.ts`（纯函数）：`computeEmbeddings(texts): EmbeddingVector[]`——字符 unigram+bigram 哈希入固定维（256）向量 + L2 归一化（确定性、无依赖）；`cosineSimilarity(a, b)`；`rankCorpusHits(queryVector, items, query): CorpusRetrievalResult`——按余弦相似度降序 + 过滤（类型/标签/来源 kind）+ topK/minScore 截断。无 I/O、无 Electron，可 Node 冒烟直调。`core/corpus/index.ts` 导出。
- 新增 `src/workers/embed-worker.ts`：utilityProcess 入口薄壳——`process.parentPort` 收 `embed-texts`/`embed-candidates`/`abort-embed` → 调 `computeEmbeddings` → 回 `embed-done`/`embed-error`；错误即消息，绝不抛异常穿越进程边界。镜像 audit/diff worker。
- 新增 `main/corpus/embed-runner.ts`（不依赖 Electron）：`EmbedRunner` 接口 + `InlineEmbedRunner`（直调纯函数，作回退与冒烟注入）+ `EmbedAbortedError`。
- 新增 `main/corpus/utility-process-embed-runner.ts`（依赖 Electron `utilityProcess`，仅 main/index 装配）：fork embed worker、转发 embed/abort、收敛 `embed-done`/`embed-error` 为 Promise；fork/通信失败回退内联。
- 新增 `main/corpus/corpus-store.ts`（不依赖 Electron）：`CorpusStore` 接口 + `InMemoryCorpusStore`——持已 embedding 的素材条目，`snapshot(scope)` 按作用域（global/project/work）筛出候选（向量库读作为 Main I/O；持久化选型未定，本 change 以内存实现兑现接口）。
- `main/orchestration/runtime.ts`：新增 `retrieveCorpus`（派发查询 embedding、Main 排序/过滤、下发 `corpus-retrieval-*` 控制事件、可中断）；`RuntimeDeps` 增加可选 `getEmbedRunner?`（缺省内联）与 `getCorpusStore?`（缺省空）。
- IPC 契约：`command-messages.ts` 增 `retrieve-corpus` 命令（含 CorpusQuery 的 DTO 投影）；`control-messages.ts` 增 `corpus-retrieval-started`/`corpus-retrieval-completed`/`corpus-retrieval-failed` 控制事件（强类型判别联合，禁 any）。preload 无需新方法（复用 `sendCommand`/`onControlEvent` 泛型通道）。
- `main/ipc-handlers.ts`：`retrieve-corpus` 收窄 DTO → 委派 runtime。
- `main/index.ts`：装配 `UtilityProcessEmbedRunner` + `InMemoryCorpusStore` 注入 runtime。
- `electron.vite.config.ts`：main 段增加 `'embed-worker'` 入口，产到 `out/main/embed-worker.js`，供 `utilityProcess.fork` 定位。
- 冒烟：`orchestration-smoke.ts` 用 `InlineEmbedRunner` + `InMemoryCorpusStore`（含几条素材）端到端验证——查询→算向量→排序命中按相关度降序→过滤/topK 生效→中断路径→纯函数 embedding 确定性可独立校验。

## Impact

- Affected specs: 新增 capability `corpus-worker-runtime`（ADDED：查询 embedding 在 utilityProcess worker、Main 派发查询文本、Main 侧纯函数排序/过滤/作用域、检索经控制事件下发、可中断、worker 不可用可回退内联且语义一致、embedding 为纯确定性函数可独立校验、素材弱参考不进一致性检查）。不改 `corpus-model`/`corpus-extraction`/`corpus-retrieval`（本 change 是其检索运行层兑现，非重定义）。
- Affected code: `core/corpus/corpus-embedding.ts`（新，纯函数）、`core/corpus/index.ts`、`src/workers/embed-worker.ts`（新）、`main/corpus/embed-runner.ts`（新）、`main/corpus/utility-process-embed-runner.ts`（新）、`main/corpus/corpus-store.ts`（新）、`main/orchestration/runtime.ts`、`main/ipc-handlers.ts`、`main/index.ts`、`shared/ipc/command-messages.ts`、`shared/ipc/control-messages.ts`、`electron.vite.config.ts`、`orchestration-smoke.ts`。
- 依赖 I3（orchestration-runtime，提供控制事件/abort 账本）+ corpus-library 契约（已归档，提供 CorpusItem/CorpusQuery/CorpusHit/embed 任务类型）。
- 兼容性：既有控制事件/命令协议不变，仅新增成员；素材弱参考语义不变（MUST NOT 进总检/事实库）。build/lint/tsc/smoke 保持绿。utilityProcess fork 路径受 Node 冒烟环境限制无法直跑，故以内联回退保证功能、以 build 校验 worker 产物、以纯函数冒烟校验 embedding/排序正确性。
