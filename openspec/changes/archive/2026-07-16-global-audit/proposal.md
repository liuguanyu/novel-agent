## Why

局部召唤审稿官只能看一段，但长篇写到几十万字后，作者需要一次**全书总检**：第 3 章埋的暗号到第 22 章
还没回收、第 4 章部署的接头方式直到人物意外死亡也没触发、某角色人设在中段悄悄崩了。逐字重读几十万字
不现实，也没必要。

关键洞察：**总检不读正文水字，只对撞事实库（SQLite）里沉淀的高维骨架**——实体状态时间线、伏笔状态机、
人设弧光。这是 Map-Reduce 架构：Map 阶段按章/实体分片抽取骨架事实，Reduce 阶段跨片对撞出全局矛盾。
全程 CPU/IO 密集且量大，MUST 在 utilityProcess 跑，绝不阻塞 UI。

产出是一个 **SonarQube 式的“小说质量仪表盘”**：全局健康度评分 + 红黄牌问题列表（🔴 CRITICAL 人设崩塌 /
🟡 WARNING 伏笔悬空），点击任一问题一键跳转到对应冲突章节。问题模型复用 story-bible 的统一一致性问题
结构（type/severity/anchors/…），一键修复走 surgical-refactor 的局部 diff 通道。

本 change 定义全书总检的分片对撞语义与质量仪表盘契约（spec 层面）。不写代码。

## What Changes

- 定义 **Map-Reduce 总检**：Map 阶段从事实库按章/实体分片抽取骨架（实体状态时间线、伏笔状态、人设特征），
  Reduce 阶段跨片对撞检出全局矛盾（时空死锁、伏笔悬空、人设崩塌/弧光断裂、状态矛盾）；MUST 只对撞结构化
  骨架，MUST NOT 逐字重读正文水字。计算 MUST 在 utilityProcess。
- 定义 **总检问题复用统一模型**：产出的每个问题 MUST 复用 story-bible 一致性问题结构（type/severity/
  anchors/description/suggestedFix?/requiresHumanDecision），使局部检查与全局总检同构、可统一渲染与修复。
- 定义 **质量仪表盘**：呈现全局故事健康度评分与按严重度分级的问题列表（红/黄牌），每条含定位锚点。
- 定义 **一键跳章与一键修复**：点击问题 MUST 经稳定标识符定位到对应章节；一键修复 MUST 走 surgical-refactor
  局部 diff 通道，MUST NOT 整章覆盖。
- 定义 **触发时机**：总检为离线批处理，可在完稿/大节点手动触发；MUST 可中断（长任务遵循 abort 语义）。

## Capabilities

### New Capabilities
- `map-reduce-audit`: 只对撞事实库骨架的分片-归并全书总检（utilityProcess）。
- `quality-dashboard`: 健康度评分 + 红黄牌问题列表 + 一键跳章/修复。

### Modified Capabilities
<!-- 无。 -->

## Impact

- 依赖 `story-bible`（骨架事实来源、统一一致性问题模型、fact-versioning 视图）、`story-workspace`
  （稳定标识符跳章）、`surgical-refactor`（一键修复走局部 diff）、`human-in-the-loop`（长任务可中断）、
  `bootstrap-foundation`（utilityProcess 承载 Map-Reduce、IPC 回传结果）、`agent-orchestration`
  （复用审稿/架构类 agent 与提示词）。
- 为 `electron-shell-ui`（仪表盘抽屉、红黄牌列表、点击跳章）提供数据与交互契约。
- Map-Reduce 计算位于 utilityProcess（CPU 密集、量大）；结果聚合与跳转编排在 Main；Renderer 只渲染仪表盘。
