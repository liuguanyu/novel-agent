import type { TaskPlaybook } from './task-model.js';

export const LEGACY_LOCATE_SOURCE_PLAYBOOK = {
  id: 'legacy.locate-source',
  version: 1,
  kind: 'legacy-book',
  title: '定位诊断问题对应的原文',
  description: '根据诊断证据和章节锚点，在既有正文中确定可安全修订的位置。',
  inputs: [
    {
      key: 'issue',
      label: '诊断问题',
      valueType: 'object',
      required: true,
      description: '需要修复的问题及其作者可读说明。',
    },
    {
      key: 'evidence',
      label: '证据引文',
      valueType: 'object',
      required: true,
      description: '诊断阶段保存的引文和可选前后文。',
    },
    {
      key: 'chapterAnchor',
      label: '章节锚点',
      valueType: 'string',
      required: true,
      description: '证据所属的目标章节。',
    },
    {
      key: 'factContext',
      label: '事实底稿上下文',
      valueType: 'object',
      required: false,
      description: '用于验证位置与问题语义的相关事实引用。',
    },
  ],
  steps: [
    {
      id: 'read-chapter',
      title: '读取目标章节',
      description: '从 Main 侧读取章节正文，不把全文写入活动流。',
      requiresAuthorDecision: false,
    },
    {
      id: 'match-evidence',
      title: '匹配诊断证据',
      description: '执行精确匹配和上下文验证，保留所有未消歧候选。',
      requiresAuthorDecision: false,
    },
    {
      id: 'confirm-location',
      title: '确认原文位置',
      description: '多个候选无法消歧时由作者明确选择。',
      requiresAuthorDecision: true,
    },
  ],
  outputs: [
    {
      key: 'sourceLocation',
      label: '原文定位结果',
      valueType: 'object',
      description: '作者确认或上下文唯一验证的章节和字符区间。',
    },
  ],
} as const satisfies TaskPlaybook<
  'issue' | 'evidence' | 'chapterAnchor' | 'factContext',
  'read-chapter' | 'match-evidence' | 'confirm-location',
  'sourceLocation'
>;

export const NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK = {
  id: 'new-book.character-design',
  version: 1,
  kind: 'new-book',
  title: 'Design new-book characters',
  description: 'Develop a character set from the premise and creative constraints.',
  inputs: [
    {
      key: 'premise',
      label: 'Book premise',
      valueType: 'string',
      required: true,
      description: 'The core premise that the characters must serve.',
    },
    {
      key: 'constraints',
      label: 'Creative constraints',
      valueType: 'object',
      required: false,
      description: 'Optional genre, cast-size, tone, or representation constraints.',
    },
  ],
  steps: [
    {
      id: 'draft-cast',
      title: 'Draft cast',
      description: 'Generate complementary character roles and motivations.',
      requiresAuthorDecision: false,
    },
    {
      id: 'author-review',
      title: 'Author review',
      description: 'Collect the author’s selection and requested changes.',
      requiresAuthorDecision: true,
    },
    {
      id: 'finalize-profiles',
      title: 'Finalize profiles',
      description: 'Produce profiles incorporating the author decision.',
      requiresAuthorDecision: false,
    },
  ],
  outputs: [
    {
      key: 'characterProfiles',
      label: 'Character profiles',
      valueType: 'array',
      description: 'The approved structured character profiles.',
    },
  ],
} as const satisfies TaskPlaybook<
  'premise' | 'constraints',
  'draft-cast' | 'author-review' | 'finalize-profiles',
  'characterProfiles'
>;

export const TEMPORARY_EDITORIAL_PLAYBOOK = {
  id: 'temporary.editorial',
  version: 1,
  kind: 'temporary',
  title: 'Temporary editorial task',
  description: 'Review supplied text without requiring a book or manuscript reference.',
  inputs: [
    {
      key: 'text',
      label: 'Text',
      valueType: 'string',
      required: true,
      description: 'Standalone text to review.',
    },
    {
      key: 'editorialBrief',
      label: 'Editorial brief',
      valueType: 'string',
      required: true,
      description: 'The editorial goal or question to address.',
    },
  ],
  steps: [
    {
      id: 'review-text',
      title: 'Review text',
      description: 'Evaluate the supplied text against the editorial brief.',
      requiresAuthorDecision: false,
    },
  ],
  outputs: [
    {
      key: 'editorialNotes',
      label: 'Editorial notes',
      valueType: 'string',
      description: 'Standalone editorial feedback.',
    },
  ],
} as const satisfies TaskPlaybook<
  'text' | 'editorialBrief',
  'review-text',
  'editorialNotes'
>;

export const TASK_PLAYBOOK_FIXTURES = [
  LEGACY_LOCATE_SOURCE_PLAYBOOK,
  NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK,
  TEMPORARY_EDITORIAL_PLAYBOOK,
] as const;
