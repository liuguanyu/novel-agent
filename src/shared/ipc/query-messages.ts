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
  /** 取某节点正文 */
  getChapterContent: 'query:get-chapter-content',
  /** 取 checkpoint 历史链（time-travel task 5.1） */
  getCheckpointHistory: 'query:get-checkpoint-history',
  /** 取当前 Story Bible 事实视图（只读 DTO）。 */
  getStoryBible: 'query:get-story-bible',
  /** 取 architect 架构看板视图（只读投影 DTO：时间线轴/情节线/人设集）。 */
  getArchitectBoard: 'query:get-architect-board',
} as const;

export type QueryChannel = (typeof QUERY_CHANNELS)[keyof typeof QUERY_CHANNELS];

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
