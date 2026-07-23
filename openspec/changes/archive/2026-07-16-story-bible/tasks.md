## 1. 事实数据模型

- [x] 1.1 定义实体模型（类型化、稳定 id、规范名、类型可扩展）
- [x] 1.2 定义属性模型与称呼别名合法集合
- [x] 1.3 定义时间线模型（单向自增时序、事件挂接、支持先后/间隔判定）
- [x] 1.4 定义关系模型（有向/无向、随时序演变）
- [x] 1.5 定义伏笔状态机（planted/pending/paid_off/abandoned）
- [x] 1.6 定义出处锚点（章/场景稳定标识符 + 引文片段 + 置信度）
- [x] 1.7 定义事实状态（confirmed/inferred/conflicting）与优先级规则
- [x] 1.8 定义 SQLite 承载上述模型的存储契约（读写为异步 I/O，归 Main）

## 2. 版本化与 checkpoint 对齐

- [x] 2.1 定义增量非覆盖写入与版本标记
- [x] 2.2 定义事实版本与编排 checkpoint 标识的关联契约
- [x] 2.3 定义按 checkpoint 还原一致事实视图的查询契约
- [x] 2.4 定义“引入时点可追溯”的历史查询

## 3. 增量抽取

- [x] 3.1 定义抽取输入/输出契约（正文+标识符 → 候选事实结构）
- [x] 3.2 定义候选事实的 schema 校验点（转强类型后方可入库）
- [x] 3.3 定义自动入库（低风险 inferred）与冲突挂起（conflicting）规则
- [x] 3.4 定义基于来源锚点的抽取幂等/去重策略

## 4. 一致性检查

- [x] 4.1 定义统一一致性问题模型（type/severity/anchors/description/suggestedFix/requiresHumanDecision）
- [x] 4.2 定义正向检查契约（新文 × 库视图 → 问题列表）及称呼/时间线/OOC/状态等检出项
- [x] 4.3 定义反向检查契约（事实变更 → 候选章节检索 → 比对 → 双锚点问题）
- [x] 4.4 明确反向检查大规模比对归属 utilityProcess，SQLite 读写归 Main
- [x] 4.5 定义悬空伏笔检查
- [x] 4.6 明确 requiresHumanDecision 问题须附选项、系统不代作者决策

## 5. 校验

- [x] 5.1 `openspec validate story-bible --strict` 通过
- [x] 5.2 确认出处锚点复用 story-workspace 稳定标识符的一致性
- [x] 5.3 以第四章“九爷”“七天断流”为正向检查验收参考用例（规划记录，非实现）
