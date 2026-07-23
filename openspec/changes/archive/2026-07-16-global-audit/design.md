## Context

全书总检解决长篇的“宏观逻辑塌方”：跨越几十万字的伏笔悬空、人设崩塌、时空死锁。核心策略是**不读正文
水字，只对撞事实库沉淀的高维骨架**，用 Map-Reduce 分片-归并跑完全书，产出 SonarQube 式质量仪表盘。
问题模型复用 story-bible 的统一一致性问题结构，一键修复复用 surgical-refactor 的局部 diff。本 change
只定义分片对撞语义与仪表盘契约，不做仪表盘视觉控件、不写代码。

## Goals / Non-Goals

**Goals:**
- Map-Reduce 只对撞事实库骨架检出全局矛盾，不逐字重读正文，计算在 utilityProcess。
- 总检问题复用 story-bible 统一一致性问题模型，与局部检查同构。
- 质量仪表盘：健康度评分 + 红黄牌列表 + 一键跳章 + 一键修复（走局部 diff）。
- 总检为可中断的离线批处理。

**Non-Goals:**
- 不实现仪表盘的视觉控件与抽屉布局（electron-shell-ui）。
- 不实现 diff 计算与 hunk 评审（surgical-refactor）。
- 不重新定义一致性问题模型（复用 story-bible consistency-check）。
- 不编写实现代码。

## Decisions

### D1. Map-Reduce，只对撞骨架
- Map 阶段 MUST 从事实库按章/实体分片抽取骨架：实体状态时间线、伏笔状态机、人设特征弧光。
- Reduce 阶段 MUST 跨片对撞检出全局矛盾：时空死锁、伏笔长期悬空、人设崩塌/弧光断裂、状态矛盾。
- 系统 MUST NOT 逐字重读正文“水字”做总检；对撞对象是结构化骨架。这保证成本随实体/骨架量而非字数暴涨。
- 涉及语义比对的宏观检查（如人设弧光）MAY 检索向量库（corpus/历史章节 embedding）辅助，但仍以骨架为主。

### D2. 进程归属：utilityProcess
- Map-Reduce 属 CPU 密集且数据量大，MUST 在 utilityProcess/worker 执行。
- 结果聚合、健康度计算与跳章编排在 Main；Renderer 只渲染。主进程事件循环 MUST NOT 阻塞。

### D3. 问题复用统一模型
- 总检产出的每个问题 MUST 复用 story-bible consistency-check 的统一结构（type/severity/anchors/
  description/suggestedFix?/requiresHumanDecision），使局部与全局问题可统一渲染、排序、修复。
- 需人工决策的问题（如“改设定 or 改旧文”）MUST 附选项，系统 MUST NOT 替作者选择。

### D4. 健康度评分与红黄牌
- 系统 MUST 产出全局故事健康度评分与按 severity 分级的问题列表（CRITICAL 红牌 / WARNING 黄牌 / 其他）。
- 评分算法 MUST 可解释（由问题数量与严重度加权得出），MUST NOT 是黑盒魔数；具体权重可配置。

### D5. 一键跳章与一键修复
- 点击任一问题 MUST 经 story-workspace 稳定标识符定位到对应冲突章节（防漂移）。
- 一键修复 MUST 走 surgical-refactor 局部 diff 通道，逐 hunk 接受，MUST NOT 整章覆盖。

### D6. 触发与中断
- 总检为离线批处理，可在完稿/大节点手动触发（不强制在写作流内）。
- 长任务 MUST 可中断（遵循 human-in-the-loop abort 语义），中断后已完成分片结果 SHOULD 可保留供查看。

## Risks / Trade-offs

- **风险：骨架抽取不全导致漏检。** 缓解：骨架抽取复用 fact-extraction/chronicle 的同一套实体状态差量逻辑，
  与增量落盘一致；总检只是批量重放对撞。
- **风险：健康度评分被误当作绝对权威。** 缓解：评分可解释、附问题明细，定位为“提示”而非“判决”。
- **风险：大部头总检耗时长。** 缓解：分片并行 + utilityProcess + 可中断 + 增量（仅重算受影响分片，
  增量策略细节可后置）。
- **权衡：向量辅助的宏观检查有一定不确定性。** 取舍：以骨架硬对撞为主、语义为辅，人设弧光类问题标注置信度。
