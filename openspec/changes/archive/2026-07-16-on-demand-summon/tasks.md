## 1. 召唤命令协议

- [x] 1.1 定义统一召唤命令（agent/scope/anchor/mode/可选 instruction）强类型 schema
- [x] 1.2 定义 scope 分级（selection/node/document/project）与稳定标识符锚定
- [x] 1.3 明确三入口产出同一命令、后端不依赖来源
- [x] 1.4 明确命令经 IPC 通道携带 runId

## 2. 上下文自动组装

- [x] 2.1 定义按 agent+scope 装配（正文/相关事实/相关素材/对话历史）
- [x] 2.2 明确以引用/检索进入、不塞整库
- [x] 2.3 定义组装策略按 agent 声明、统一组装器执行
- [x] 2.4 明确 CPU 密集组装在 utilityProcess

## 3. 执行语义

- [x] 3.1 定义召唤=向持久图注入命令改路由、复用状态与 checkpointer
- [x] 3.2 定义干完交还控制权（diagnose→END / mutate→挂起）
- [x] 3.3 定义 diagnose 只读、mutate 走局部 diff、mode 严格分流

## 4. 校验

- [x] 4.1 `openspec validate on-demand-summon --strict` 通过
- [x] 4.2 确认与 orchestration-graph/story-workspace/story-bible/corpus-library/surgical-refactor 契约一致
- [x] 4.3 用第四章“九爷”用例验证划词 diagnose 召唤审稿官可锚定检出
