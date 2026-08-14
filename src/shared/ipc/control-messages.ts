/**
 * 后端 → 前端 控制事件消息类型 (orchestration-runtime task 4.2)
 *
 * 经 control-event 通道下行，携带 `runId` 定位目标运行
 * （见 spec: interrupt-resume「中断/恢复运行时落地」——挂起时 MUST 经 control-event
 * 推送强类型报告）。与内容流（manuscript/dialogue）严格分离，MUST NOT 混入流通道。
 *
 * shared/ 不依赖 core/：此处定义 ConsistencyIssue 的**可序列化投影**（结构同构，
 * 但节点 id 为普通 string 而非 brand 类型）。Main 侧从 core `ConsistencyIssue`
 * 投影下行；Renderer 侧按判别联合直接消费；若需回传（modify），Main 侧经 Zod
 * 校验收窄回强类型（见 command-messages `ResumeDecision`）。
 * 本文件仅为类型定义（跨进程契约），无实现逻辑。
 */

import type {
  StoryBibleFactDeleteLocatorDto,
  StoryBibleFactEditDto,
  StoryBibleFactLocatorDto,
} from './command-messages.js';
import type { RunId } from './stream-messages.js';
import type { AuthorIntentDto, WorkflowRefDto, WorkflowSnapshotEvent, WorkflowFailureEvent } from './workflow-messages.js';



/** 锚点投影（对应 core NodeRef，id 去 brand 为 string）。 */
export interface IssueAnchorDto {
  /** 稳定节点标识（NodeRef.id 的字符串形态） */
  id: string;
  /** 节点种类 */
  kind: 'volume' | 'chapter' | 'scene';
}

/** 需人工决策时附带的选项投影（对应 core DecisionOption）。 */
export interface DecisionOptionDto {
  id: string;
  label: string;
}

/** 问题证据片段投影：在章节/场景锚点之内进一步定位原文。 */
export interface IssueEvidenceDto {
  /** 原文短引文 */
  quote: string;
  /** 可选上下文前缀 */
  before?: string;
  /** 可选上下文后缀 */
  after?: string;
}

/**
 * 一致性问题的可序列化投影（对应 core ConsistencyIssue）。
 * 字段语义与 core 契约一致：anchors ≥ 1；requiresHumanDecision=true 时 options 非空，
 * 系统 MUST NOT 代作者选择。
 */
export interface ConsistencyIssueDto {
  /** 问题类型（预置类别之外允许扩展字符串） */
  type: string;
  /** 严重度 */
  severity: 'critical' | 'warning' | 'info';
  /** 一个或多个稳定标识符锚点 */
  anchors: ReadonlyArray<IssueAnchorDto>;
  /** 问题描述 */
  description: string;
  /** 只读修改建议（可空），不是可直接落盘的正文。 */
  suggestedFix?: string;
  /** 作者独立录入的改写要求；旧事件可省略，且不得回写为 suggestedFix。 */
  authorRewrittenInstruction?: string;
  /** 工作流问题生命周期投影；standalone/旧事件均可省略。 */
  issueId?: string;
  workflowStatus?: 'open' | 'fixing' | 'verifying' | 'resolved' | 'dismissed';
  checkpointIds?: ReadonlyArray<string>;
  verificationRunIds?: ReadonlyArray<string>;
  resolutionReason?: string;
  /** 原文证据片段（可空；用于 UI 展示与后续 editor 定位） */
  evidence?: IssueEvidenceDto;
  /** 是否需人工决策 */
  requiresHumanDecision: boolean;
  /** 需人工决策时的可选项 */
  options?: ReadonlyArray<DecisionOptionDto>;
}

/**
 * 运行挂起等待作者裁决（手刹的「问话」半程）。
 * 前端据此呈现待裁决问题与选项；作者决策经 `resume-run` 命令（ResumeDecision）回传。
 */
export interface InterruptRaisedEvent {
  type: 'interrupt-raised';
  runId: RunId;
  /** 待裁决问题列表（强类型投影，禁 any 穿透） */
  issues: ReadonlyArray<ConsistencyIssueDto>;
  workflowRef?: WorkflowRefDto;
}

/**
 * 审校类 agent 运行结束、产出非空一致性问题清单（reviewer / fact-checker / plagiarism-checker）。
 * 与 `interrupt-raised` 正交：无论是否需人工裁决，只要审校产出问题即经此下行结构化清单，
 * 供渲染层呈现分级卡片、点击定位高亮。结构化数据 MUST 走 control-event，不混入内容流（否则 UI 打印裸文本）。
 * 需人工裁决时 `interrupt-raised` 裁决通路照旧，两事件可并存（同一 runId）。
 */
export interface ReviewCompletedEvent {
  type: 'review-completed';
  runId: RunId;
  /** 产出问题的审校 agent 标识（reviewer / fact-checker / plagiarism-checker）。 */
  agent: string;
  /** 强类型问题清单投影（禁 any 穿透）。 */
  issues: ReadonlyArray<ConsistencyIssueDto>;
  workflowRef?: WorkflowRefDto;
}

export interface TargetedVerificationCompletedEvent {
  type: 'targeted-verification-completed';
  runId: RunId;
  workflowRef: WorkflowRefDto & { issueId: string };
  passed: boolean;
  issue: ConsistencyIssueDto;
  findings: ReadonlyArray<ConsistencyIssueDto>;
}

export interface TargetedVerificationFailedEvent {
  type: 'targeted-verification-failed';
  runId: RunId;
  workflowRef: WorkflowRefDto & { issueId: string };
  error: { category: 'validation' | 'aborted' | 'io' | 'model' | 'internal'; message: string };
}

/**
 * 编排图逐节点转移（graph-stream-tracing）：一次运行中某节点开始（enter）/执行完（exit）。
 * 专家工作台活图据此实时点亮多跳执行轨迹；按实际执行顺序下发，不混入内容流。
 */
export interface GraphNodeActivatedEvent {
  type: 'graph-node-activated';
  runId: RunId;
  /** 图节点名（supervisor / 各专家节点）。 */
  node: string;
  /** 相位：enter=开始执行，exit=执行完成。 */
  phase: 'enter' | 'exit';
  workflowRef?: WorkflowRefDto;
}

/** 事实抽取开始：进度类控制事件，不混入内容流。 */
export interface FactExtractionStartedEvent {
  type: 'fact-extraction-started';
  runId: RunId;
  chapterId: string;
  textChars: number;
  /** 补库时的当前章节序号（1-based）。 */
  index?: number;
  /** 补库总章节数。 */
  total?: number;
}

/** 事实抽取完成：候选、入库、冲突与跳过数量全部以结构化字段下发。 */
export interface FactExtractionCompletedEvent {
  type: 'fact-extraction-completed';
  runId: RunId;
  chapterId: string;
  rawChars: number;
  parseSource: 'json-object' | 'candidate-salvage' | 'none';
  candidateObjects: number;
  validCandidates: number;
  invalidCandidates: number;
  autoIngested: number;
  conflicts: number;
  skipped: number;
  factVersion?: string;
  /** 长章节分块数量；未分块或旧调用可省略。 */
  chunks?: number;
  /** 补库时的当前章节序号（1-based）。 */
  index?: number;
  /** 补库总章节数。 */
  total?: number;
}

/** 事实抽取失败：错误作为一等控制事件，不以未捕获异常穿透 IPC。 */
export interface FactExtractionFailedEvent {
  type: 'fact-extraction-failed';
  runId: RunId;
  chapterId?: string;
  error: {
    category: 'model' | 'validation' | 'aborted' | 'io' | 'internal';
    message: string;
  };
}

export interface AuditScoreExplanationDto {
  criticalWeight: number;
  warningWeight: number;
  infoWeight: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  penalty: number;
  formula: string;
}

export interface LegacyRevisionDiagnosisItemDto {
  intent: AuthorIntentDto;
  status: 'located' | 'evidence-found' | 'pending';
  matches: ReadonlyArray<{ label: string; anchorRefs: ReadonlyArray<string>; details?: ReadonlyArray<string> }>;
  linkedIssueIds: ReadonlyArray<string>;
}

export interface LegacyRevisionDiagnosisDto {
  kind: 'legacy-revision-diagnosis';
  factVersion: string;
  generatedAt: number;
  preservation: ReadonlyArray<LegacyRevisionDiagnosisItemDto>;
  characterExtraction: ReadonlyArray<LegacyRevisionDiagnosisItemDto>;
  removals: ReadonlyArray<LegacyRevisionDiagnosisItemDto>;
}

export interface QualityDashboardDto {
  factVersion: string;
  generatedAt: number;
  healthScore: number;
  scoreExplanation: AuditScoreExplanationDto;
  totalItems: number;
  issues: ReadonlyArray<ConsistencyIssueDto>;
  legacyDiagnosis?: LegacyRevisionDiagnosisDto;
}

/** 全书总检开始：进度类控制事件，不混入内容流。 */
export interface GlobalAuditStartedEvent {
  type: 'global-audit-started';
  runId: RunId;
  workflowRef?: WorkflowRefDto;
  factVersion: string;
  totalItems: number;
}

/** 全书总检进度：首版按阶段报告，后续 worker 可细化为分片进度。 */
export interface GlobalAuditProgressEvent {
  type: 'global-audit-progress';
  runId: RunId;
  workflowRef?: WorkflowRefDto;
  phase: 'map' | 'reduce' | 'score';
  completedItems: number;
  totalItems: number;
}

/** 全书总检完成：输出 QualityDashboard 同构问题列表。 */
export interface GlobalAuditCompletedEvent {
  type: 'global-audit-completed';
  runId: RunId;
  workflowRef?: WorkflowRefDto;
  dashboard: QualityDashboardDto;
}

/** 全书总检失败：错误作为一等控制事件，不以未捕获异常穿透 IPC。 */
export interface GlobalAuditFailedEvent {
  type: 'global-audit-failed';
  runId: RunId;
  workflowRef?: WorkflowRefDto;
  error: {
    category: 'validation' | 'aborted' | 'io' | 'internal';
    message: string;
  };
}

/** Story Bible 事实确认完成。 */
export interface StoryBibleFactConfirmedEvent {
  type: 'story-bible-fact-confirmed';
  runId: RunId;
  target: StoryBibleFactLocatorDto;
  factVersion: string;
  status: 'confirmed';
}

/** Story Bible 事实确认失败。 */
export interface StoryBibleFactConfirmationFailedEvent {
  type: 'story-bible-fact-confirmation-failed';
  runId: RunId;
  target?: StoryBibleFactLocatorDto;
  error: {
    category: 'validation' | 'io' | 'internal';
    message: string;
  };
}

/** Story Bible 事实编辑完成。 */
export interface StoryBibleFactEditedEvent {
  type: 'story-bible-fact-edited';
  runId: RunId;
  edit: StoryBibleFactEditDto;
  factVersion: string;
  status: 'confirmed';
}

/** Story Bible 事实编辑失败。 */
export interface StoryBibleFactEditFailedEvent {
  type: 'story-bible-fact-edit-failed';
  runId: RunId;
  edit?: StoryBibleFactEditDto;
  error: {
    category: 'validation' | 'io' | 'internal';
    message: string;
  };
}

/** Story Bible 事实删除完成。 */
export interface StoryBibleFactDeletedEvent {
  type: 'story-bible-fact-deleted';
  runId: RunId;
  target: StoryBibleFactDeleteLocatorDto;
  factVersion: string;
}

/** Story Bible 事实删除失败。 */
export interface StoryBibleFactDeleteFailedEvent {
  type: 'story-bible-fact-delete-failed';
  runId: RunId;
  target?: StoryBibleFactDeleteLocatorDto;
  error: {
    category: 'validation' | 'io' | 'internal';
    message: string;
  };
}

/** Story Bible 实体合并完成。 */
export interface StoryBibleEntitiesMergedEvent {
  type: 'story-bible-entities-merged';
  runId: RunId;
  sourceEntityId: string;
  targetEntityId: string;
  factVersion: string;
}

/** Story Bible 实体合并失败。 */
export interface StoryBibleEntitiesMergeFailedEvent {
  type: 'story-bible-entities-merge-failed';
  runId: RunId;
  sourceEntityId?: string;
  targetEntityId?: string;
  error: {
    category: 'validation' | 'io' | 'internal';
    message: string;
  };
}

/**
 * 局部重构 diff 中的单个 hunk 投影 (I6 refactor-worker-runtime)。
 * 对应 core DiffHunk：携片段内相对偏移 + 原文 + 改写，供 UI 逐 hunk 展示与裁决。
 */
export interface DiffHunkDto {
  /** hunk 标识（提交裁决时回传） */
  id: string;
  /** hunk 在片段文本内的相对起始偏移 */
  fragmentFrom: number;
  /** hunk 在片段文本内的相对结束偏移 */
  fragmentTo: number;
  /** 原文（纯插入时为空串） */
  original: string;
  /** 改写文本（纯删除时为空串） */
  rewritten: string;
}

/** 局部重构 diff 计算完成：回传片段全文与 hunk 拆分（供正文轴 diff 双栏/逐 hunk 控件）。 */
export interface RefactorDiffComputedEvent {
  type: 'refactor-diff-computed';
  runId: RunId;
  /** 待修片段锚点投影 */
  anchor: IssueAnchorDto;
  /** 原片段文本 */
  originalFragment: string;
  /** 改写片段全文 */
  rewrittenFragment: string;
  /** 拆分出的可独立裁决 hunk（片段内偏移升序） */
  hunks: ReadonlyArray<DiffHunkDto>;
  workflowRef?: WorkflowRefDto;
}

/** 局部重构 diff 计算失败：错误作为一等控制事件，不以未捕获异常穿透 IPC。 */
export interface RefactorDiffFailedEvent {
  type: 'refactor-diff-failed';
  runId: RunId;
  error: {
    category: 'validation' | 'aborted' | 'io' | 'internal';
    message: string;
  };
  workflowRef?: WorkflowRefDto;
}

/** 逐 hunk 裁决拼回并写回磁盘成功：携可回滚 checkpoint 供 time-travel 定位。 */
export interface RefactorAppliedEvent {
  type: 'refactor-applied';
  runId: RunId;
  /** 写回的章节节点 id */
  nodeId: string;
  /** 本次接受的 hunk 标识 */
  acceptedHunkIds: ReadonlyArray<string>;
  /** 变更落定产生的 checkpoint id（无 checkpointer 时缺省） */
  checkpointId?: string;
  workflowRef?: WorkflowRefDto;
}

/** 逐 hunk 裁决拼回/写盘失败：失效/重叠/越界/IO 错误均结构化下发。 */
export interface RefactorApplyFailedEvent {
  type: 'refactor-apply-failed';
  runId: RunId;
  error: {
    category: 'validation' | 'aborted' | 'io' | 'internal';
    message: string;
  };
  /** 相关 hunk 标识（失效/重叠时供 UI 定位） */
  hunkIds?: ReadonlyArray<string>;
  workflowRef?: WorkflowRefDto;
}

/**
 * 素材条目投影 (I7 corpus-worker-runtime)。
 * 对应 core CorpusItem，id/type 去 brand 为 string；source 可空。
 */
export interface CorpusItemDto {
  id: string;
  type: string;
  content: string;
  tags: ReadonlyArray<string>;
  source?: {
    kind: string;
    label: string;
    locator?: string;
  };
}

/** 一条检索命中投影：素材条目 + 相关度分数。 */
export interface CorpusHitDto {
  item: CorpusItemDto;
  score: number;
}

/** 素材检索开始：进度类控制事件，不混入内容流。 */
export interface CorpusRetrievalStartedEvent {
  type: 'corpus-retrieval-started';
  runId: RunId;
  /** 查询文本（供 UI 回显） */
  query: string;
}

/** 素材检索完成：回传按相关度降序的命中列表（弱参考，不入一致性检查）。 */
export interface CorpusRetrievalCompletedEvent {
  type: 'corpus-retrieval-completed';
  runId: RunId;
  hits: ReadonlyArray<CorpusHitDto>;
}

/** 素材检索失败：错误作为一等控制事件，不以未捕获异常穿透 IPC。 */
export interface CorpusRetrievalFailedEvent {
  type: 'corpus-retrieval-failed';
  runId: RunId;
  error: {
    category: 'validation' | 'aborted' | 'io' | 'internal';
    message: string;
  };
}

/** 跨阶段资产澄清命中多个目标时要求作者显式消歧；此事件不创建 change set。 */
export interface AssetTargetSelectionRequiredEvent {
  type: 'asset-target-selection-required';
  runId: RunId;
  targetAssetKind: string;
  candidates: ReadonlyArray<{ assetId: string; version: number; content: unknown }>;
  workflowRef: WorkflowRefDto;
}

/** 待作者确认的创作资产候选；增量 optional-friendly DTO，不代表 Renderer 已提交。 */
export interface CreativeAssetCandidateDto {
  candidateId: string;
  /** The long-lived asset identity; candidateId is the proposal identity. */
  assetId: string;
  baseVersion?: number;
  content?: unknown;
  provenance?: unknown;
  status?: 'pending' | 'confirmed' | 'rejected';
  changeSetId?: string;
  workflowRef?: WorkflowRefDto;
}

/** 资产变更影响审阅项。 */
export interface AssetImpactDto {
  impactId: string;
  assetId: string;
  status: 'stale' | 'needs-review' | 'conflicting' | string;
  summary?: string;
  targetRefs?: ReadonlyArray<string>;
  workflowRef?: WorkflowRefDto;
}

export interface CreativeAssetChangeProposedEvent {
  type: 'creative-asset-change-proposed';
  runId: RunId;
  candidate: CreativeAssetCandidateDto;
}

export interface CreativeAssetUpdatedEvent {
  type: 'creative-asset-updated';
  runId: RunId;
  asset: Record<string, unknown>;
  workflowRef?: WorkflowRefDto;
  projectId: string;
}

export interface AssetImpactDetectedEvent {
  type: 'asset-impact-detected';
  runId: RunId;
  impact: AssetImpactDto;
}

/**
 * 后端 → 前端 控制事件判别联合。
 * 接收方通过 `type` 收窄；后续 change（纠偏/冲突/时间旅行）在此叠加成员。
 */
export interface LegacyPlotAdvisorCompletedEvent {
  type: 'legacy-plot-advisor-completed';
  runId: RunId;
  plotNodeId: string;
  question: string;
  advice: string;
  options: ReadonlyArray<string>;
}

export interface LegacyPlotAdvisorFailedEvent {
  type: 'legacy-plot-advisor-failed';
  runId: RunId;
  plotNodeId: string;
  error: string;
}

export interface LegacyBookDiagnosisCompletedEvent {
  type: 'legacy-book-diagnosis-completed';
  runId: RunId;
  candidates: ReadonlyArray<{
    kind: 'timeline' | 'character-state' | 'causality' | 'duplicate-event' | 'continuity' | 'other';
    severity: 'low' | 'medium' | 'high' | 'unknown';
    description: string;
    evidence: ReadonlyArray<string>;
    plotNodeIds: ReadonlyArray<string>;
  }>;
}

export interface LegacyBookDiagnosisFailedEvent {
  type: 'legacy-book-diagnosis-failed';
  runId: RunId;
  error: string;
}

export interface StoryAssetExtractionStartedEvent {
  type: 'story-asset-extraction-started';
  runId: RunId;
  projectId: string;
}

export interface StoryAssetExtractionCompletedEvent {
  type: 'story-asset-extraction-completed';
  runId: RunId;
  projectId: string;
  snapshot: import('./query-messages.js').StoryAssetSnapshotDto;
}

export interface StoryAssetExtractionFailedEvent {
  type: 'story-asset-extraction-failed';
  runId: RunId;
  error: string;
}

export interface StoryAssetConfirmedEvent {
  type: 'story-asset-confirmed';
  runId: RunId;
  assetKind: 'plotThread' | 'character' | 'relation' | 'arc' | 'foreshadowing';
  assetId: string;
}

export interface StoryAssetConfirmationFailedEvent {
  type: 'story-asset-confirmation-failed';
  runId: RunId;
  error: string;
}

export interface StoryAssetChangedEvent {
  type: 'story-asset-changed';
  runId: RunId;
  action: 'edited' | 'published';
  snapshot: import('./query-messages.js').StoryAssetSnapshotDto;
}

export interface StoryAssetChangeFailedEvent {
  type: 'story-asset-change-failed';
  runId: RunId;
  action: 'edited' | 'published';
  error: string;
}

export interface NewOutlineGenerationStartedEvent {
  type: 'new-outline-generation-started';
  runId: RunId;
  projectId: string;
}

export interface NewOutlineGenerationCompletedEvent {
  type: 'new-outline-generation-completed';
  runId: RunId;
  projectId: string;
  outline: import('./query-messages.js').NewOutlineDto;
}

export interface NewOutlineGenerationFailedEvent {
  type: 'new-outline-generation-failed';
  runId: RunId;
  error: string;
}

export type BackendControlEvent =
  | LegacyPlotAdvisorCompletedEvent
  | LegacyPlotAdvisorFailedEvent
  | LegacyBookDiagnosisCompletedEvent
  | LegacyBookDiagnosisFailedEvent
  | StoryAssetExtractionStartedEvent
  | StoryAssetExtractionCompletedEvent
  | StoryAssetExtractionFailedEvent
  | StoryAssetConfirmedEvent
  | StoryAssetConfirmationFailedEvent
  | StoryAssetChangedEvent
  | StoryAssetChangeFailedEvent
  | NewOutlineGenerationStartedEvent
  | NewOutlineGenerationCompletedEvent
  | NewOutlineGenerationFailedEvent
  | WorkflowSnapshotEvent
  | WorkflowFailureEvent
  | AssetTargetSelectionRequiredEvent
  | CreativeAssetChangeProposedEvent
  | CreativeAssetUpdatedEvent
  | AssetImpactDetectedEvent
  | InterruptRaisedEvent
  | ReviewCompletedEvent
  | TargetedVerificationCompletedEvent
  | TargetedVerificationFailedEvent
  | GraphNodeActivatedEvent
  | FactExtractionStartedEvent
  | FactExtractionCompletedEvent
  | FactExtractionFailedEvent
  | GlobalAuditStartedEvent
  | GlobalAuditProgressEvent
  | GlobalAuditCompletedEvent
  | GlobalAuditFailedEvent
  | StoryBibleFactConfirmedEvent
  | StoryBibleFactConfirmationFailedEvent
  | StoryBibleFactEditedEvent
  | StoryBibleFactEditFailedEvent
  | StoryBibleFactDeletedEvent
  | StoryBibleFactDeleteFailedEvent
  | StoryBibleEntitiesMergedEvent
  | StoryBibleEntitiesMergeFailedEvent
  | RefactorDiffComputedEvent
  | RefactorDiffFailedEvent
  | RefactorAppliedEvent
  | RefactorApplyFailedEvent
  | CorpusRetrievalStartedEvent
  | CorpusRetrievalCompletedEvent
  | CorpusRetrievalFailedEvent;
