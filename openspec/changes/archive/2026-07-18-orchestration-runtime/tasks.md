# orchestration-runtime (I3) 任务

> 五道门（每项完成后全绿才算过）：
> node typecheck（`tsconfig.node.json`）/ web typecheck（`tsconfig.web.json`）/ eslint / electron-vite build / `openspec validate orchestration-runtime --strict`。
> 加：`smoke:orchestration` 可复现冒烟 + `pnpm dev` 手动冒烟。

## 1. LangGraph 依赖与状态桥接

- [x] 1.1 选定并安装 `@langchain/langgraph`（验证与 Electron 37 / Node 22 兼容；记录版本）。
  - 已装 `@langchain/langgraph@1.4.8` + `@langchain/core@1.2.3`；`ELECTRON_RUN_AS_NODE=1` 下 Electron 37.10.3 / Node 22.21.1 最小图 invoke 跑通；zod peer 由现装 3.25.76 满足。
- [x] 1.2 `src/main/orchestration/state-bridge.ts`：把 `NOVEL_STATE_REDUCERS`（append/overwrite）桥接到 LangGraph `Annotation.Root`，产出 `NovelState` 的图状态定义（禁 any）。
- [x] 1.3 单元/类型验证 bridge：chatHistory 累加、activeBugs 覆写语义与 core reducer 一致（编译期穷尽性守卫 + toNovelState 类型锁）。

## 2. 有状态图与 supervisor 路由

- [x] 2.1 `src/main/orchestration/graph.ts`：构建单一 `StateGraph`，以 state-bridge 状态 + MemorySaver（运行态）为 checkpointer；里程碑态经注入 recordMilestone 入 SqliteCheckpointer（design D3.5 方案 A）。
- [x] 2.2 supervisor 入口节点：按 `NovelState.currentAction` 数据驱动路由（routeByAction）到专家节点。
- [x] 2.3 writer 专家节点：调用 LLM adapter 产出正文草稿，流式分片经 `dialogueStream`（emitDialogue 回调）回推，写入 `currentDraft`。
- [x] 2.4 reviewer 专家节点：模型输出经 consistency-schema 校验点产出 `ConsistencyIssue[]` 写入 `activeBugs`。
- [x] 2.5 条件路由 + 循环：reviewer 后按 routeAfterReview 形成“写→审→改”环路（reviewIteration 防死循环）；需人工裁决→awaitDecision。
- [x] 2.6 专家节点可扩展性：supervisor 路由表数据驱动（ACTION_ROUTING），落地外动作安全收敛 END。
- [x] 2.7 节点边界向 `SqliteCheckpointer` 提交 checkpoint；中途 abort MUST NOT 提交。（图侧 recordMilestone 钩子已就位；实际接线在 section 3。）

## 3. 召唤复用有状态图（改造 ipc-handlers）

- [x] 3.1 `summon-run` 从单 agent 直调改为向长驻图注入 `SummonCommand`（写 currentAction + 触发下一跳）。
- [x] 3.2 图实例按 runId/workspace 长驻管理；will-quit / 切换工作区时清理。
- [x] 3.3 保持 Renderer 消息形状不变（`BackendStreamMessage` / `dialogueStream`），Renderer 无感。
- [x] 3.4 验证 MUST NOT 每次召唤 `new StateGraph()`（复用同一持久化图 + checkpointer）。

## 4. 手刹：条件性中断 + 带决策恢复

- [x] 4.1 reviewer/连续性节点条件性 `interrupt()`：有需裁决问题才挂起，payload 为强类型 `ConsistencyIssue[]`（禁 any）；无需介入不挂起。
- [x] 4.2 中断通知经 control-event 通道带 runId 推 Renderer（复用 ipc-contract）。
- [x] 4.3 接通 `resume-run`：接收 approve / reject / modify + 决策数据。
- [x] 4.4 modify：以覆写 reducer 更新 `activeBugs` 后从挂起点继续，MUST NOT 重跑已完成节点。
- [x] 4.5 approve/reject：据此放行 / 终止 / 改道后续流程。

## 5. 手刹：时间旅行

- [x] 5.1 沿 `SqliteCheckpointer.history(id)` 取历史 checkpoint 链，暴露给控制通道。
- [x] 5.2 选定某历史 checkpoint 作为新分支起点重开运行（图从该 state 恢复）。
- [x] 5.3 验证回溯重开不破坏既有 checkpoint 链（新分支挂到选定 parent 下）。

## 6. 历史事实检索与上下文组装

- [x] 6.1 `src/main/orchestration/context-assembler.ts`：按 agent + scope 组装上下文（正文范围 + 事实引用 + 近期 chatHistory），以引用进 `contextRefs`，MUST NOT 塞整库。
- [x] 6.2 `src/main/retrieval/fact-retrieval.ts`：从 `SqliteFactStore` 结构化召回实体/伏笔/时间线（名字/别名/伏笔状态与关键词匹配），每条命中带真实 provenance（NodeRef + 引文）。
- [x] 6.3 各 agent 声明各自组装策略，统一组装器依声明执行、不为每 agent 硬编码分支。

## 7. 软锚点 vs 硬锚点 + 纠偏 + 冲突阻断

- [x] 7.1 硬锚点（`scope:node/selection`）：忠实照做，检索只限该锚点范围，MUST NOT 扩散。
- [x] 7.2 软提示（对话自然语言章号）：内容/语义召回，作者陈述章号仅作软排序提示，MUST NOT 硬过滤。
- [x] 7.3 纠偏回路：软召回命中的真实 provenance 与作者陈述章号不一致时，产出确认/纠偏提示；候选按接近度排序、可标注"最接近"，MUST NOT 默认替作者勾选，作者裁决前 MUST NOT 静默采用任一方。
- [x] 7.4 冲突硬阻断：作者指令与事实库既有事实冲突时硬阻断（不裁决不落笔）；MUST 始终提供"知情放行"逃生选项。
- [x] 7.5 纠偏/冲突提示经 control-event 通道推 Renderer，走与手刹一致的裁决回路。

## 8. 进程归属与边界

- [x] 8.1 图/agent/中断/检索在 Main（或 utilityProcess）；Renderer MUST NOT 触碰图/db/fs/llm（复核 preload 桥）。
  - preload 仅暴露 6 个受限方法（getChapterTree/getChapterContent/getCheckpointHistory/sendCommand/onDialogueStream/onManuscriptStream/onControlEvent），不暴露 ipcRenderer/db/fs/llm。新增的纠偏/冲突经既有 control-event 通道与 FrontendCommandMessage（SummonRunCommand 已是联合成员）走，无新增暴露。
- [x] 8.2 检索/组装接口按"可迁移到 utilityProcess"设计（CPU 密集路径预留）。
  - `fact-retrieval.ts`（retrieveFacts/detectChapterMismatches）与 `fact-consistency.ts`（buildCorrectionIssues/detectInstructionConflicts）均为纯函数（无 I/O、仅读传入视图），文件头已注明 utilityProcess 可迁移；DB 读（getView）由调用方在 Main 完成，跨进程迁移只需把视图结果跨进程传输。

## 9. 冒烟与验证

- [x] 9.1 `src/main/orchestration-smoke.ts` + `tsconfig.smoke.json` 纳入 + `smoke:orchestration` script。
- [x] 9.2 冒烟覆盖：召唤→写手产出→审校挂起→modify/correct 恢复不重跑同一纠偏→time-travel 回溯重开。
- [x] 9.3 冒烟覆盖：软召回作者记错章号→产出纠偏候选（不自动选）；指令撞事实→硬阻断 + 知情放行可通过。
- [x] 9.4 五道门全绿。
- [x] 9.5 `pnpm dev` 手动冒烟：真对话跑通编排 + 手刹 + 一次纠偏/冲突问话（用户执行）。
  - 已手动验证：选中章节诊断会读取章节正文；reviewer 输出问题清单，锚点归一到 manifest 稳定章节 id（如 `3f657668-a68f-490c-bdcf-7ff32b47ddde`）；本地文件日志写入 `userData/logs/orchestration.log`；React ref warning 已修。
