/**
 * 前端 → 后端 命令消息类型 (Task 2.3)
 *
 * 经 control-event 通道发送，携带 `runId` 定位目标运行
 * （见 spec: ipc-contract「流式、中断与错误语义」）。
 * abort/resume 在此仅为**类型占位**；其完整语义由 human-in-the-loop change 定义。
 * 本文件仅为类型定义（跨进程契约），无实现逻辑。
 */

import type { RunId } from './stream-messages.js';
import type { WorkflowRefDto } from './workflow-messages.js';
import type { ModelTaskSupplementDto } from './model-task-messages.js';
import type { TaskUiEffectResultDto } from './task-activity-messages.js';

/** 发起一次运行（具体动作载荷由 agent-orchestration 定义，这里仅占位判别字段） */
export interface StartRunCommand {
  type: 'start-run';
  runId: RunId;
  /** 目标动作标识（如 SUMMON_AUDIT 等），具体枚举后续 change 定义 */
  action: string;
}

/**
 * 发起一次对话/召唤（walking-skeleton）。
 * 只携带跨进程传输所需的标量/opaque 字段（shared/ 不依赖 core/）；
 * Main 侧据此组 prompt、按档位解析模型并调用 adapter。
 * anchor 为可空的节点 id（对应 NodeRef.id，数据层可解）。
 */
export interface SummonRunCommand {
  type: 'summon-run';
  runId: RunId;
  /** 目标专家 agent 标识 */
  agent: string;
  /** 执行模式：诊断（只读）/ 改写（局部 diff） */
  mode: 'diagnose' | 'mutate';
  /** 作用范围（与 SummonTarget.scope 对齐） */
  scope: 'selection' | 'node' | 'document' | 'project';
  /** 可空：锚定节点 id（selection/node 时存在） */
  anchorNodeId?: string;
  /**
   * 可空：作者在对话中自然语言提及的软章号所对应节点 id（如「第 3 章那个伏笔」）。
   * 仅作软排序提示，MUST NOT 硬过滤（historical-fact-retrieval「软提示不硬过滤章号」）。
   */
  softChapterNodeId?: string;
  /**
   * 可空：从指令/对话提取的检索关键词（实体名/伏笔关键词等）。
   * shared/ 不依赖 core/，故以裸字符串数组承载；Main 侧据此组结构化召回查询。
   */
  keywords?: ReadonlyArray<string>;
  /** 可选：作者自然语言指令 */
  instruction?: string;
  /** 可选：writer 产出新草稿后自动抽取低风险事实；冲突仍走手刹。 */
  autoExtractFacts?: boolean;
  /** 跨阶段资产澄清时由作者明确选择的目标资产；未提供且候选不唯一时 Main 必须要求消歧。 */
  targetAssetId?: string;
  /** Optional ownership by a long-running workflow stage. */
  workflowRef?: WorkflowRefDto;
}

/** 取章节树（walking-skeleton：同步查询，Main 读盘后经当前通道回结果） */
export interface GetChapterTreeCommand {
  type: 'get-chapter-tree';
  runId: RunId;
}

/** 以节点 id 取某章正文（walking-skeleton） */
export interface GetChapterContentCommand {
  type: 'get-chapter-content';
  runId: RunId;
  /** 目标节点 id（对应 NodeRef.id） */
  nodeId: string;
}

/** 拉手刹：中断指定运行（Task 2.3 / 对应 abort 语义占位） */
export interface AbortRunCommand {
  type: 'abort-run';
  runId: RunId;
}

/**
 * 作者对挂起裁决的决策（orchestration-runtime task 4.3）。
 * 判别联合，跨 IPC 传输：
 *  - approve：认可当前问题/放行后续流程（含冲突场景的「知情放行」）。
 *  - reject：否决，终止本次运行。
 *  - modify：以作者修订后的问题列表覆写 activeBugs 后从挂起点续跑。
 *  - correct：纠偏裁决——作者从候选中选定某锚点（或维持原陈述），选项 id 由候选提示给出。
 *
 * `modify.issues` 为 opaque 数组（shared/ 不依赖 core/）；Main 侧经 Zod 校验收窄为强类型后方可写状态。
 */
export type ResumeDecision =
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'modify'; issues: ReadonlyArray<unknown> }
  | { kind: 'correct'; optionId: string };

/** 恢复被挂起的运行，携带作者决策（走与手刹一致的裁决回路）。 */
export interface ResumeRunCommand {
  type: 'resume-run';
  runId: RunId;
  /** 作者决策（强类型判别联合）。 */
  decision: ResumeDecision;
  /** Must exactly match the persisted interrupt ownership when present. */
  workflowRef?: WorkflowRefDto;
}

/**
 * 从历史 checkpoint 重开运行（time-travel task 5.2）。
 * 以指定 checkpoint 的状态恢复图，新运行作为分支挂在该 checkpoint 下。
 */
export interface RestartFromCheckpointCommand {
  type: 'restart-from-checkpoint';
  runId: RunId;
  /** 选定的历史 checkpoint id（MUST 存在） */
  checkpointId: string;
  /** 可选的作者新指令（为空时沿用 checkpoint 内 chatHistory 的上下文继续） */
  instruction?: string;
}

/** 显式为某章节抽取 Story Bible 候选事实（Main 侧读正文、调 LLM、写事实库）。 */
export interface SupplementModelTaskCommand {
  type: 'workflow-supplement-model-task';
  runId: RunId;
  taskId: string;
  attemptId: string;
  supplement: ModelTaskSupplementDto;
}

export interface RetryModelTaskCommand {
  type: 'retry-model-task';
  runId: RunId;
  taskId: string;
  attemptId: string;
}

export interface AbortModelTaskCommand {
  type: 'abort-model-task';
  runId: RunId;
  taskId: string;
  attemptId: string;
}

export interface ExtractFactsCommand {
  type: 'extract-facts';
  runId: RunId;
  /** 目标章节节点 id（对应 NodeRef.id）；当前章节由 Renderer 以当前选中 id 下发。 */
  nodeId: string;
}

/** 按 manifest 章节列表逐章补抽 Story Bible 事实（Main 侧串行读正文与写事实库）。 */
export interface BackfillFactsCommand {
  type: 'backfill-facts';
  runId: RunId;
  /** 章节节点 id 列表；为空时 Main 侧按当前 manifest 的全部 chapter 顺序补抽。 */
  nodeIds?: ReadonlyArray<string>;
  workflowRef?: WorkflowRefDto;
}

/** 基于当前 Story Bible 事实视图运行一次只读全书总检。 */
export interface RunGlobalAuditCommand {
  type: 'run-global-audit';
  runId: RunId;
  workflowRef?: WorkflowRefDto;
}

/** Main reads the issue anchors and current manuscript, then runs a targeted reviewer. */
export interface RunTargetedVerificationCommand {
  type: 'run-targeted-verification';
  runId: RunId;
  workflowRef: WorkflowRefDto & { issueId: string };
}

/** 根据持久化诊断问题和当前正文确定性定位可修订原文。 */
export interface LocateSourceCommand {
  type: 'locate-source';
  runId: RunId;
  workflowRef: WorkflowRefDto & { issueId: string };
}

/** 作者从 Main 持久化的原文候选中明确选择一个位置。 */
export interface ChooseSourceLocationCommand {
  type: 'choose-source-location';
  runId: RunId;
  operationId: string;
  taskRunId: string;
  candidateId: string;
}

/** 作者控制持久化任务运行；Main 校验当前状态并在安全步骤边界收敛。 */
export interface ControlTaskRunCommand {
  type: 'control-task-run';
  runId: RunId;
  operationId: string;
  taskRunId: string;
  action: 'pause' | 'resume' | 'cancel';
}

/** Renderer 执行 Main 发布的 UI Effect 后回传可校验、可幂等的结果。 */
export interface ReportTaskUiEffectResultCommand {
  type: 'report-task-ui-effect-result';
  runId: RunId;
  operationId: string;
  result: TaskUiEffectResultDto;
}

/** 作者在右栏助手补充的约束：Main 落库为当前任务的新输入并进入活动流（3.4）。 */
export interface SupplementTaskInputCommand {
  type: 'supplement-task-input';
  runId: RunId;
  operationId: string;
  taskRunId: string;
  /** 作者可读的补充约束文本（不含隐藏提示/思维链）。 */
  constraint: string;
}

/** Story Bible 事实定位器：Renderer 只能提交受限目标，Main 侧验证后写库。 */
export type StoryBibleFactLocatorDto =
  | { kind: 'entity'; entityId: string }
  | { kind: 'entity-attribute'; entityId: string; attributeKey: string; attributeValue: string }
  | { kind: 'timeline-event'; eventId: string }
  | { kind: 'relation-phase'; relationId: string; phaseIndex: number }
  | { kind: 'plot-hook'; hookId: string };

/** 作者确认 Story Bible 中一条 inferred/conflicting 事实为 confirmed。 */
export interface ConfirmStoryBibleFactCommand {
  type: 'confirm-story-bible-fact';
  runId: RunId;
  target: StoryBibleFactLocatorDto;
}

/** Story Bible 受限编辑 payload：不允许 raw JSON/SQL，只允许白名单字段。 */
export type StoryBibleFactEditDto =
  | { kind: 'entity'; entityId: string; canonicalName?: string; aliases?: ReadonlyArray<string> }
  | { kind: 'entity-attribute'; entityId: string; attributeKey: string; attributeValue: string; newKey?: string; newValue?: string }
  | { kind: 'timeline-event'; eventId: string; description?: string; label?: string; tick?: number }
  | { kind: 'relation-phase'; relationId: string; phaseIndex: number; kindValue?: string; label?: string; tick?: number }
  | { kind: 'plot-hook'; hookId: string; description?: string; state?: 'planted' | 'pending' | 'paid_off' | 'abandoned' };

/** 作者编辑 Story Bible 中一条事实的受限字段。 */
export interface EditStoryBibleFactCommand {
  type: 'edit-story-bible-fact';
  runId: RunId;
  edit: StoryBibleFactEditDto;
}

/**
 * Story Bible 事实删除定位器：Renderer 只能提交受限目标，Main 侧验证后写库。
 * 覆盖实体、实体属性、实体别名、时间线事件、关系、伏笔六类。
 */
export type StoryBibleFactDeleteLocatorDto =
  | { kind: 'entity'; entityId: string }
  | { kind: 'entity-attribute'; entityId: string; attributeKey: string; attributeValue: string }
  | { kind: 'entity-alias'; entityId: string; alias: string }
  | { kind: 'timeline-event'; eventId: string }
  | { kind: 'relation'; relationId: string }
  | { kind: 'plot-hook'; hookId: string };

/** 作者删除 Story Bible 中一条误抽事实。 */
export interface DeleteStoryBibleFactCommand {
  type: 'delete-story-bible-fact';
  runId: RunId;
  target: StoryBibleFactDeleteLocatorDto;
}

/** 作者把源实体合并进目标实体（别名/属性/关系并入目标后删除源实体）。 */
export interface MergeStoryBibleEntitiesCommand {
  type: 'merge-story-bible-entities';
  runId: RunId;
  /** 被合并（将被删除）的源实体 id。 */
  sourceEntityId: string;
  /** 保留的目标实体 id。 */
  targetEntityId: string;
}

/**
 * 片段锚点投影（对应 core FragmentAnchor，node id 去 brand 为 string）。
 * shared/ 不依赖 core/：以标量承载，Main 侧收窄回强类型后方可裁片段/拼回。
 */
export interface FragmentAnchorDto {
  /** 所属章节/场景节点 id（对应 NodeRef.id） */
  nodeId: string;
  /** 片段在该节点正文内的起始位置 */
  from: number;
  /** 片段在该节点正文内的结束位置（> from） */
  to: number;
}

/**
 * 发起一次局部重构 diff 计算 (I6 refactor-worker-runtime)。
 * Main 据锚点从磁盘正文裁出原片段，与 agent 改写片段一起派发给 diff worker，回传 hunk 拆分。
 */
export interface ComputeRefactorDiffCommand {
  type: 'compute-refactor-diff';
  runId: RunId;
  /** 待修片段锚点 */
  anchor: FragmentAnchorDto;
  /** 重构 agent 产出的改写片段全文 */
  rewrittenFragment: string;
  workflowRef?: WorkflowRefDto;
}

/** 作者对单个 hunk 的裁决意图（accept/reject）。 */
export interface HunkDecisionDto {
  hunkId: string;
  decision: 'accept' | 'reject';
}

/**
 * 提交逐 hunk 裁决并拼回落盘 (I6 refactor-worker-runtime)。
 * Main 据先前 diff 结果 + 裁决用纯函数拼回，仅替换接受区间写回磁盘正文并提交可回滚 checkpoint。
 * 携带锚点 + 改写片段以便 Main 重算同一 DiffResult（无状态、确定性），再据裁决拼回。
 */
export interface ApplyHunkDecisionsCommand {
  type: 'apply-hunk-decisions';
  runId: RunId;
  /** 待修片段锚点（与 compute-refactor-diff 一致） */
  anchor: FragmentAnchorDto;
  /** 改写片段全文（与 compute-refactor-diff 一致，用于确定性重算 DiffResult） */
  rewrittenFragment: string;
  /** 逐 hunk 裁决 */
  decisions: ReadonlyArray<HunkDecisionDto>;
  workflowRef?: WorkflowRefDto;
}

/**
 * 前端 → 后端 命令判别联合。
 * 接收方通过 `type` 收窄，无需使用 any。
 */
export type FrontendCommandMessage =
  | StartRunCommand
  | SummonRunCommand
  | GetChapterTreeCommand
  | GetChapterContentCommand
  | AbortRunCommand
  | ResumeRunCommand
  | RestartFromCheckpointCommand
  | ExtractFactsCommand
  | SupplementModelTaskCommand
  | RetryModelTaskCommand
  | AbortModelTaskCommand
  | BackfillFactsCommand
  | RunGlobalAuditCommand
  | RunTargetedVerificationCommand
  | LocateSourceCommand
  | ChooseSourceLocationCommand
  | ControlTaskRunCommand
  | ReportTaskUiEffectResultCommand
  | SupplementTaskInputCommand
  | ConfirmStoryBibleFactCommand
  | EditStoryBibleFactCommand
  | DeleteStoryBibleFactCommand
  | MergeStoryBibleEntitiesCommand
  | ComputeRefactorDiffCommand
  | ApplyHunkDecisionsCommand
  | RetrieveCorpusCommand;

/**
 * 检索作用域投影 (I7 corpus-worker-runtime)。
 * 对应 core CorpusScope；shared/ 不依赖 core/，故 id 以裸字符串承载（可空）。
 */
export interface CorpusScopeDto {
  level: 'work' | 'project' | 'global';
  /** 项目锚点（project/work 需要，global 为 null） */
  projectId: string | null;
  /** 单篇锚点（仅 work 需要，其余为 null） */
  workId: string | null;
}

/** 检索过滤条件投影（与语义检索组合；各字段缺省表不在该维度过滤）。 */
export interface CorpusFilterDto {
  types?: ReadonlyArray<string>;
  tags?: ReadonlyArray<string>;
  sourceKinds?: ReadonlyArray<string>;
}

/** 一次素材语义检索查询投影（对应 core CorpusQuery）。 */
export interface CorpusQueryDto {
  /** 查询文本（语义检索输入） */
  query: string;
  /** 检索作用域限定 */
  scope: CorpusScopeDto;
  /** 可选过滤条件 */
  filter?: CorpusFilterDto;
  /** 返回条数上限 */
  topK?: number;
  /** 相关度下限 */
  minScore?: number;
}

/**
 * 发起一次素材语义检索 (I7 corpus-worker-runtime)。
 * Main 据作用域筛出素材快照，将查询文本派发给 embed worker 算向量，回传按相关度降序的命中列表。
 */
export interface RetrieveCorpusCommand {
  type: 'retrieve-corpus';
  runId: RunId;
  query: CorpusQueryDto;
}
