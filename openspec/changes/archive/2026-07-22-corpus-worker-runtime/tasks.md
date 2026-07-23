## 1. 纯函数 embedding 与排序（core，可独立校验）

- [x] 1.1 新增 `core/corpus/corpus-embedding.ts`：`computeEmbeddings(texts): EmbeddingVector[]`——字符 unigram+bigram 哈希入固定维（256）+ L2 归一化，确定性、无依赖、无 I/O。
- [x] 1.2 `cosineSimilarity(a, b): number`（归一化向量即点积）。
- [x] 1.3 `rankCorpusHits(queryVector, items, query): CorpusRetrievalResult`——余弦相似度降序 + 过滤（types/tags/sourceKinds 任一匹配、跨字段 AND）+ minScore/topK 截断。
- [x] 1.4 `core/corpus/index.ts` 导出上述；`EmbeddedCorpusItem` 类型（item + vector）。

## 2. worker 薄壳与派发抽象

- [x] 2.1 新增 `src/workers/embed-worker.ts`：`parentPort` 收 `embed-texts`/`embed-candidates`/`abort-embed` → 调 `computeEmbeddings` → 回 `embed-done`/`embed-error`；错误即消息。镜像 diff-worker。
- [x] 2.2 新增 `main/corpus/embed-runner.ts`（不依赖 Electron）：`EmbedRunner` 接口 + `InlineEmbedRunner`（直调纯函数）+ `EmbedAbortedError`。
- [x] 2.3 新增 `main/corpus/utility-process-embed-runner.ts`（依赖 Electron）：fork/转发/收敛 embed-done/embed-error；fork/通信失败回退内联。镜像 utility-process-diff-runner。
- [x] 2.4 `electron.vite.config.ts`：main 段加 `'embed-worker'` 入口 → `out/main/embed-worker.js`。

## 3. 素材快照与检索运行时

- [x] 3.1 新增 `main/corpus/corpus-store.ts`（不依赖 Electron）：`CorpusStore` 接口 + `InMemoryCorpusStore`（含 residence，`snapshot(scope)` 按 global/project/work 筛出候选）。
- [x] 3.2 `runtime.ts`：`retrieveCorpus(wc, runId, query)`——`corpus-retrieval-started` → 取快照 → 经 `EmbedRunner` 算查询向量 → `rankCorpusHits` → `corpus-retrieval-completed`；异常/中断走 `corpus-retrieval-failed`；`#startUtilityRun` 挂账本可中断。
- [x] 3.3 `RuntimeDeps` 增可选 `getEmbedRunner?`（缺省 `InlineEmbedRunner`）与 `getCorpusStore?`（缺省空快照）。

## 4. IPC 契约与接线

- [x] 4.1 `command-messages.ts`：增 `CorpusScopeDto`/`CorpusFilterDto`/`CorpusQueryDto` + `RetrieveCorpusCommand`（`retrieve-corpus`）入 `FrontendCommandMessage`。
- [x] 4.2 `control-messages.ts`：增 `CorpusItemDto`/`CorpusHitDto` + `corpus-retrieval-started`/`completed`/`failed` 入 `BackendControlEvent`。
- [x] 4.3 `ipc-handlers.ts`：`retrieve-corpus` 收窄 DTO → `runtime.retrieveCorpus`。
- [x] 4.4 `main/index.ts`：装配 `UtilityProcessEmbedRunner` + `InMemoryCorpusStore` 注入 runtime。

## 5. 冒烟与校验

- [x] 5.1 `orchestration-smoke.ts`：`smokeCorpusRetrieval()`——内存素材 + `InlineEmbedRunner`：查询命中按相关度降序、过滤/topK 生效、弱参考不产 bug、中断路径、embedding 确定性；在 `main()` 调用。
- [x] 5.2 `tsc -p tsconfig.node.json` 绿。
- [x] 5.3 `tsc -p tsconfig.web.json` 绿（未回归）。
- [x] 5.4 eslint 绿（无 any/未用/switch default）。
- [x] 5.5 `electron-vite build` 绿（`out/main/embed-worker.js` 产出）。
- [x] 5.6 `npm run smoke:orchestration` 绿（末行「全部通过」）。
- [x] 5.7 `openspec validate corpus-worker-runtime --strict` 通过。
