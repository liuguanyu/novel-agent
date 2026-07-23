## 1. 共享状态

- [x] 1.1 定义 NovelState 精确类型（Annotation.Root 风格，禁 any）
- [x] 1.2 定义关键字段（currentChapterId/currentDraft/chatHistory/activeBugs/currentAction/agentStatus）
- [x] 1.3 定义 reducer 语义（对话累加、activeBugs 可覆写）
- [x] 1.4 定义事实/素材以引用进入状态（版本/作用域，不塞整库）

## 2. 图拓扑

- [x] 2.1 定义 supervisor 路由与 currentAction 分发
- [x] 2.2 定义专家节点清单（借鉴 LibriScribe 分工，可扩展）
- [x] 2.3 定义条件路由与写-审-改循环及终止条件
- [x] 2.4 明确“单一有状态图 + 注入命令改路由”原则（为 on-demand-summon 铺垫）
- [x] 2.5 明确编排/节点归属 Main 或 utilityProcess

## 3. agent 节点契约

- [x] 3.1 定义节点单一职责（组 prompt→调模型→解析校验→写状态）
- [x] 3.2 定义输出 schema 校验点与失败处理
- [x] 3.3 定义审稿/核查节点输出遵循 story-bible 一致性问题模型

## 4. 提示词加载

- [x] 4.1 定义 YAML 模板结构（对齐 LibriScribe：name/description/template/variables/settings）
- [x] 4.2 定义加载、必填变量校验、slot 填充、缺失回退
- [x] 4.3 定义档位声明及经 model-adapter 解析
- [x] 4.4 规划从 references/ 移植/中文化种子提示词（记录，非本 change 实现）

## 5. checkpointer

- [x] 5.1 定义 SQLite checkpointer 在节点边界持久化
- [x] 5.2 定义 checkpoint 标识的产出与查询
- [x] 5.3 定义中途 abort 时不提交、最近 checkpoint 为干净态
- [x] 5.4 明确 checkpointer I/O 归 Main（非阻塞）
- [x] 5.5 对接 story-bible 事实版本的 checkpoint 关联契约

## 6. 校验

- [x] 6.1 `openspec validate agent-orchestration --strict` 通过
- [x] 6.2 确认与 human-in-the-loop / on-demand-summon / surgical-refactor 的依赖接口一致
