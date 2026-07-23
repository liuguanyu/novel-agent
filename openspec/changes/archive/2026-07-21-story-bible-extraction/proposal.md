## Why

I3 已经把 `SqliteFactStore` 接进编排运行时：reviewer 能读取事实库做历史事实召回、章号纠偏与指令冲突硬阻断。但事实库目前仍主要依赖测试夹具或最小手工写入，真实创作时库里经常是空的；这会导致 I3 的检索链路只能降级，无法真正成为长篇小说的“活的符号表”。

I4 的目标是让事实库随正文自动生长：从已导入/新写出的章节正文中抽取人物、别名、属性、时间线事件、关系与伏笔候选，经 schema 校验与冲突判定后写入 `SqliteFactStore`。低风险不冲突的事实自动入库为 `inferred`，与既有事实冲突或高风险的候选进入手刹裁决，MUST NOT 静默覆盖作者已确认的事实。

这样 I3 的 reviewer/上下文组装才有真实资料可查，后续 I5 全书总检、I6 局部重构、I7 素材检索也有稳定事实底座。

## What Changes

- **事实抽取运行时**：新增 Main 侧事实抽取服务，从 `ExtractionInput{location,text}` 调用模型，解析并校验 `ExtractionOutput{candidates}`，支持 fenced JSON、半截 JSON、字段漂移的防守解析。
- **候选事实规范化**：把模型候选 payload 规范化为 core/story-bible 的实体、属性/别名、时间线事件、关系、伏笔结构；所有事实必须带 provenance（稳定 NodeRef + 原文 quote + confidence）。
- **冲突判定与入库计划**：对候选与当前 `FactView` 做确定性预检：低风险新事实自动入库为 `inferred`；疑似覆盖/矛盾 confirmed 事实、高风险状态变更标为 `conflicting` 并产出需人工裁决的问题。
- **幂等入库**：对同一章节重复抽取 MUST 基于来源锚点 + kind + identityKey 去重/更新，MUST NOT 堆积重复实体、重复别名、重复时间线事件或重复伏笔。
- **接入编排/召唤**：在 writer/reviewer 运行后或作者显式触发“抽取事实”时，将当前章节正文提交抽取；写入 `SqliteFactStore` 时创建新的 fact version，并关联最近的 checkpoint/章节锚点。
- **人工裁决回路**：抽取冲突复用 I3 的 interrupt/resume/control-event 管道，下发强类型冲突报告；作者可接受新事实、保留旧事实、手工修改或知情忽略，系统不替作者选择。
- **导入/补库路径**：支持对 manifest 中已有章节做按章补抽，至少提供可复现 smoke 脚本验证从真实 Markdown 章节抽取→入库→I3 检索命中。

## Capabilities

### Modified Capabilities

- `fact-extraction`: 从契约推进为运行时能力：模型抽取、校验、规范化、冲突预检、入库与幂等。
- `fact-store-runtime`: 扩展事实库存储/查询能力以支持按来源去重、候选合并、版本关联与抽取批次可追踪。
- `orchestration-runtime`: 在编排运行中接入事实抽取/入库节点或后置步骤，使新正文能反哺事实库；冲突走既有手刹裁决。
- `ipc-contract`: 增加事实抽取进度/结果/冲突的强类型控制事件或命令，保持 Renderer 不直接触碰 DB/LLM/fs。

## Impact

- 依赖 `orchestration-runtime`（I3：手刹、checkpoint、事实检索链路）、`persistence-sqlite`（I2：`SqliteFactStore` / DB 生命周期）、`walking-skeleton`（Main/Renderer/LLM adapter 竖切）、`story-bible`（事实模型与抽取契约）、`story-workspace`（稳定 NodeRef/manifest）、`agent-orchestration`（节点/状态契约）、`human-in-the-loop`（裁决语义）、`bootstrap-foundation`（进程与工程规范）。
- 不新增 native 依赖；继续使用现有 OpenAI-compatible adapter 和 `node:sqlite`。
- LLM 抽取可能产生噪声，因此所有模型输出必须经过 schema 校验、provenance 绑定、状态分级和冲突预检；confirmed 事实不得被自动覆盖。
- 本波不做全书 Map-Reduce 总检（I5）、不做局部 diff 修稿落库（I6）、不做 embedding 素材库（I7）。
