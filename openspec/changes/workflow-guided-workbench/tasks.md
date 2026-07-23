## 1. Core 工作流领域模型与纯状态机

- [ ] 1.1 [Core] 定义 `WorkflowKind`、`WorkflowStatus`、`StageStatus`、`StageActor`、`WorkflowScope`、`WorkflowRef`、`WorkflowInstance`、`WorkflowStageInstance` 与 artifact/blocking reason 精确类型，保持无 Electron/React/LangGraph 依赖
- [ ] 1.2 [Core] 定义版本化模板、稳定 stage id、允许专家、完成证据、可跳过性、质量门与 transition 的类型契约
- [ ] 1.3 [Core] 实现工作流纯状态转换与合法性校验（开始、关联 run、成功/失败、确认、重试、跳过、暂停、恢复、取消、完成），包含版本/幂等 operation id 检查
- [ ] 1.4 [Core] 定义 `WorkflowIssueRecord`、问题生命周期转换和修订/复检证据类型
- [ ] 1.5 [Core] 定义 `CreativeAsset` 判别联合、版本/出处、字段级 `CreativeAssetChangeSet`、资产依赖与 `AssetImpactSet` 精确类型
- [ ] 1.6 [Core/Test] 覆盖非法跳过、失败不推进、重试保留 run、重复命令幂等、问题只有复检后 resolved 等状态机单元测试

## 2. 内置业务模板

- [ ] 2.1 [Core] 建立 `new-book-creation` v1 模板，覆盖策划阶段、按章节创作循环、事实抽取/审校门、章节定稿与最终全书总检
- [ ] 2.2 [Core] 建立 `legacy-book-revision` v1 模板，覆盖导入、事实回填、全书总检、按 issue 修订循环与最终全书复检
- [ ] 2.3 [Core] 为两套模板声明 author/expert/system/quality-gate actor、允许专家、自动推进边界、阻塞条件和可跳过阶段
- [ ] 2.4 [Core/Test] 用表驱动测试验证两套模板的正常路径、章节循环、问题复检失败回环、最终复检发现新问题回环及人工门不自动推进
- [ ] 2.5 [Core/Test] 验证任意阶段的 asset-maintenance activity 不改变主 `currentStageId`，仅按影响级别标记相关阶段 stale/needs-review/blocked

## 3. SQLite 持久化与应用服务

- [ ] 3.1 [Main/SQLite] 新增可回滚迁移，创建 workflow instance、stage snapshot、stage-run link、artifact ref、creative asset/version/dependency/change-set/impact、workflow issue、issue-checkpoint/verification link 表及必要索引
- [ ] 3.2 [Main] 实现 workflow repository 的创建、查询、乐观版本更新、项目 active workflow 唯一约束和事务化保存
- [ ] 3.3 [Main] 实现 workflow application service，作为阶段状态、run 关联和问题生命周期的唯一写入口
- [ ] 3.4 [Main] 实现模板版本固定与实例阶段快照恢复，确保升级后既有实例不被静默改道
- [ ] 3.5 [Main] 实现 creative asset repository 与应用服务，版本化提交 change set，并将 confirmed 人物/世界观约束映射到 Story Bible 来源联合
- [ ] 3.6 [Main] 实现基于显式 asset refs、Story Bible 关系和稳定 scope 的影响分析，持久化 stale/needs-review/conflicting 与作者处理决定
- [ ] 3.7 [Main/Test] 覆盖应用重启恢复、单项目 active 唯一约束、资产/Story Bible 原子提交回滚、base version 冲突、旧版本命令冲突和重复 operation 幂等测试

## 4. IPC 契约与 Main 边界验证

- [ ] 4.1 [Core/IPC] 定义 workflow/creative asset snapshot、allowed action、command failure、工作流/资产命令与事件判别联合及可选 `workflowRef`
- [ ] 4.2 [Core/IPC] 为既有 stream/node/interrupt/review/refactor 事件增加向后兼容的可选 `workflowRef`，issue scope 时携带 `issueId`
- [ ] 4.3 [Main/IPC] 实现启动/查询、阶段开始/确认/重试/跳过、工作流暂停/恢复/取消、问题选择/忽略/复检，以及资产查询/澄清/change-set 确认拒绝/影响处理 handler
- [ ] 4.4 [Main/IPC] 校验项目、workflow/stage/issue 归属、实例版本、允许动作、锚点和 active run，事务提交后再发布快照事件
- [ ] 4.5 [Renderer Bridge] 暴露受限工作流命令与事件订阅 API，不向 Renderer 暴露 repository、SQLite 或业务状态转换函数
- [ ] 4.6 [IPC/Test] 覆盖 standalone 事件兼容、伪造 issue/asset 归属、过期资产 base version、旧快照冲突、重连查询最新快照及结构化错误通路

## 5. LangGraph 阶段归属与恢复路由

- [ ] 5.1 [Core/Main] 在 `NovelState` 及 LangGraph annotation 桥接中加入可选 `workflowRef`，不复制完整 WorkflowInstance 或问题队列
- [ ] 5.2 [Main] 启动阶段运行前校验模板允许专家/动作，并在 start/complete/fail/interrupt 时记录 stage-run 与完成证据
- [ ] 5.3 [Main] 将普通后续意见/`@专家` 区分为当前阶段内运行、目标资产澄清或 standalone：跨阶段人物/世界观/大纲澄清优先消歧目标资产并保持主阶段，非资产调用才返回 standalone/暂停或切换选择
- [ ] 5.4 [Main] 定义并持久化 interrupt continuation record（source node、workflow/stage/issue、continuation kind、allowed decisions）
- [ ] 5.5 [Main] 实现 continuation resolver，按阶段与中断来源决定恢复目标，移除 `correct` / `modify` 固定导向 writer 的通用假设
- [ ] 5.6 [Main/Test] 覆盖人物设计 modify 回人物阶段、审校问题 modify 进局部修复、错误阶段恢复拒绝、重复恢复幂等和 standalone resume 兼容
- [ ] 5.7 [Main/Test] 回归现有 LangGraph `tasks + values`、单一有状态图、checkpointer 与真实节点事件顺序，禁止模板阶段产生虚假节点事件

## 6. 新书创作工作流接入

- [ ] 6.1 [Main] 将 concept-generator、worldbuilding、character-generator、architect/scene-outliner 产物接入对应 CreativeAsset 的候选变更与作者确认门；无章节锚点的项目资产仍必须持久化
- [ ] 6.2 [Main] 实现章节/分场规划、正文写作、事实抽取、自动审校和人工修改/验收的 chapter scope 推进
- [ ] 6.3 [Main/utilityProcess] 将事实抽取结果、冲突裁决和审校结果映射为质量门证据；CPU 密集处理继续在既有 worker 边界
- [ ] 6.4 [Main] 实现章节定稿后的“下一章/结束创作”作者决策，创建新 chapter scope 循环或进入全书总检
- [ ] 6.5 [Integration Test] 覆盖“人物设计初稿 → 多轮人工意见 → 资产确认/Story Bible 同步 → 下一阶段”和“一章写作 → 抽取 → 审校 → 修改/复检 → 定稿 → 下一章”主路径
- [ ] 6.6 [Integration Test] 覆盖正文写作中随时澄清人物/世界观：目标资产消歧、change set 确认、新版本、影响清单、主阶段保持及 blocking/non-blocking 影响分流

## 7. 老书问题修订闭环

- [ ] 7.1 [Main/utilityProcess] 将项目导入、全书事实回填与首次全书总检接入老书模板，并记录 factVersion 与 audit run 引用
- [ ] 7.2 [Main] 将总检 `ConsistencyIssue` 映射/去重为持久化 workflow issue records，并支持按 severity/status 选择修订项
- [ ] 7.3 [Main] 将问题定位、实际改写片段生成、diff/hunk 会话与稳定 issue/chapter/node 锚点关联；锚点失效时阻塞而非猜测写入
- [ ] 7.4 [Main] 在 `refactor-applied` 事务结果中关联 accepted hunks、checkpoint 与 issue，并仅将问题推进到 verifying
- [ ] 7.5 [Main] 按问题类型/锚点/影响范围选择 reviewer、fact-checker 或 plagiarism-checker 执行针对性复检，并据结构化结果转 resolved 或返回 fixing
- [ ] 7.6 [Main/utilityProcess] 在队列均 resolved/dismissed 后运行最终全书复检；新问题或复发问题重新进入队列，通过且作者确认后完成工作流
- [ ] 7.7 [Integration Test] 覆盖“总检 → 选择问题 → 定位 → 改写 → hunk → checkpoint → 复检失败回环/成功关闭 → 最终总检”及 dismissed 理由审计

## 8. 审校卡片、改写面板与质量仪表盘

- [ ] 8.1 [Renderer] 在审校问题卡片显示 open/fixing/verifying/resolved/dismissed、下一动作及 dismissed 理由，保持原有严重度与锚点连线
- [ ] 8.2 [Renderer] 从问题卡片发起修复时保留 workflow/stage/issue 与章节锚点，切换并等待目标章节加载；无锚点时禁用写入入口
- [ ] 8.3 [Renderer] 将 `suggestedFix` 作为只读修改建议展示，改写正文输入保持独立且为空，只有实际 rewritten text 才可计算 diff
- [ ] 8.4 [Renderer] 在 hunk 落盘后按后端快照显示 checkpoint 与 verifying，全部拒绝时不伪造修复状态
- [ ] 8.5 [Renderer] 扩展质量仪表盘的 lifecycle/status 筛选、来源审计、checkpoint/复检追溯与最终复检新问题/复发提示
- [ ] 8.6 [Renderer] 新增资产目标选择、字段级 change set 确认/拒绝、版本冲突和影响清单 UI；只上报意图，不在本地提交资产或判定影响
- [ ] 8.7 [Renderer Test] 覆盖建议与正文分离、跨章节修复、资产澄清消歧/确认、锚点缺失、待复检、已解决/已忽略区分及 Renderer 不本地关闭问题/写资产

## 9. 专家工作台双层视图

- [ ] 9.1 [Renderer] 新增工作流快照 hook/store，按项目查询并消费 `workflow-snapshot-updated`，重载时不依赖本地事件重放
- [ ] 9.2 [Renderer] 在 `ExpertWorkbench` 上层呈现工作流类型/目标、阶段列表、actor、状态、进度、阻塞原因、下一步与允许动作，并将横切资产澄清/影响提醒与主阶段分开展示
- [ ] 9.3 [Renderer] 保留并复用现有 `WorkbenchGraph` / `useWorkbenchActivities` 作为下层当前阶段真实 run 轨迹，不改写节点事件语义
- [ ] 9.4 [Renderer] 确保新 run 只重置下层轨迹，上层跨 run 历史不清空；standalone run 继续显示既有单次视图
- [ ] 9.5 [Renderer] 调整折叠摘要为“工作流 + 当前阶段 + 下一步/阻塞”，并保证工具抽屉与三轴布局职责不回退
- [ ] 9.6 [Renderer Test] 覆盖人物设计多 run、写作中资产澄清但主阶段不变、资产影响阻塞/待办、暂停/等待确认/失败、章节循环、issue 循环、折叠摘要及 standalone 兼容

## 10. 迁移、回归与验收

- [ ] 10.1 [All] 更新相关文档与 smoke fixture，记录 `workflowId`/`runId` 语义、两套模板、人工门和 standalone 兼容路径
- [ ] 10.2 [Core/Main] 运行 node TypeScript、ESLint、领域/SQLite/IPC/LangGraph 单元与集成测试
- [ ] 10.3 [Renderer] 运行 web TypeScript、ESLint、组件测试和 Electron build
- [ ] 10.4 [Smoke] 扩展并运行 orchestration smoke，验证阶段允许专家、跨 run 聚合、continuation 路由与既有单次召唤
- [ ] 10.5 [E2E] 完整验收新书主路径、任意阶段资产澄清链路和老书修订主路径，确认策划信息落入对应版本化资产、约束事实可追溯、所有正文写入均经过局部 diff + 逐 hunk，Renderer 无 DB/LLM/fs 访问
- [ ] 10.6 [OpenSpec] 运行 `npx openspec validate workflow-guided-workbench --strict`，并在所有实现与验证完成前保持 change 未归档
