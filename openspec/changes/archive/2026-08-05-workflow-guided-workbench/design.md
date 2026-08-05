## Context

现有系统已经具备可复用的底层零件：LangGraph 单次运行及 `tasks + values` 事件、按需专家召唤、interrupt/resume、事实抽取与全书回填、结构化审校问题、全书总检、局部 diff、逐 hunk 裁决和 checkpoint。专家工作台也能按 `runId` 显示真实节点顺序。

缺失的是位于这些零件之上的业务流程层。一次人物设计初稿、一次作者补充和一次人物修订会产生多个 `runId`，当前前端在新运行开始时清空上一轮轨迹，因此无法判断这些运行仍属于“人物设计”阶段。类似地，全书总检发现的问题与后续改写、checkpoint、复检之间没有长期关联，不能可靠地说明问题是否已解决。

本设计引入框架无关的长期工作流领域模型。它不替代 LangGraph，也不把静态模板编译成一张巨型图；工作流服务负责业务阶段与长期状态，LangGraph 继续负责阶段内部一次具体专家运行。主要使用者是作者、Main 编排层、全书 worker 和 Renderer 专家工作台。

约束：

- Renderer 不得访问 SQLite、LLM、文件系统或执行阶段判定。
- LangGraph/agent 位于 Main 或 utilityProcess；CPU 密集的回填和总检继续位于 utilityProcess。
- 写入正文仍必须经过局部 diff 和逐 hunk 裁决，不允许整章覆盖。
- 现有单次召唤必须兼容；不是所有专家调用都必须加入长期工作流。
- `NovelState` 只保存当前运行所需引用，不能承载完整工作流历史。

## Goals / Non-Goals

**Goals:**

- 用稳定 `workflowId` 将多个 `runId` 聚合到一个新书创作或老书修订流程。
- 提供明确的完整阶段、当前阶段、状态、阻塞原因、下一步和进度。
- 定义两套可执行的内置模板，以及自动推进和人工确认边界。
- 保持“业务阶段计划”和“真实 LangGraph 节点轨迹”两层语义，不互相冒充。
- 使普通对话、`@专家`、人工裁决和运行恢复都能按当前阶段正确归属/路由。
- 使审校问题通过局部修改、checkpoint、针对性复检进入可审计的关闭状态。
- 支持应用重启后的工作流恢复，并支持无活动工作流的兼容模式。

**Non-Goals:**

- 不在本 change 中提供用户自定义模板编辑器或任意 DAG 编排器。
- 不重写现有 LangGraph `tasks + values` 追踪，不移除单次运行时间线。
- 不允许 AI 绕过作者确认自动落盘改写。
- 不在模板中硬编码具体模型/provider。
- 不把策划专家产物直接送入正文审校，也不强制所有阶段线性无回退。
- 不在本 change 中解决多人协同、云同步或跨设备合并。

## Decisions

### 1. 业务工作流与 LangGraph 分层

采用两层模型：长期业务工作流状态机在 Main 的 workflow application service 中运行；每次具体专家工作仍由现有 LangGraph 执行。

```text
WorkflowInstance (workflowId)
  └─ WorkflowStageInstance (stageId)
       ├─ runId A: 初稿
       ├─ runId B: 作者补充
       └─ runId C: 修订/确认
```

`runId` 只标识一次可流式、可中断的执行；`workflowId` 标识跨运行、跨重启的业务目标。LangGraph 节点事件通过 `runId` 关联到 stage run record，工作台下层只呈现当前阶段选中/最近运行的真实轨迹。

备选方案是把两套完整流程都实现为一张巨型 LangGraph。拒绝原因：长期人工停顿、章节循环、批量问题修订和单次召唤兼容会使图拓扑与迁移过度复杂，也会混淆业务阶段和实现节点。

### 2. Core 定义不可变模板与精确类型实例

Core 提供框架无关的领域类型，建议契约如下：

```ts
type WorkflowKind = 'new-book-creation' | 'legacy-book-revision';
type WorkflowStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
type StageStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'awaiting-confirmation'
  | 'completed'
  | 'skipped'
  | 'failed';

type StageImpactStatus = 'none' | 'stale' | 'needs-review' | 'conflicting';

type StageActor = 'system' | 'expert' | 'author' | 'quality-gate';

type WorkflowScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'chapter'; projectId: string; chapterId: string }
  | { kind: 'issue'; projectId: string; issueId: string };

interface WorkflowInstance {
  readonly workflowId: string;
  readonly projectId: string;
  readonly kind: WorkflowKind;
  readonly templateVersion: number;
  readonly objective: string;
  readonly status: WorkflowStatus;
  readonly currentStageId: string;
  readonly stages: ReadonlyArray<WorkflowStageInstance>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface WorkflowStageInstance {
  readonly stageId: string;
  readonly templateStageId: string;
  readonly status: StageStatus;
  /** Cross-cutting impact state; never a stage lifecycle status. */
  readonly impactStatus: StageImpactStatus;
  readonly actor: StageActor;
  readonly scope: WorkflowScope;
  readonly runIds: ReadonlyArray<string>;
  readonly artifactRefs: ReadonlyArray<WorkflowArtifactRef>;
  readonly blockingReason?: WorkflowBlockingReason;
  readonly enteredAt?: string;
  readonly completedAt?: string;
}
```

模板使用稳定 `templateStageId` 和显式 transition/gate 定义；实例创建时记录 `templateVersion`。实例保存阶段快照而非每次读取最新模板，避免软件升级后正在进行的工作流被静默改道。

备选方案是只存 `currentStage` 和百分比。拒绝原因：无法恢复历史阶段、解释跳过/失败，也无法关联多个运行和产物。

### 3. 阶段推进由命令 + 完成证据驱动

Main workflow service 是阶段状态的唯一写入者。所有推进都由强类型命令和完成证据触发：开始阶段、关联运行、记录产物、运行成功/失败、作者确认、跳过、暂停、恢复、质量门通过/未通过。

自动推进仅用于无歧义、无写入风险的系统步骤，例如事实抽取成功后进入自动审校。以下情况必须进入 `awaiting-confirmation` 或 `blocked`：

- 立意、世界观、人物、大纲等策划产物验收；
- 章节/分场规划确认；
- 存在需要作者决策的冲突；
- 逐 hunk 接受/拒绝及正文落盘；
- 章节定稿和是否进入下一章；
- 问题无法通过复检或锚点失效。

跳过必须由模板声明 `skippable`，并由作者明确操作。失败不会自动标记完成；可重试阶段保留 run 历史并生成新 `runId`。

### 4. 两套模板采用“主阶段 + 循环子域”

新书模板不是一次性直线：策划阶段完成后进入按章节循环的创作子域。每章依次经过章节规划、分场大纲、正文写作、事实抽取、自动审校、人工修改/验收和章节定稿；作者选择下一章时创建/重置带新 chapter scope 的阶段实例，结束创作时进入全书总检。

老书模板以全书总检生成的问题集合为修订队列。每个选中问题进入 issue scope 的定位、方案、hunk、checkpoint、复检循环；问题解决或 dismiss 后返回问题选择，队列处理完成后运行最终全书复检。最终复检发现的新问题或复发问题会回到问题清单，而不是直接完成。

模板只规定业务阶段和门，不复制各底层能力内部实现。

### 5. 策划产物是长期创作资产，不是阶段对话附件

立意、世界观、人物、全书大纲、章节规划和分场大纲使用独立 `CreativeAsset` 聚合存储，并通过稳定 `assetId` 和版本被工作流阶段、正文与其他资产引用。建议契约如下：

```ts
type CreativeAssetKind =
  | 'concept'
  | 'worldbuilding'
  | 'character'
  | 'book-outline'
  | 'chapter-plan'
  | 'scene-outline';

interface CreativeAsset {
  readonly assetId: string;
  readonly projectId: string;
  readonly kind: CreativeAssetKind;
  readonly scope: WorkflowScope;
  readonly content: CreativeAssetContent;
  readonly version: number;
  readonly status: 'draft' | 'confirmed' | 'deprecated' | 'conflicting';
  readonly provenance: CreativeAssetProvenance;
}
```

人物/世界观资产保存作者设计意图，其中可用于一致性约束的 confirmed 字段显式映射到 Story Bible，并以 asset id/version/字段路径作为来源。全书/章节/分场大纲中的未发生计划保留为资产，不自动成为“已发生”的 confirmed 事实。这样避免把所有策划文本硬塞进事实模型，同时保持约束与来源可追溯。

资产写入采用版本化 change set，而不是覆盖 currentDraft。AI 从作者澄清中生成字段级候选变更，作者确认后 Main 才提交新版本。无章节锚点的项目级人物/世界观澄清仍可落到资产，不能退化为仅对话显示。

### 6. 资产澄清是横切活动，不强迫主流程回退

作者可以在任意工作流阶段或 standalone 上下文澄清资产。澄清运行关联目标 `assetId`、base version、可选 workflow/stage 和独立 activity 状态，但不改变主工作流 `currentStageId`。若目标不明确，必须先由作者消歧；不得猜测同名人物或世界规则。

资产提交后由 Main 计算 `AssetImpactSet`：基于显式 asset refs、Story Bible 关系和稳定 manuscript scope 找出依赖旧版本的规划、正文和质量结果。受影响对象通过独立的 `StageImpactStatus`/`impactStatus` 标记为 `stale`、`needs-review` 或 `conflicting`，不改变 `StageStatus`；由作者选择立即处理、记入待办或继续当前阶段；系统不能静默重写正文、自动撤销定稿或强制跳回早期阶段。

备选方案是每次澄清都把主工作流退回“人物设计/世界观”阶段。拒绝原因：作者可能在任何时点做局部澄清，回退会破坏当前章节工作上下文，也无法表达仅影响未来章节的低风险变化。

### 7. 对话和 `@专家` 按阶段迭代或资产澄清路由

当存在 active workflow 且当前阶段允许该专家时：

- 普通后续意见沿用最近明确专家并挂载当前阶段；
- `@专家` 覆盖本轮目标专家，但只有模板允许的专家才能作为该阶段运行；
- 同一阶段每次发送产生新 `runId` 并追加到 `runIds`，不会自动推进阶段；
- 阶段推进需要完成证据或作者确认。

当消息明确指向一个既有创作资产或表达“澄清/更正/补充设定”意图时，路由器优先提供资产候选并进入 asset-maintenance activity，而不是以“不适用于当前阶段”拒绝。例如正文写作阶段的 `@人物设计师` 可以更新人物资产，同时保持写作阶段不变。若既不属于当前阶段也不指向资产，Renderer 才展示作为 standalone 召唤或暂停/切换流程的结构化选择。系统不得静默改写阶段；无 active workflow 时保持现有单次召唤行为。

### 8. 恢复路由使用显式 continuation，不按 decision kind 硬编码

中断记录保存 `workflowId`、`stageId`、`runId`、`sourceNode`、`continuationKind` 和允许的 decision kinds。恢复时 Main 先校验命令与中断记录匹配，再由 continuation resolver 结合模板阶段和来源决定下一目标。

例如人物设计冲突的 `modify` 返回人物设计阶段，审校问题的 `modify` 进入问题修复阶段，正文审校自动修订才可能返回 writer。禁止将通用 `correct` / `modify` 固定映射为 writer。

### 9. 问题生命周期与修订证据独立持久化

在现有 `ConsistencyIssue` 内容模型之上增加 workflow issue record：

```ts
type WorkflowIssueStatus =
  | 'open'
  | 'fixing'
  | 'verifying'
  | 'resolved'
  | 'dismissed';

interface WorkflowIssueRecord {
  readonly issueId: string;
  readonly workflowId: string;
  readonly sourceAuditRunId: string;
  readonly status: WorkflowIssueStatus;
  readonly anchorRefs: ReadonlyArray<string>;
  readonly refactorRunIds: ReadonlyArray<string>;
  readonly checkpointIds: ReadonlyArray<string>;
  readonly verificationRunIds: ReadonlyArray<string>;
  readonly discoveryHistory: ReadonlyArray<WorkflowIssueHistoryEntry>;
  readonly auditHistory: ReadonlyArray<WorkflowIssueHistoryEntry>;
  readonly transitionHistory: ReadonlyArray<WorkflowIssueHistoryEntry>;
  readonly resolutionHistory: ReadonlyArray<WorkflowIssueHistoryEntry>;
  readonly resolutionReason?: string;
}
```

状态转换为：`open → fixing → verifying → resolved`；复检失败时 `verifying → fixing`；已 `resolved` 的问题若后续审计发现复发 MUST `resolved → open`（reopen），并保留原 resolution history；作者判定误报/有意保留时可 `open|fixing|verifying → dismissed`，必须记录理由。每次发现、审计、状态转换和解决/重开都追加 discovery/audit/transition/resolution history，包含时间、来源运行、操作者和证据引用。`resolved` 只能由针对性复检的结构化结果产生，不能仅因 diff 已落盘而设置。

`suggestedFix` 只用于解释修改方向。真正进入 diff 的 rewritten text 必须由作者输入或改写专家产生，并保持可编辑。

### 10. SQLite 持久化，事件用于同步而非作为真相源

Main 使用 SQLite 保存 workflow instance、stage records、stage-run links、artifact refs、creative asset versions/dependencies、asset change sets、impact sets、issue records 和 issue-checkpoint links。阶段命令与领域更新在事务中提交，提交后发工作流快照/增量控制事件。应用启动或项目切换时 Renderer 查询最新快照；它不通过重放临时 React 事件推导长期状态。

工作流表只保存引用，不复制正文、完整事实库或大体积审校输出。大对象继续由既有存储持有，通过稳定 id 引用。

备选方案是只保存在 Renderer 或 LangGraph checkpoint。拒绝原因：Renderer 状态无法跨重启；checkpoint 面向单次图状态，不能自然表达跨 run 阶段与问题队列。

### 11. IPC 使用强类型命令和快照

每个 IPC 请求 MUST 带 `requestId`；会改变状态的命令 MUST 另带幂等 `operationId`，并以 `expectedVersion` 做乐观并发校验。契约明确区分 `run`、`workflow`、`asset`、`request` scope，不能用单一可选引用混淆归属；continuation 判别联合必须与精确 scope/request 关联。

新增命令建议包括：`start-workflow`、`get-active-workflow`、`start-workflow-stage`、`confirm-workflow-stage`、`skip-workflow-stage`、`pause-workflow`、`resume-workflow`、`cancel-workflow`、`select-workflow-issue`、`dismiss-workflow-issue`、`verify-workflow-issue`，以及 `clarify-creative-asset`、`confirm-creative-asset-change`、`reject-creative-asset-change`、`resolve-asset-impact`。

新增事件建议包括：`workflow-snapshot-updated`、`workflow-command-failed`、`creative-asset-change-proposed`、`creative-asset-updated` 与 `asset-impact-detected`。既有 `stream-start`、`graph-node-activated`、`interrupt-raised`、`review-completed`、`refactor-applied` 可携带可选 `workflowRef: { workflowId; stageId }`。可选字段保证 standalone run 向后兼容。

所有来自 Renderer 的标识和 transition command 都由 Main 验证；Renderer 只渲染快照、选择动作并提交意图。

### 12. 工作台双层呈现，不合并语义

工作台上层呈现模板阶段：工作流名称、目标、总进度、当前阶段、状态/阻塞原因、下一步和适用动作，并区分 expert/system/author/quality-gate。已完成、跳过、失败和等待确认必须可辨识；横切的资产澄清活动与影响提醒单独展示，不能伪装成主阶段切换。折叠时保留“流程 + 当前阶段 + 下一步/阻塞”的摘要，并在有待确认资产变更或影响时显示计数。

下层继续复用现有 `useWorkbenchActivities` 和真实 `graph-node-activated` 顺序；它显示当前阶段选中或最近一次 `runId` 的节点轨迹。新 run 可重置下层轨迹，但不得清空上层 workflow 历史。standalone run 时只显示现有单次运行视图，不伪造业务模板。

### 13. 产品外壳以书目和作者任务为中心

主界面不再把工作流任务卡、作者要求、内部 stage 列表、事实抽取指标和专家运行轨迹纵向堆叠。稳定外壳采用以下层级：

```text
产品栏：Logo / Novel Agent                         设定目标 / 显示模式
书目栏：书架 / 当前书目                            书目整理（目标摘要）
进展区：面向作者的 Workflow Graph
主体区：书目导航 | 正文/按需面板 | 专家对话
底部栏：当前后台任务实时摘要                       召唤专家快捷入口
```

“设定目标”弹层承载 objective 与可重复的保留/提取/去掉或修复要求；保存只更新版本化目标，不直接推进或回退阶段。工作流 Graph 只显示中文业务阶段和当前运行摘要，内部 actor、stage id、版本号、impact 状态降级到诊断详情。事实底稿、Story Bible、质量诊断等均为按需工作面板，不常驻挤压正文。

### 14. 三种互斥专注模式

Renderer 使用单一 `ViewMode = 'workbench' | 'reading' | 'conversation'` 管理视图，三种模式互斥：

- `workbench`：显示工作流 Graph、左中右三栏、底部完整实时进展；问题到正文 Hero 连线只在此模式可见。
- `reading`：全屏呈现适合人类连续阅读的正文，隐藏 Graph、三栏工具和 Hero 连线；保留章节导航与不打扰阅读的极简后台状态。
- `conversation`：全屏呈现专家对话，隐藏 Graph、书目导航、正文和 Hero 连线；保留当前专家、任务和章节上下文。

切换模式只改变 Renderer 视图，不停止 Main 中的事实回填、诊断或专家运行；当前章节、阅读位置和对话上下文必须保留。召唤专家的显式入口归属对话区，平台快捷键提示移至底部角落，产品顶栏保持简洁。

### 15. 实时进展与事实底稿分层

底部状态栏负责回答“系统现在在做什么”，使用真实 control event / workflow snapshot 显示当前任务、章节、进度、发现数量或待裁决状态；默认不暴露候选、分块、无效和跳过等技术指标。事实底稿面板负责证据、抽取结果和冲突裁决，可从 Graph、底部进展或看板入口按需打开。Story Bible 继续负责整理后的已确认知识视图，三者职责不得重复。

普通运行不得每章自动打开事实底稿；冲突导致暂停时，底部必须明确提示并提供定位到裁决面板的动作。读书模式下冲突提示不得自动将作者踢出沉浸视图。

### 16. 进程归属

- **Core**：工作流/创作资产/影响领域类型、模板目录、纯状态转换校验、DTO 契约；不得依赖 Electron、React、lucide、LangGraph。
- **Main**：workflow 与 creative asset application service、SQLite repository、事务、Story Bible 映射、影响分析、运行关联、continuation resolver、IPC 验证和事件发布；LangGraph 仍在 Main。
- **utilityProcess / worker**：全书事实回填、Map-Reduce 总检、大规模复检等 CPU 密集执行；通过已有 Main 协调层回报强类型完成证据，不直接写 Renderer 状态。
- **Renderer**：工作流阶段和问题状态展示、命令意图采集、真实节点轨迹展示；不得自行判定阶段完成或问题 resolved。

### 17. 同一项目仅允许一个 active workflow

同一项目首版限制同时只能有一个 `active` workflow，以避免正文修改与阶段归属冲突；可以保留多个 paused/completed 实例。启动或恢复工作流时由 Main 在事务内强制该唯一约束。

## Risks / Trade-offs

- **[双层状态可能漂移]** LangGraph 成功但 workflow 更新失败会造成阶段未推进 → 运行结束和阶段证据写入使用幂等 operation id；Main 可按 stage-run link 重放完成证据，且不以 Renderer 事件作为真相源。
- **[模板过于僵硬]** 小说创作路径并非人人相同 → 首版允许模板声明可跳过阶段、暂停和回退；保留 standalone summon，但暂不引入任意模板编辑器。
- **[升级改变进行中流程]** 模板新增阶段可能改写已有实例 → 实例固定 `templateVersion` 并保存阶段快照；迁移必须显式执行。
- **[资产与 Story Bible 双写漂移]** 作者确认一个人物/世界观字段时可能只更新一侧 → asset version、映射事实版本和影响集在同一 Main 应用事务/幂等 operation 中提交，失败时整体回滚。
- **[影响传播过度打扰]** 高频澄清可能让大量内容 stale → 区分 blocking conflict 与非阻塞 needs-review，聚合提醒并允许记录待办，不因低风险变化强制跳转。
- **[问题锚点因编辑失效]** 无法安全生成局部 diff 或复检 → 将阶段置为 blocked，要求重新定位；不得模糊匹配后直接落盘。
- **[复检成本高]** 每个问题都跑全书总检会过慢 → 优先按问题类型、锚点和受影响范围做针对性复检，队列结束后再做最终全书总检。
- **[并发命令冲突]** 作者可能快速发起多个阶段操作 → repository 使用版本号/乐观并发控制，旧版本命令返回结构化冲突并刷新快照。
- **[进度百分比误导]** 章节数量和问题数量动态变化 → 展示阶段计数与当前循环项为主，百分比只按已实例化阶段计算并标注动态流程。
- **[规格范围较大]** 涉及多个现有能力 → 实现按领域模型/持久化、模板状态机、运行接入、问题闭环、Renderer 五个垂直阶段推进，每阶段保持 standalone 兼容并可独立验证。

## Migration Plan

1. 新增 Core 工作流、创作资产/版本/影响类型、模板和纯状态转换测试，不接入 UI；现有运行不受影响。
2. 新增 SQLite 表和 repository。迁移只创建工作流、创作资产、版本/依赖/影响等新表和索引，不改写已有正文、事实、checkpoint 或历史 run。
3. 接入 workflow IPC 与查询快照；未创建工作流的项目返回无 active workflow。
4. 先接入创作资产持久化、作者确认和 Story Bible 映射，再接入新书策划阶段与 stage-run link，随后接入章节循环；standalone summon 始终保留。
5. 接入老书回填/总检和 issue lifecycle，随后串联 diff/hunk/checkpoint/复检。
6. 将现有纵向任务卡迁移为产品外壳：目标弹层、书目面包屑、业务 Graph、按需事实底稿、底部实时进展和对话内召唤入口。
7. 引入互斥 `workbench` / `reading` / `conversation` 模式，完成读书模式、对话全屏与 Hero 连线可见性约束，并对后台任务不中断做回归测试。
8. 回滚时关闭工作流入口和事件消费即可恢复 standalone UI；新表可保留以免丢失数据。数据库 schema downgrade 仅在确认无须保留工作流记录时执行。

## Open Questions

- 新书模板中的世界观与人物设计是否允许并行？首版建议保持可回退的顺序流程，待状态模型稳定后再支持并行 stage group。
- “作者手工直接编辑正文”如何自动关联当前 issue 的 checkpoint？建议首版只有从问题修复入口发起的 diff/hunk 才自动关联，普通编辑要求作者显式选择关联问题。
- 资产影响分析首版采用显式 asset refs + Story Bible 关系 + 稳定 scope；对正文中的隐式语义引用是否补充向量/LLM 扫描，应在基础链路稳定后单独评估成本和误报。
- 针对性复检的最小执行器应按问题类型映射 reviewer、fact-checker 或 plagiarism-checker，具体映射表需在实现前结合现有 agent 输出能力确认。
- 读书模式首版的阅读设置范围建议只含字号、正文宽度与主题；是否持久化到项目级或用户级偏好可在外壳骨架稳定后决定。
