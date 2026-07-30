import type { WorkflowTemplate, WorkflowTemplateStage } from './types.js';

const stage = (
  id: string,
  label: string,
  actor: WorkflowTemplateStage['actor'],
  scope: WorkflowTemplateStage['scope'],
  gate: WorkflowTemplateStage['completionGate'],
  to?: string,
  allowedExperts: ReadonlyArray<string> = [],
  skippable = false,
  extraTransitions: ReadonlyArray<WorkflowTemplateStage['transitions'][number]> = [],
): WorkflowTemplateStage => ({
  id,
  label,
  actor,
  scope,
  allowedExperts,
  completionGate: gate,
  skippable,
  retryable: actor !== 'author',
  transitions: [...(to === undefined ? [] : [{ to, when: 'completed' as const }]), ...extraTransitions],
});

const confirm = { kind: 'author-confirmation', evidence: 'author-confirmation' } as const;
const automatic = { kind: 'automatic', evidence: 'run-succeeded' } as const;
const quality = { kind: 'quality', evidence: 'quality-gate', blockingOnFailure: true } as const;

export const NEW_BOOK_CREATION_TEMPLATE: WorkflowTemplate = {
  kind: 'new-book-creation', version: 1, label: '新书创作', initialStageId: 'concept',
  stages: [
    stage('concept', '立意与定位', 'expert', 'project', confirm, 'worldbuilding', ['concept-generator']),
    stage('worldbuilding', '世界观设定', 'expert', 'project', confirm, 'character-design', ['worldbuilding']),
    stage('character-design', '人物设计', 'expert', 'project', confirm, 'book-outline', ['character-generator']),
    stage('book-outline', '全书大纲', 'expert', 'project', confirm, 'chapter-plan', ['architect']),
    stage('chapter-plan', '章节规划', 'expert', 'chapter', confirm, 'scene-outline', ['architect']),
    stage('scene-outline', '分场大纲', 'expert', 'chapter', confirm, 'draft-writing', ['scene-outliner']),
    stage('draft-writing', '正文写作', 'expert', 'chapter', confirm, 'fact-extraction', ['writer']),
    stage('fact-extraction', '事实抽取', 'system', 'chapter', automatic, 'automatic-review'),
    stage('automatic-review', '自动审校', 'quality-gate', 'chapter', quality, 'author-review'),
    stage('author-review', '人工修改与验收', 'author', 'chapter', confirm, 'chapter-finalization'),
    stage(
      'chapter-finalization',
      '章节定稿与下一章决策',
      'author',
      'chapter',
      confirm,
      'whole-book-audit',
      [],
      false,
      [{ to: 'chapter-plan', when: 'continue-loop' }],
    ),
    stage('whole-book-audit', '全书总检', 'quality-gate', 'project', quality),
  ],
};

export const LEGACY_BOOK_REVISION_TEMPLATE: WorkflowTemplate = {
  kind: 'legacy-book-revision', version: 1, label: '老书重建与修订', initialStageId: 'import-book',
  stages: [
    stage('import-book', '确认既有小说与重建目标', 'author', 'project', confirm, 'fact-backfill'),
    stage('fact-backfill', '建立全书事实底稿', 'system', 'project', automatic, 'initial-audit'),
    stage('initial-audit', '全书诊断：人物·故事线·逻辑线', 'quality-gate', 'project', quality, 'issue-triage', [], false, [{ to: 'issue-triage', when: 'issues-found' }]),
    stage('issue-triage', '整理诊断结果与重建优先级', 'author', 'project', confirm, 'locate-source'),
    stage('locate-source', '定位原文', 'system', 'issue', automatic, 'generate-rewrite'),
    stage('generate-rewrite', '生成局部改写方案', 'expert', 'issue', confirm, 'hunk-review', ['editor', 'style-editor']),
    stage('hunk-review', '逐 hunk 接受或拒绝', 'author', 'issue', confirm, 'apply-checkpoint'),
    stage('apply-checkpoint', '正文落盘与 checkpoint', 'author', 'issue', confirm, 'targeted-verification'),
    stage(
      'targeted-verification',
      '针对性复检',
      'quality-gate',
      'issue',
      quality,
      'close-issue',
      [],
      false,
      [{ to: 'generate-rewrite', when: 'quality-failed' }],
    ),
    stage(
      'close-issue',
      '问题关闭',
      'system',
      'issue',
      automatic,
      'final-audit',
      [],
      false,
      [{ to: 'issue-triage', when: 'continue-loop' }],
    ),
    stage('final-audit', '最终全书复检', 'quality-gate', 'project', quality, undefined, [], false, [{ to: 'issue-triage', when: 'issues-found' }]),
  ],
};

export const BUILTIN_WORKFLOW_TEMPLATES = [NEW_BOOK_CREATION_TEMPLATE, LEGACY_BOOK_REVISION_TEMPLATE] as const;

export function getBuiltinWorkflowTemplate(kind: WorkflowTemplate['kind'], version = 1): WorkflowTemplate | undefined {
  return BUILTIN_WORKFLOW_TEMPLATES.find((item) => item.kind === kind && item.version === version);
}
