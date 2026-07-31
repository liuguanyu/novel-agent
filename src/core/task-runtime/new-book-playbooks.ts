/**
 * 新书创作目标模板对应的 Task Playbook 定义（Phase 5.1）。
 *
 * 与 `NEW_BOOK_CREATION_TEMPLATE`（src/core/workflow/templates.ts）的规划类 stage 一一对齐：
 * concept / worldbuilding / character-design / book-outline / chapter-plan / scene-outline。
 * 这些定义是框架无关的纯声明，供 Main 侧注册每步执行器（Phase 5.2）与 Renderer 复用任务卡（Phase 5.3）。
 * 不依赖项目已有正文：新书从零起步，输入均为立意/设定/上文产物而非既有章节。
 */

import type { TaskPlaybook } from './task-model.js';

/** 立意与定位：确立作品的核心命题、类型定位与目标读者。 */
export const NEW_BOOK_CONCEPT_PLAYBOOK = {
  id: 'new-book.concept',
  version: 1,
  kind: 'new-book',
  title: '立意与定位',
  description: '从初始构想出发，确立作品的核心命题、类型定位、基调与目标读者。',
  inputs: [
    {
      key: 'premise',
      label: '初始构想',
      valueType: 'string',
      required: true,
      description: '作者提供的一句话或一段话的创作初衷。',
    },
    {
      key: 'preferences',
      label: '创作偏好',
      valueType: 'object',
      required: false,
      description: '可选的类型、篇幅、基调、题材与读者定位偏好。',
    },
  ],
  steps: [
    {
      id: 'explore-angles',
      title: '探索立意角度',
      description: '基于初始构想扩展若干可能的核心命题与差异化定位。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-confirm-concept',
      title: '作者确认立意',
      description: '由作者选择并确认最终的核心命题与类型定位。',
      requiresAuthorDecision: true,
    },
  ],
  outputs: [
    {
      key: 'concept',
      label: '作品立意',
      valueType: 'object',
      description: '经作者确认的核心命题、类型定位、基调与目标读者。',
    },
  ],
} as const satisfies TaskPlaybook<
  'premise' | 'preferences',
  'explore-angles' | 'author-confirm-concept',
  'concept'
>;

/** 世界观设定：在立意之上构建世界规则、背景与设定基线。 */
export const NEW_BOOK_WORLDBUILDING_PLAYBOOK = {
  id: 'new-book.worldbuilding',
  version: 1,
  kind: 'new-book',
  title: '世界观设定',
  description: '在已确认的立意之上，构建世界规则、时空背景、势力结构与设定基线。',
  inputs: [
    {
      key: 'concept',
      label: '作品立意',
      valueType: 'object',
      required: true,
      description: '立意阶段确认的核心命题与类型定位。',
    },
    {
      key: 'constraints',
      label: '设定约束',
      valueType: 'object',
      required: false,
      description: '可选的题材约束、禁忌、参考作品或既定设定。',
    },
  ],
  steps: [
    {
      id: 'draft-setting',
      title: '起草世界设定',
      description: '产出世界规则、时空背景与关键势力的候选设定。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-confirm-setting',
      title: '作者确认设定',
      description: '由作者审阅并确认世界观设定基线。',
      requiresAuthorDecision: true,
    },
  ],
  outputs: [
    {
      key: 'worldSetting',
      label: '世界观设定',
      valueType: 'object',
      description: '经作者确认的世界规则、背景与设定基线。',
    },
  ],
} as const satisfies TaskPlaybook<
  'concept' | 'constraints',
  'draft-setting' | 'author-confirm-setting',
  'worldSetting'
>;

/** 人物设计：从立意与世界观出发，设计互补的人物阵容与关系。 */
export const NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK = {
  id: 'new-book.character-design',
  version: 1,
  kind: 'new-book',
  title: '人物设计',
  description: '从立意与世界观出发，设计互补的人物阵容、动机、成长弧线与相互关系。',
  inputs: [
    {
      key: 'concept',
      label: '作品立意',
      valueType: 'object',
      required: true,
      description: '立意阶段确认的核心命题与类型定位。',
    },
    {
      key: 'worldSetting',
      label: '世界观设定',
      valueType: 'object',
      required: false,
      description: '世界观阶段确认的设定基线，用于约束人物背景。',
    },
  ],
  steps: [
    {
      id: 'draft-cast',
      title: '起草人物阵容',
      description: '产出互补的主要人物、动机、缺陷与相互关系候选。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-confirm-cast',
      title: '作者确认阵容',
      description: '由作者选择并调整最终人物阵容与关键关系。',
      requiresAuthorDecision: true,
    },
    {
      id: 'finalize-profiles',
      title: '产出人物档案',
      description: '结合作者决策生成结构化人物档案。',
      requiresAuthorDecision: false,
    },
  ],
  outputs: [
    {
      key: 'characterProfiles',
      label: '人物档案',
      valueType: 'array',
      description: '经作者确认的结构化人物档案。',
    },
  ],
} as const satisfies TaskPlaybook<
  'concept' | 'worldSetting',
  'draft-cast' | 'author-confirm-cast' | 'finalize-profiles',
  'characterProfiles'
>;

/** 全书大纲：整合立意、世界观与人物，规划主线、支线与故事线走向。 */
export const NEW_BOOK_OUTLINE_PLAYBOOK = {
  id: 'new-book.book-outline',
  version: 1,
  kind: 'new-book',
  title: '全书大纲',
  description: '整合立意、世界观与人物，规划主线、支线与关键转折，形成全书故事线。',
  inputs: [
    {
      key: 'concept',
      label: '作品立意',
      valueType: 'object',
      required: true,
      description: '立意阶段确认的核心命题与类型定位。',
    },
    {
      key: 'characterProfiles',
      label: '人物档案',
      valueType: 'array',
      required: true,
      description: '人物设计阶段确认的人物档案。',
    },
    {
      key: 'worldSetting',
      label: '世界观设定',
      valueType: 'object',
      required: false,
      description: '世界观阶段确认的设定基线。',
    },
  ],
  steps: [
    {
      id: 'draft-arc',
      title: '起草故事线',
      description: '产出主线、支线与关键转折的候选结构。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-confirm-outline',
      title: '作者确认大纲',
      description: '由作者审阅并确认全书故事线走向。',
      requiresAuthorDecision: true,
    },
  ],
  outputs: [
    {
      key: 'bookOutline',
      label: '全书大纲',
      valueType: 'object',
      description: '经作者确认的主线、支线与关键转折结构。',
    },
  ],
} as const satisfies TaskPlaybook<
  'concept' | 'characterProfiles' | 'worldSetting',
  'draft-arc' | 'author-confirm-outline',
  'bookOutline'
>;

/** 章节规划：把全书大纲拆解为卷章结构与每章目标。 */
export const NEW_BOOK_CHAPTER_PLAN_PLAYBOOK = {
  id: 'new-book.chapter-plan',
  version: 1,
  kind: 'new-book',
  title: '章节规划',
  description: '把全书大纲拆解为卷章结构，明确每章的目标、冲突与在故事线中的位置。',
  inputs: [
    {
      key: 'bookOutline',
      label: '全书大纲',
      valueType: 'object',
      required: true,
      description: '全书大纲阶段确认的故事线结构。',
    },
    {
      key: 'targetScope',
      label: '规划范围',
      valueType: 'object',
      required: false,
      description: '可选的本次规划卷章范围或篇幅目标。',
    },
  ],
  steps: [
    {
      id: 'draft-chapter-map',
      title: '起草卷章结构',
      description: '产出卷章划分与每章目标、冲突的候选安排。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-confirm-chapters',
      title: '作者确认章节',
      description: '由作者审阅并确认卷章结构与每章目标。',
      requiresAuthorDecision: true,
    },
  ],
  outputs: [
    {
      key: 'chapterPlan',
      label: '章节规划',
      valueType: 'array',
      description: '经作者确认的卷章结构与每章目标。',
    },
  ],
} as const satisfies TaskPlaybook<
  'bookOutline' | 'targetScope',
  'draft-chapter-map' | 'author-confirm-chapters',
  'chapterPlan'
>;

/** 分场大纲：把单章目标拆解为分场节拍，为正文写作做准备。 */
export const NEW_BOOK_SCENE_OUTLINE_PLAYBOOK = {
  id: 'new-book.scene-outline',
  version: 1,
  kind: 'new-book',
  title: '分场大纲',
  description: '把单章目标拆解为分场节拍，明确每场的视角、目标、冲突与出入场信息。',
  inputs: [
    {
      key: 'chapterPlan',
      label: '章节规划',
      valueType: 'object',
      required: true,
      description: '目标章节在章节规划中的目标与冲突。',
    },
    {
      key: 'characterProfiles',
      label: '人物档案',
      valueType: 'array',
      required: false,
      description: '人物设计阶段确认的人物档案，用于安排出场。',
    },
  ],
  steps: [
    {
      id: 'draft-scenes',
      title: '起草分场节拍',
      description: '产出该章的分场节拍与每场目标、冲突候选。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-confirm-scenes',
      title: '作者确认分场',
      description: '由作者审阅并确认分场节拍。',
      requiresAuthorDecision: true,
    },
  ],
  outputs: [
    {
      key: 'sceneOutline',
      label: '分场大纲',
      valueType: 'array',
      description: '经作者确认的分场节拍。',
    },
  ],
} as const satisfies TaskPlaybook<
  'chapterPlan' | 'characterProfiles',
  'draft-scenes' | 'author-confirm-scenes',
  'sceneOutline'
>;

/** 章节初稿生成：基于分场大纲写出该章初稿，交由作者审阅。 */
export const NEW_BOOK_DRAFT_WRITING_PLAYBOOK = {
  id: 'new-book.draft-writing',
  version: 1,
  kind: 'new-book',
  title: '章节初稿生成',
  description: '基于已确认的分场大纲与上下文写出该章初稿，供作者审阅与修订。',
  inputs: [
    {
      key: 'sceneOutline',
      label: '分场大纲',
      valueType: 'array',
      required: true,
      description: '分场大纲阶段确认的该章分场节拍。',
    },
    {
      key: 'characterProfiles',
      label: '人物档案',
      valueType: 'array',
      required: false,
      description: '人物设计阶段确认的人物档案，用于保持人物一致。',
    },
    {
      key: 'worldSetting',
      label: '世界观设定',
      valueType: 'object',
      required: false,
      description: '世界观阶段确认的设定基线，用于约束正文细节。',
    },
  ],
  steps: [
    {
      id: 'compose-draft',
      title: '撰写章节初稿',
      description: '按分场节拍逐场写出该章初稿正文。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-accept-draft',
      title: '作者确认初稿',
      description: '由作者接受初稿或提出修订方向。',
      requiresAuthorDecision: true,
    },
  ],
  outputs: [
    {
      key: 'chapterDraft',
      label: '章节初稿',
      valueType: 'object',
      description: '经作者确认可进入修订的章节初稿引用。',
    },
  ],
} as const satisfies TaskPlaybook<
  'sceneOutline' | 'characterProfiles' | 'worldSetting',
  'compose-draft' | 'author-accept-draft',
  'chapterDraft'
>;

/** 作者修订：把作者的修订意见应用到初稿，产出修订稿。 */
export const NEW_BOOK_AUTHOR_REVISION_PLAYBOOK = {
  id: 'new-book.author-revision',
  version: 1,
  kind: 'new-book',
  title: '作者修订',
  description: '接收作者对初稿的修订意见，产出应用了作者决策的修订稿。',
  inputs: [
    {
      key: 'chapterDraft',
      label: '章节初稿',
      valueType: 'object',
      required: true,
      description: '初稿生成阶段确认的章节初稿。',
    },
    {
      key: 'revisionBrief',
      label: '修订意见',
      valueType: 'object',
      required: false,
      description: '可选的作者修订方向或具体批注。',
    },
  ],
  steps: [
    {
      id: 'propose-revisions',
      title: '整理修订方案',
      description: '基于作者意见与初稿整理可执行的修订方案。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-approve-revisions',
      title: '作者确认修订',
      description: '由作者选择接受、调整或拒绝各项修订。',
      requiresAuthorDecision: true,
    },
    {
      id: 'apply-revisions',
      title: '产出修订稿',
      description: '结合作者决策产出该章修订稿。',
      requiresAuthorDecision: false,
    },
  ],
  outputs: [
    {
      key: 'revisedDraft',
      label: '修订稿',
      valueType: 'object',
      description: '经作者确认的章节修订稿引用。',
    },
  ],
} as const satisfies TaskPlaybook<
  'chapterDraft' | 'revisionBrief',
  'propose-revisions' | 'author-approve-revisions' | 'apply-revisions',
  'revisedDraft'
>;

/** 连贯性检查：对修订稿做上下文与设定一致性检查，产出问题清单。 */
export const NEW_BOOK_COHERENCE_CHECK_PLAYBOOK = {
  id: 'new-book.coherence-check',
  version: 1,
  kind: 'new-book',
  title: '连贯性检查',
  description: '对章节稿做上下文、人物与设定的一致性检查，产出需作者裁决的问题清单。',
  inputs: [
    {
      key: 'revisedDraft',
      label: '待检查稿',
      valueType: 'object',
      required: true,
      description: '作者修订阶段确认的修订稿，或初稿。',
    },
    {
      key: 'factView',
      label: '事实底稿',
      valueType: 'object',
      required: false,
      description: '既有事实底稿视图，用于比对设定与前文事实。',
    },
  ],
  steps: [
    {
      id: 'scan-coherence',
      title: '扫描一致性问题',
      description: '比对设定、人物与前文事实，产出候选一致性问题。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-triage-issues',
      title: '作者裁决问题',
      description: '由作者裁决各问题是否需要返修。',
      requiresAuthorDecision: true,
    },
  ],
  outputs: [
    {
      key: 'coherenceReport',
      label: '连贯性报告',
      valueType: 'object',
      description: '经作者裁决的一致性问题清单与处理结论。',
    },
  ],
} as const satisfies TaskPlaybook<
  'revisedDraft' | 'factView',
  'scan-coherence' | 'author-triage-issues',
  'coherenceReport'
>;

/** 事实底稿更新：把定稿章节的新事实抽取并更新到事实底稿。 */
export const NEW_BOOK_FACT_UPDATE_PLAYBOOK = {
  id: 'new-book.fact-update',
  version: 1,
  kind: 'new-book',
  title: '事实底稿更新',
  description: '从定稿章节抽取新事实，与既有事实底稿合并，冲突项交由作者裁决。',
  inputs: [
    {
      key: 'revisedDraft',
      label: '定稿章节',
      valueType: 'object',
      required: true,
      description: '经连贯性检查的章节稿。',
    },
    {
      key: 'factView',
      label: '既有事实底稿',
      valueType: 'object',
      required: false,
      description: '合并前的事实底稿视图。',
    },
  ],
  steps: [
    {
      id: 'extract-facts',
      title: '抽取章节新事实',
      description: '从章节稿抽取人物、设定与情节等新事实候选。',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-resolve-conflicts',
      title: '作者裁决冲突',
      description: '当新事实与既有底稿冲突时，由作者裁决取舍。',
      requiresAuthorDecision: true,
    },
    {
      id: 'merge-facts',
      title: '合并事实底稿',
      description: '结合作者裁决产出更新后的事实底稿版本引用。',
      requiresAuthorDecision: false,
    },
  ],
  outputs: [
    {
      key: 'factStoreUpdate',
      label: '事实底稿更新',
      valueType: 'object',
      description: '经作者裁决合并的事实底稿新版本引用。',
    },
  ],
} as const satisfies TaskPlaybook<
  'revisedDraft' | 'factView',
  'extract-facts' | 'author-resolve-conflicts' | 'merge-facts',
  'factStoreUpdate'
>;

/** 新书规划阶段全部 playbook，顺序与 NEW_BOOK_CREATION_TEMPLATE 的规划 stage 一致。 */
export const NEW_BOOK_PLANNING_PLAYBOOKS = [
  NEW_BOOK_CONCEPT_PLAYBOOK,
  NEW_BOOK_WORLDBUILDING_PLAYBOOK,
  NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK,
  NEW_BOOK_OUTLINE_PLAYBOOK,
  NEW_BOOK_CHAPTER_PLAN_PLAYBOOK,
  NEW_BOOK_SCENE_OUTLINE_PLAYBOOK,
] as const;

/**
 * NEW_BOOK_CREATION_TEMPLATE 的 stage id → 对应规划 playbook。
 * 供 Main 侧按当前 stage 选取 playbook 注册/执行（Phase 5.2），Renderer 侧展示任务目标（Phase 5.3）。
 */
export const NEW_BOOK_STAGE_PLAYBOOKS = {
  concept: NEW_BOOK_CONCEPT_PLAYBOOK,
  worldbuilding: NEW_BOOK_WORLDBUILDING_PLAYBOOK,
  'character-design': NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK,
  'book-outline': NEW_BOOK_OUTLINE_PLAYBOOK,
  'chapter-plan': NEW_BOOK_CHAPTER_PLAN_PLAYBOOK,
  'scene-outline': NEW_BOOK_SCENE_OUTLINE_PLAYBOOK,
} as const;

export type NewBookPlanningStageId = keyof typeof NEW_BOOK_STAGE_PLAYBOOKS;

/**
 * 新书写作与审校循环 playbook，覆盖分场大纲之后的初稿、修订、连贯性检查与事实更新。
 * 供 Phase 5.2 Main 侧注册真实每步执行器，形成「初稿→修订→检查→事实更新」闭环。
 */
export const NEW_BOOK_WRITING_PLAYBOOKS = [
  NEW_BOOK_DRAFT_WRITING_PLAYBOOK,
  NEW_BOOK_AUTHOR_REVISION_PLAYBOOK,
  NEW_BOOK_COHERENCE_CHECK_PLAYBOOK,
  NEW_BOOK_FACT_UPDATE_PLAYBOOK,
] as const;

/**
 * NEW_BOOK_CREATION_TEMPLATE 的写作/审校 stage id → 对应循环 playbook。
 * draft-writing → 初稿生成；author-review → 作者修订；automatic-review → 连贯性检查；fact-extraction → 事实底稿更新。
 */
export const NEW_BOOK_WRITING_STAGE_PLAYBOOKS = {
  'draft-writing': NEW_BOOK_DRAFT_WRITING_PLAYBOOK,
  'author-review': NEW_BOOK_AUTHOR_REVISION_PLAYBOOK,
  'automatic-review': NEW_BOOK_COHERENCE_CHECK_PLAYBOOK,
  'fact-extraction': NEW_BOOK_FACT_UPDATE_PLAYBOOK,
} as const;

export type NewBookWritingStageId = keyof typeof NEW_BOOK_WRITING_STAGE_PLAYBOOKS;

/** 全部新书 playbook：规划阶段 + 写作审校循环。 */
export const NEW_BOOK_PLAYBOOKS = [
  ...NEW_BOOK_PLANNING_PLAYBOOKS,
  ...NEW_BOOK_WRITING_PLAYBOOKS,
] as const;
