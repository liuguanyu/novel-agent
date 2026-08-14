/**
 * 前端 ↔ 后端 请求-响应查询消息 (walking-skeleton)
 *
 * 与流式消息（stream-messages）正交：流式走事件通道（token 增量），查询走 invoke/handle 请求-响应
 * （取章节树、取正文等一次性数据）。
 *
 * 本文件仅为类型定义（跨进程契约，shared/ 叶子层）。DTO 为**纯可序列化结构**，不依赖 core/ 域类型：
 * 节点以 opaque 字符串 id + kind 承载（与 NodeRef 同构，Main 侧由 core 模型投影而来）。
 */

/** 查询请求通道名（供 invoke/handle 使用）。 */
export const QUERY_CHANNELS = {
  /** 取章节树 */
  getChapterTree: 'query:get-chapter-tree',
  /** 取当前工作区项目身份（供 workflow 归属，不暴露本地路径） */
  getWorkspaceProject: 'query:get-workspace-project',
  /** 取某节点正文 */
  getChapterContent: 'query:get-chapter-content',
  /** 取 checkpoint 历史链（time-travel task 5.1） */
  getCheckpointHistory: 'query:get-checkpoint-history',
  /** 取当前 Story Bible 事实视图（只读 DTO）。 */
  getStoryBible: 'query:get-story-bible',
  /** 取 architect 架构看板视图（只读投影 DTO：时间线轴/情节线/人设集）。 */
  getArchitectBoard: 'query:get-architect-board',
  /** 取持久化任务运行摘要、作者可见活动及待确认候选。 */
  getTaskCenter: 'query:get-task-center',
  /** 取老书整理的最新旧稿大纲。 */
  getLegacyOutline: 'query:get-legacy-outline',
  /** 取老书整理的保留内容清单。 */
  getPreservationManifest: 'query:get-preservation-manifest',
  /** 取大纲生成进度。 */
  getOutlineGenerationProgress: 'query:get-outline-generation-progress',
  /** 取故事资产快照。 */
  getStoryAssetSnapshot: 'query:get-story-asset-snapshot',
  /** 取新版大纲。 */
  getNewOutline: 'query:get-new-outline',
} as const;

export type QueryChannel = (typeof QUERY_CHANNELS)[keyof typeof QUERY_CHANNELS];

export interface GetTaskCenterRequest {
  readonly projectId?: string;
  readonly workflowId?: string;
  readonly limit?: number;
}

export interface TaskRunSummaryDto {
  readonly taskRunId: string;
  readonly kind: 'legacy-book' | 'new-book' | 'temporary';
  readonly playbookId: string;
  readonly status: 'queued' | 'running' | 'awaiting-author' | 'paused' | 'completed' | 'failed' | 'cancelled';
  readonly workflowId: string | null;
  readonly workflowStageId: string | null;
  readonly issueId: string | null;
  readonly currentStepId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskCenterSnapshotDto {
  readonly runs: ReadonlyArray<TaskRunSummaryDto>;
  readonly events: ReadonlyArray<import('./task-activity-messages.js').BackendTaskActivityEvent>;
}

export interface WorkspaceProjectContextDto {
  readonly projectId: string;
  readonly title: string;
}

/** 节点层级（与 core manuscript NodeKind 同值，此处独立声明以守叶子约束）。 */
export type NodeKindDto = 'volume' | 'chapter' | 'scene';

/** 章节树节点 DTO（可序列化，跨 IPC）。 */
export interface ChapterTreeNodeDto {
  /** 稳定节点 id（对应 NodeRef.id） */
  id: string;
  kind: NodeKindDto;
  title: string;
  /** 同级顺序 */
  order: number;
  /** 子节点（卷含章、章含场景；叶子为空数组） */
  children: ReadonlyArray<ChapterTreeNodeDto>;
}

/** 取章节树的响应。 */
export interface ChapterTreeDto {
  /** 作品标题（取自 workspace 根目录名） */
  title: string;
  /** 顶层节点 */
  roots: ReadonlyArray<ChapterTreeNodeDto>;
}

/** 取正文的请求参数。 */
export interface GetChapterContentRequest {
  nodeId: string;
}

/** 取正文的响应。 */
export interface ChapterContentDto {
  nodeId: string;
  /** 正文内容（Markdown 原文） */
  content: string;
}

// ─── time-travel 查询 (section 5) ────────────────────────────────────

/** 取 checkpoint 历史链的请求参数。from 为空时取最近一次 run 的最新 checkpoint。 */
export interface GetCheckpointHistoryRequest {
  /** 起点 checkpoint id（可空：取最新 checkpoint） */
  checkpointId?: string;
}

/** checkpoint 快照摘要 DTO（只传可呈现字段，不传完整 NovelState）。 */
export interface CheckpointDto {
  /** checkpoint 标识 */
  id: string;
  /** 前驱 checkpoint 标识（可空） */
  parent: string | null;
  /** 产生该 checkpoint 的节点名 */
  atNode: string;
  /** 该时刻的对话历史摘要（取最后一条 user/assistant 消息的前 80 字） */
  summary: string;
  /** 创建时刻 epoch ms */
  createdAt: number;
}

/** 取 checkpoint 历史链的响应：沿 parent 链从 from 回溯到根的 checkpoint 摘要列表。 */
export interface CheckpointHistoryDto {
  /** 列表按时间倒序：[最新, ..., 根] */
  checkpoints: ReadonlyArray<CheckpointDto>;
}

// ─── Story Bible 查询 DTO（只读展示，不暴露 core/db 类型） ───────────────

export interface ProvenanceSourceDto {
  location: { id: string; kind: NodeKindDto };
  quote: string;
  confidence: number;
}

export interface EntityAttributeDto {
  key: string;
  value: string;
  status: 'confirmed' | 'inferred' | 'conflicting';
  sources: ReadonlyArray<ProvenanceSourceDto>;
}

export interface StoryBibleEntityDto {
  id: string;
  type: string;
  canonicalName: string;
  aliases: ReadonlyArray<string>;
  attributes: ReadonlyArray<EntityAttributeDto>;
  status: 'confirmed' | 'inferred' | 'conflicting';
  sources: ReadonlyArray<ProvenanceSourceDto>;
}

export interface StoryBibleTimelineEventDto {
  id: string;
  description: string;
  tick: number;
  label: string;
  relatedEntityIds: ReadonlyArray<string>;
  status: 'confirmed' | 'inferred' | 'conflicting';
  sources: ReadonlyArray<ProvenanceSourceDto>;
}

export interface StoryBibleRelationDto {
  id: string;
  fromEntityId: string;
  fromName: string;
  toEntityId: string;
  toName: string;
  directionality: 'directed' | 'undirected';
  phases: ReadonlyArray<{
    kind: string;
    tick: number;
    label: string;
    status: 'confirmed' | 'inferred' | 'conflicting';
    sources: ReadonlyArray<ProvenanceSourceDto>;
  }>;
}

export interface StoryBiblePlotHookDto {
  id: string;
  description: string;
  state: 'planted' | 'pending' | 'paid_off' | 'abandoned';
  plantedAt: { id: string; kind: NodeKindDto };
  paidOffAt?: { id: string; kind: NodeKindDto };
  status: 'confirmed' | 'inferred' | 'conflicting';
  sources: ReadonlyArray<ProvenanceSourceDto>;
}

export interface StoryBibleDto {
  latestVersion: string | null;
  entities: ReadonlyArray<StoryBibleEntityDto>;
  timelineEvents: ReadonlyArray<StoryBibleTimelineEventDto>;
  relations: ReadonlyArray<StoryBibleRelationDto>;
  plotHooks: ReadonlyArray<StoryBiblePlotHookDto>;
}

// ─── architect 架构看板 DTO（只读投影，三轴复用 Story Bible 子结构） ────────

/**
 * architect 维护的架构看板视图（后端投影产物）。
 * 三轴复用 Story Bible 子 DTO（不另立事实结构）：时间线轴按 tick 升序、情节线为伏笔集、人设集为实体。
 * 排序/派生在后端完成，Renderer 只呈现（见 architect-board spec「看板排序与计算归后端」）。
 */
export interface ArchitectBoardDto {
  latestVersion: string | null;
  /** 时间线轴：按 tick 升序排列的时间线事件。 */
  timeline: ReadonlyArray<StoryBibleTimelineEventDto>;
  /** 并行情节线：伏笔/情节钩子集。 */
  plotHooks: ReadonlyArray<StoryBiblePlotHookDto>;
  /** 核心人设集：实体。 */
  entities: ReadonlyArray<StoryBibleEntityDto>;
}

// ─── 老书整理 v2 查询 DTO（大纲与保留内容） ───────────────────

/** 大纲节点来源（DTO 投影，shared/ 不依赖 core/）。 */
export interface OutlineSourceRefDto {
  readonly nodeId: string;
  readonly label: string;
  readonly quote: string | undefined;
}

/** 大纲节点 DTO。 */
export interface OutlineNodeDto {
  readonly id: string;
  readonly parentId: string | undefined;
  readonly order: number;
  readonly kind: 'volume' | 'chapter' | 'arc' | 'plot-beat' | 'scene';
  readonly title: string;
  readonly summary: string;
  readonly characters: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<OutlineSourceRefDto>;
  readonly crossChapter: boolean;
  readonly preserved: boolean;
  readonly authorNote: string | undefined;
}

/** 单轮参谋讨论记录 DTO。 */
export interface AdvisorConversationTurnDto {
  readonly question: string;
  readonly advice: string;
  readonly options: ReadonlyArray<string>;
  readonly askedAt: string;
}

/** 单个情节的参谋讨论记录 DTO。 */
export interface AdvisorConversationDto {
  readonly plotNodeId: string;
  readonly turns: ReadonlyArray<AdvisorConversationTurnDto>;
  readonly updatedAt: string;
}

/** 旧稿大纲 DTO。 */
export interface LegacyOutlineDto {
  readonly id: string;
  readonly projectId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly nodes: ReadonlyArray<OutlineNodeDto>;
  /** 作者确认和调整后的重写情节线；元素为稳定 plot node id。 */
  readonly plotSequence: ReadonlyArray<string>;
  readonly deletedPlots: ReadonlyArray<DeletedPlotDto>;
  readonly crossChapterIssues: ReadonlyArray<CrossChapterIssueDto>;
  readonly advisorConversations: ReadonlyArray<AdvisorConversationDto>;
}

export interface DeletedPlotDto {
  readonly node: OutlineNodeDto;
  readonly deletedAt: string;
}

export interface CrossChapterIssueDto {
  readonly id: string;
  readonly plotNodeIds: ReadonlyArray<string>;
  readonly chapterNodeIds: ReadonlyArray<string>;
  readonly kind: 'timeline' | 'character-state' | 'causality' | 'duplicate-event' | 'continuity' | 'other';
  readonly severity: 'low' | 'medium' | 'high' | 'unknown';
  readonly description: string;
  readonly evidence: ReadonlyArray<string>;
  readonly status: 'open' | 'confirmed' | 'resolved' | 'dismissed';
  readonly authorNote: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 保留情节 DTO。 */
export interface PreservedPlotDto {
  readonly id: string;
  readonly outlineNodeId: string;
  readonly title: string;
  readonly sourceNodeIds: ReadonlyArray<string>;
  readonly authorNote: string | undefined;
  readonly preservedAt: string;
}

/** 保留原文 DTO。 */
export interface PreservedQuoteDto {
  readonly id: string;
  readonly text: string;
  readonly sourceNodeId: string;
  readonly sourceChapterTitle: string;
  readonly outlineNodeId: string | undefined;
  readonly recommended: boolean;
  readonly authorNote: string | undefined;
  readonly preservedAt: string;
}

/** 保留清单 DTO。 */
export interface PreservationManifestDto {
  readonly projectId: string;
  readonly outlineId: string;
  readonly plots: ReadonlyArray<PreservedPlotDto>;
  readonly quotes: ReadonlyArray<PreservedQuoteDto>;
  readonly updatedAt: string;
}

/** 大纲生成进度 DTO。 */
export interface OutlineGenerationProgressDto {
  readonly status: 'idle' | 'reading' | 'structuring' | 'analyzing' | 'completed' | 'failed';
  readonly chaptersRead: number | undefined;
  readonly totalChapters: number | undefined;
  readonly error: string | undefined;
  readonly currentChapterTitle?: string;
  readonly currentSegment?: number;
  readonly totalSegments?: number;
  readonly failedChapters?: ReadonlyArray<{ chapterNodeId: string; title: string; error: string }>;
}

// ─── 故事资产 DTO（Roadmap M2） ──────────────────────────────────────────

/** 可信度等级 DTO */
export type CredibilityLevelDto = 'explicit' | 'inferred' | 'pending-confirmation' | 'pending-design';

/** 资产状态 DTO */
export type AssetStatusDto = 'draft' | 'confirmed' | 'formal';

/** 带可信度的结论 DTO */
export interface CredibleClaimDto {
  readonly value: string;
  readonly credibility: CredibilityLevelDto;
  readonly evidence: ReadonlyArray<{ readonly plotNodeId?: string; readonly chapterTitle?: string; readonly quote: string }>;
  readonly authorNote?: string;
}

/** 情节线阶段 DTO */
export interface PlotThreadStageDto {
  readonly kind: 'setup' | 'rising' | 'turn' | 'climax' | 'resolution';
  readonly plotNodeIds: ReadonlyArray<string>;
  readonly description: string;
}

/** 情节线 DTO */
export interface PlotThreadDto {
  readonly id: string;
  readonly name: string;
  readonly kind: 'main' | 'sub';
  readonly goal: CredibleClaimDto;
  readonly plotNodeIds: ReadonlyArray<string>;
  readonly characterIds: ReadonlyArray<string>;
  readonly stages: ReadonlyArray<PlotThreadStageDto>;
  readonly keyEvents: ReadonlyArray<{ readonly plotNodeId: string; readonly description: string; readonly cause?: string; readonly effect?: string }>;
  readonly timeAnchor?: CredibleClaimDto;
  readonly status: AssetStatusDto;
}

/** 人物档案 DTO */
export interface CharacterProfileDto {
  readonly id: string;
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  readonly identity: CredibleClaimDto;
  readonly appearance: CredibleClaimDto;
  readonly abilities: CredibleClaimDto;
  readonly personality: CredibleClaimDto;
  readonly languageStyle: CredibleClaimDto;
  readonly desire: CredibleClaimDto;
  readonly goal: CredibleClaimDto;
  readonly fear: CredibleClaimDto;
  readonly weakness: CredibleClaimDto;
  readonly currentStatus: CredibleClaimDto;
  readonly plotThreadIds: ReadonlyArray<string>;
  readonly narrativeFunction?: CredibleClaimDto;
  readonly status: AssetStatusDto;
}

/** 人物关系 DTO */
export interface CharacterRelationDto {
  readonly id: string;
  readonly fromCharacterId: string;
  readonly toCharacterId: string;
  readonly kind: 'ally' | 'enemy' | 'mentor' | 'lover' | 'family' | 'colleague' | 'rival' | 'other';
  readonly description: CredibleClaimDto;
  readonly changes: ReadonlyArray<{ readonly plotNodeId: string; readonly description: string }>;
  readonly status: AssetStatusDto;
}

/** 人物成长弧 DTO */
export interface CharacterArcDto {
  readonly id: string;
  readonly characterId: string;
  readonly description: string;
  readonly turningPoints: ReadonlyArray<{ readonly plotNodeId: string; readonly description: string }>;
  readonly startState?: string;
  readonly endState?: string;
  readonly status: AssetStatusDto;
}

/** 伏笔 DTO */
export interface ForeshadowingDto {
  readonly id: string;
  readonly description: string;
  readonly state: 'planted' | 'advanced' | 'paid-off' | 'abandoned';
  readonly plantedPlotNodeId: string;
  readonly paidOffPlotNodeId?: string;
  readonly advancedPlotNodeIds: ReadonlyArray<string>;
  readonly credibility: CredibilityLevelDto;
  readonly evidence: ReadonlyArray<{ readonly plotNodeId?: string; readonly chapterTitle?: string; readonly quote: string }>;
  readonly status: AssetStatusDto;
}

/** 故事资产快照 DTO */
export interface StoryAssetSnapshotDto {
  readonly id: string;
  readonly projectId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly plotThreads: ReadonlyArray<PlotThreadDto>;
  readonly characters: ReadonlyArray<CharacterProfileDto>;
  readonly relations: ReadonlyArray<CharacterRelationDto>;
  readonly arcs: ReadonlyArray<CharacterArcDto>;
  readonly foreshadowings: ReadonlyArray<ForeshadowingDto>;
  readonly sourceOutlineVersion: number | undefined;
}

// ─── 新版大纲 DTO（Roadmap M3） ──────────────────────────────────────────

/** 新版大纲节点来源关系 DTO */
export type SourceRelationDto = 'carried-over' | 'adjusted' | 'merged' | 'new' | 'deleted';

/** 新版大纲节点状态 DTO */
export type NewOutlineStatusDto = 'draft' | 'confirmed' | 'formal';

/** 新版大纲节点 DTO */
export interface NewOutlineNodeDto {
  readonly id: string;
  readonly parentId: string | undefined;
  readonly order: number;
  readonly kind: 'volume' | 'chapter' | 'arc' | 'plot-beat' | 'scene';
  readonly title: string;
  readonly summary: string;
  readonly goal: string;
  readonly conflict: string;
  readonly outcome: string;
  readonly sourceRelation: SourceRelationDto;
  readonly sourceNodeIds: ReadonlyArray<string>;
  readonly plotThreadIds: ReadonlyArray<string>;
  readonly characterIds: ReadonlyArray<string>;
  readonly preservedPlotIds: ReadonlyArray<string>;
  readonly preservedQuoteIds: ReadonlyArray<string>;
  readonly authorNote: string | undefined;
}

/** 保留项覆盖情况 DTO */
export interface PreservationCoverageDto {
  readonly totalPreservedPlots: number;
  readonly coveredPreservedPlots: number;
  readonly missingPreservedPlotIds: ReadonlyArray<string>;
  readonly totalPreservedQuotes: number;
  readonly coveredPreservedQuotes: number;
  readonly missingPreservedQuoteIds: ReadonlyArray<string>;
}

/** 旧稿到新版节点映射 DTO */
export interface NodeMappingDto {
  readonly sourceNodeId: string;
  readonly sourceNodeTitle: string;
  readonly targetNodeId: string | undefined;
  readonly targetNodeTitle: string | undefined;
  readonly relation: SourceRelationDto;
}

/** 新版大纲 DTO */
export interface NewOutlineDto {
  readonly id: string;
  readonly projectId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotVersion: number;
  readonly sourceLegacyOutlineVersion: number | undefined;
  readonly authorIntent: string | undefined;
  readonly nodes: ReadonlyArray<NewOutlineNodeDto>;
  readonly status: NewOutlineStatusDto;
}
