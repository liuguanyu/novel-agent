/**
 * 专家工作台视图契约（纯投影层，无 React/DOM/IPC）：
 * 把 Main 下发的 WorkflowSnapshotDto / 活动态 Map 投影为可展示的视图模型与折叠摘要。
 * 本层只做只读展示映射，绝不推进工作流状态；被 ExpertWorkbench 组件与 node 侧冲烟共同复用。
 */

import { getBuiltinWorkflowTemplate } from '../../core/workflow/templates.js';
import type { WorkflowKind } from '../../core/workflow/types.js';
import type { WorkflowSnapshotDto } from '../../shared/ipc/index.js';
import { WORKBENCH_GRAPH, type WorkbenchActivities } from '../../core/shell/workbench-graph.js';

export function nodeLabel(id: string): string {
  return WORKBENCH_GRAPH.nodes.find((node) => node.id === id)?.label ?? id;
}

// 工作流 kind 人话化：绝不把内部标识符当主文案（§7.2 红线 / §17）。
export function workflowKindLabel(kind: string): string {
  switch (kind) {
    case 'legacy-book-revision': return '老书重建';
    case 'new-book-creation': return '新书创作';
    default: return '创作任务';
  }
}

// 资产影响状态人话化：none 不展示（避免「影响：none」这类术语）。
export function impactStatusLabel(status: string | undefined): string | undefined {
  switch (status) {
    case undefined:
    case '':
    case 'none': return undefined;
    case 'pending': return '待评估';
    case 'stale': return '可能过时';
    case 'needs-review': return '需复核';
    case 'conflicting': return '版本冲突';
    case 'resolved': return '已处理';
    default: return status;
  }
}

export function stageStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'ready': return '待开始';
    case 'running': return '进行中';
    case 'awaiting-confirmation': return '待确认';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'blocked': return '已阻塞';
    case 'skipped': return '已跳过';
    default: return status ?? '待开始';
  }
}

/** 当前任务卡以 workflow stage 为权威；旧 task 事件只在阶段本身 running 时细化暂停/取消等运行态。 */
export function currentTaskStatus(stageStatus: string | undefined, latestTaskStatus: string | undefined): string {
  if (stageStatus !== 'running') return stageStatus ?? 'ready';
  return latestTaskStatus ?? stageStatus;
}

/** 进入定位原文阶段时，左栏应主动展示问题，而不是继续停留在章节。 */
export function preferredNavContext(templateStageId: string | undefined): 'chapters' | 'issues' | undefined {
  return templateStageId === 'locate-source' ? 'issues' : undefined;
}

export interface LocateSourceActionView {
  readonly label: string;
  readonly title: string;
  readonly intent: 'locate' | 'select-issue';
}

/** 未选问题时按钮仍是可操作引导，点击切到问题列表；选中后才真正发起定位。 */
export function locateSourceActionView(hasSelectedIssue: boolean): LocateSourceActionView {
  return hasSelectedIssue
    ? { label: '定位原文', title: '读取诊断证据并定位正文', intent: 'locate' }
    : { label: '选择问题后定位', title: '打开左侧问题列表，选择要定位的诊断问题', intent: 'select-issue' };
}

/** 已完成的事实阶段查看持久事实库；未完成阶段查看当前核对任务。 */
export function factStageDestination(status: string): 'story-bible' | 'fact-task' {
  return status === 'completed' || status === 'skipped' ? 'story-bible' : 'fact-task';
}

export interface LegacyStageGuide {
  readonly start: string;
  readonly completion: string;
  readonly artifact: string;
  readonly humanRole: string;
  readonly factImpact: string;
  readonly manuscriptImpact: string;
  readonly loop?: string;
}

const LEGACY_STAGE_GUIDES: Readonly<Record<string, LegacyStageGuide>> = {
  'import-book': {
    start: '已导入既有章节，可以说明本次要保留、提取和修复的目标。',
    completion: '作者确认目标与具体要求。',
    artifact: '工作流目标与作者要求清单。',
    humanRole: '补充或修改整理目标，确认后进入事实回填。',
    factImpact: '不修改事实库。',
    manuscriptImpact: '不修改原文。',
  },
  'fact-backfill': {
    start: '目标已确认，正文存在可读取章节。',
    completion: '所有章节完成事实抽取；冲突已经作者裁决；形成事实版本。',
    artifact: '全书事实版本、人物/事件/关系/伏笔及出处。',
    humanRole: '仅在事实冲突或低置信内容出现时介入确认。',
    factImpact: '新增或更新事实库；后续诊断以新版本为基线。',
    manuscriptImpact: '不修改原文。',
  },
  'initial-audit': {
    start: '全书事实底稿已有可用版本。',
    completion: '全书诊断运行结束，问题已形成结构化记录；无问题则直接进入最终复检。',
    artifact: '健康分、诊断报告、带证据和章节锚点的问题列表。',
    humanRole: '查看诊断依据；本步不要求逐条修改。',
    factImpact: '只读取事实库。',
    manuscriptImpact: '不修改原文。',
  },
  'issue-triage': {
    start: '诊断结束，并存在需要分类或排序的问题。',
    completion: '作者选定下一项要处理的问题并确认优先级。',
    artifact: '问题队列、生命周期状态和当前选中问题。',
    humanRole: '筛选、排序、忽略或选择一个问题进入修复。',
    factImpact: '不直接修改事实库。',
    manuscriptImpact: '不修改原文。',
    loop: '每处理完一个问题可回到这里选择下一项；最终复检发现新问题也会回到这里。',
  },
  'locate-source': {
    start: '已选择问题，且问题带稳定章节证据或可供选择的候选位置。',
    completion: '作者或系统确定唯一正文片段；无法稳定定位时阻塞，禁止写入。',
    artifact: '章节 ID、原文引用和稳定锚点。',
    humanRole: '多候选时明确选择位置；无锚点时补充证据。',
    factImpact: '只读取诊断与事实证据。',
    manuscriptImpact: '只定位和高亮，不修改原文。',
  },
  'generate-rewrite': {
    start: '当前问题已有唯一、稳定的原文片段。',
    completion: '专家生成局部改写建议，作者确认建议可进入差异审阅。',
    artifact: '局部改写候选，不是已落盘正文。',
    humanRole: '可调整改写要求或编辑候选文本，再确认。',
    factImpact: '只读取事实约束。',
    manuscriptImpact: '不修改原文。',
    loop: '针对性复检失败时回到本步重新生成方案。',
  },
  'hunk-review': {
    start: '原片段与改写候选已计算出最小差异。',
    completion: '每一处改动都被接受或拒绝，作者确认审阅结果。',
    artifact: '逐处审阅结果与最终待写入文本。',
    humanRole: '逐处接受或拒绝；未接受内容不会进入正文。',
    factImpact: '不修改事实库。',
    manuscriptImpact: '审阅期间不落盘。',
  },
  'apply-checkpoint': {
    start: '所有改动均已审阅，原文位置仍有效且正文版本未冲突。',
    completion: '仅将作者接受的改动精确写入正文，并创建可回滚版本。',
    artifact: '新正文与可回滚版本。',
    humanRole: '执行最终落盘确认；版本或锚点变化时重新审阅。',
    factImpact: '事实库不会自动随正文改写，后续复检负责发现不一致。',
    manuscriptImpact: '这是修复循环中唯一真正修改原文的动作。',
  },
  'targeted-verification': {
    start: '正文已写入并留有可回滚版本。',
    completion: '复检确认当前问题已修复；失败则返回重新改写。',
    artifact: '针对性复检报告和问题生命周期更新。',
    humanRole: '查看复检证据；失败时决定如何调整方案。',
    factImpact: '读取事实基线；不直接维护事实库。',
    manuscriptImpact: '不再写正文，只校验刚才的改动。',
    loop: '复检失败会返回“改写”，不会关闭当前问题。',
  },
  'close-issue': {
    start: '针对性复检通过。',
    completion: '当前问题标记为已解决，并决定继续下一问题或进入最终复检。',
    artifact: '问题关闭记录、修复与复检证据链。',
    humanRole: '通常无需编辑；仍有待办时回到问题队列。',
    factImpact: '不修改事实库。',
    manuscriptImpact: '不修改原文。',
    loop: '仍有问题时回到“选问题”，继续处理下一项。',
  },
  'final-audit': {
    start: '计划处理的问题均已关闭，正文处于最新可回滚版本。',
    completion: '全书复检通过并由作者确认；发现问题则回到问题队列。',
    artifact: '最终健康分、复检报告和新增问题（如有）。',
    humanRole: '确认交付结果，或选择继续处理新发现的问题。',
    factImpact: '只读取当前事实基线；若正文已改变，可能提示事实需重新抽取。',
    manuscriptImpact: '不修改原文。',
    loop: '发现新问题会回到“选问题”；通过并确认后整理才结束。',
  },
};

export function legacyStageGuide(stageId: string): LegacyStageGuide | undefined {
  return LEGACY_STAGE_GUIDES[stageId];
}

/* ── 作者视角阶段投影：11 个机器步骤折叠为 4 个作者阶段 ────────────────
 * 作者只需感知「建立底稿 → 全书诊断 → 修复问题（按问题循环）→ 最终复检」。
 * 内部 11 步仍由状态机驱动；这里只负责展示投影，不改变推进语义。 */

export type LegacyPhaseId = 'foundation' | 'diagnosis' | 'repair' | 'delivery';

export interface LegacyPhaseDefinition {
  readonly id: LegacyPhaseId;
  readonly label: string;
  /** 一句话说明这个阶段在帮作者做什么。 */
  readonly goal: string;
  readonly stageIds: ReadonlyArray<string>;
}

export const LEGACY_PHASES: ReadonlyArray<LegacyPhaseDefinition> = [
  {
    id: 'foundation', label: '建立底稿',
    goal: '确认整理目标，并让系统先读懂全书，形成事实底稿。',
    stageIds: ['import-book', 'fact-backfill'],
  },
  {
    id: 'diagnosis', label: '全书诊断',
    goal: '对照事实底稿做全身体检，产出带证据的问题清单。',
    stageIds: ['initial-audit'],
  },
  {
    id: 'repair', label: '修复问题',
    goal: '一次只处理一个问题：定位原文、生成改写、逐处审阅后再落盘复检。',
    stageIds: ['issue-triage', 'locate-source', 'generate-rewrite', 'hunk-review', 'apply-checkpoint', 'targeted-verification', 'close-issue'],
  },
  {
    id: 'delivery', label: '最终复检',
    goal: '对修订后的全书做最终体检；发现新问题会再回到修复环节。',
    stageIds: ['final-audit'],
  },
];

/** 机器阶段 → 作者阶段；未知阶段返回 undefined（调用方回退到旧视图）。 */
export function legacyPhaseOfStage(templateStageId: string): LegacyPhaseDefinition | undefined {
  return LEGACY_PHASES.find((phase) => phase.stageIds.includes(templateStageId));
}

export interface RepairStepDefinition {
  readonly id: string;
  readonly label: string;
  readonly templateStageId: string;
}

/** 修复循环内的微步骤顺序（一次处理一个问题的完整路径）。 */
export const LEGACY_REPAIR_STEPS: ReadonlyArray<RepairStepDefinition> = [
  { id: 'pick', label: '选问题', templateStageId: 'issue-triage' },
  { id: 'locate', label: '定位', templateStageId: 'locate-source' },
  { id: 'rewrite', label: '改写', templateStageId: 'generate-rewrite' },
  { id: 'review', label: '审阅', templateStageId: 'hunk-review' },
  { id: 'apply', label: '落盘', templateStageId: 'apply-checkpoint' },
  { id: 'verify', label: '复检', templateStageId: 'targeted-verification' },
  { id: 'close', label: '关闭', templateStageId: 'close-issue' },
];

export function repairStepOfStage(templateStageId: string): RepairStepDefinition | undefined {
  return LEGACY_REPAIR_STEPS.find((step) => step.templateStageId === templateStageId);
}

export type LegacyPhaseStatus = 'done' | 'current' | 'pending';

export interface LegacyPhaseView {
  readonly definition: LegacyPhaseDefinition;
  readonly status: LegacyPhaseStatus;
  /** 当前阶段内作者正在处理的机器步骤中文名（仅 current 阶段有值）。 */
  readonly currentStageLabel: string | undefined;
}

/**
 * 由当前机器阶段推导 4 个作者阶段的状态。阶段在前的视为已完成；
 * 循环回退（终检发现问题回到修复）时后续阶段自然回到 pending——作者看到的始终是真实位置。
 */
export function buildLegacyPhaseView(
  currentTemplateStageId: string | undefined,
  workflowCompleted: boolean,
  currentStageLabel?: string,
): ReadonlyArray<LegacyPhaseView> {
  if (workflowCompleted || currentTemplateStageId === undefined) {
    return LEGACY_PHASES.map((definition) => ({ definition, status: workflowCompleted ? 'done' as const : 'pending' as const, currentStageLabel: undefined }));
  }
  const currentIndex = LEGACY_PHASES.findIndex((phase) => phase.stageIds.includes(currentTemplateStageId));
  return LEGACY_PHASES.map((definition, index) => ({
    definition,
    status: currentIndex < 0 ? 'pending' : index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending',
    currentStageLabel: index === currentIndex ? currentStageLabel : undefined,
  }));
}

export interface LegacyIssueProgress {
  readonly current: number;
  readonly total: number;
}

/** 修复阶段的头部一句话：正在处理第几个问题、进行到哪一微步。 */
export function repairLoopHeadline(currentTemplateStageId: string, progress?: LegacyIssueProgress): string {
  const step = repairStepOfStage(currentTemplateStageId);
  const issuePart = progress === undefined ? '' : ` · 第 ${progress.current}/${progress.total} 个问题`;
  if (step === undefined) return issuePart.slice(3);
  const stepIndex = LEGACY_REPAIR_STEPS.indexOf(step);
  return `${step.label}（${stepIndex + 1}/${LEGACY_REPAIR_STEPS.length}）${issuePart}`;
}

export function actorLabel(actor: string | undefined): string {
  switch (actor) {
    case 'author': return '作者';
    case 'expert': return '专家';
    case 'quality-gate': return '复检';
    case 'system': return '系统';
    default: return actor ?? '未分配';
  }
}

/** 把 Main 快照里的结构化 blockingReason 人话化；未知形态返回 undefined 而非展示内部对象。 */
export function stageBlockingLabel(reason: unknown): string | undefined {
  if (reason === null || typeof reason !== 'object' || Array.isArray(reason)) return undefined;
  const record = reason as Record<string, unknown>;
  const message = typeof record['message'] === 'string' ? record['message'] : undefined;
  switch (record['kind']) {
    case 'conflict': return '存在未解决的内容冲突';
    case 'missing-anchor': return '问题缺少可定位的正文锚点';
    case 'failed-run': return message === undefined ? '任务运行失败' : `任务运行失败：${message}`;
    case 'interrupted-run': return message === undefined ? '任务被中断，可恢复后继续' : `任务被中断：${message}`;
    case 'asset-impact': return '资产变更影响待处理';
    case 'quality-gate': {
      const issueIds = record['issueIds'];
      const count = Array.isArray(issueIds) ? issueIds.length : 0;
      return count > 0 ? `复检未通过：${count} 个问题待处理` : '复检未通过';
    }
    case 'version-conflict': return '数据版本冲突，请刷新后重试';
    default: return undefined;
  }
}

export interface WorkflowStageView {
  readonly id: string;
  readonly name: string;
  readonly actor: string | undefined;
  readonly status: string | undefined;
  readonly impactStatus: string | undefined;
  readonly nextStep: string | undefined;
  readonly blocking: string | undefined;
  readonly allowedActions: ReadonlyArray<string>;
  /** 阶段累计挂过的 run；上层历史不因新 run 清空（§9.4）。 */
  readonly runIds: ReadonlyArray<string>;
}

export function workflowStageView(stage: Record<string, unknown>): WorkflowStageView {
  const text = (key: string): string | undefined => typeof stage[key] === 'string' ? stage[key] as string : undefined;
  const actions = stage['allowedActions'];
  const runIds = stage['runIds'];
  return {
    id: text('stageId') ?? text('id') ?? 'stage',
    name: text('name') ?? text('label') ?? text('stageId') ?? '阶段',
    actor: text('actor'),
    status: text('status'),
    impactStatus: text('impactStatus'),
    nextStep: text('nextStep') ?? text('next'),
    blocking: text('blocking') ?? text('blockedBy') ?? stageBlockingLabel(stage['blockingReason']),
    allowedActions: Array.isArray(actions) ? actions.filter((x): x is string => typeof x === 'string') : [],
    runIds: Array.isArray(runIds) ? runIds.filter((x): x is string => typeof x === 'string') : [],
  };
}

export interface WorkbenchWorkflowView {
  readonly stages: ReadonlyArray<WorkflowStageView>;
  readonly current: WorkflowStageView | undefined;
  readonly completedCount: number;
}

/** 由快照 + 内置模板组装上层阶段视图：中文 label、下一步阶段名与进度计数（含章节/issue 循环实例）。 */
export function buildWorkflowView(workflow: WorkflowSnapshotDto): WorkbenchWorkflowView {
  const template = getBuiltinWorkflowTemplate(workflow.kind as WorkflowKind, Number(workflow.templateVersion));
  const stages = workflow.stages.map((rawStage) => {
    const stage = workflowStageView(rawStage);
    const definition = template?.stages.find((item) => item.id === rawStage['templateStageId']);
    if (definition === undefined) return stage;
    // 下一步显示目标阶段的中文 label，而非阶段 ID。
    const nextId = definition.transitions[0]?.to;
    const nextStep = nextId === undefined ? undefined : (template?.stages.find((item) => item.id === nextId)?.label ?? nextId);
    return { ...stage, name: definition.label, nextStep };
  });
  const current = stages.find((stage) => stage.id === workflow.currentStageId);
  const completedCount = stages.filter((stage) => stage.status === 'completed' || stage.status === 'skipped').length;
  return { stages, current, completedCount };
}

/** 折叠摘要：工作流 + 当前阶段 + 下一步/阻塞（暂停时明示），另附待审计数（候选 + 影响）。 */
export function buildWorkflowCollapsedSummary(
  workflow: Pick<WorkflowSnapshotDto, 'kind' | 'status'>,
  current: WorkflowStageView | undefined,
  pendingReviewCount: number,
): string {
  const head = `${workflowKindLabel(workflow.kind)} · ${current?.name ?? '等待阶段'}`;
  const pending = pendingReviewCount > 0 ? ` · 待审 ${pendingReviewCount}` : '';
  if (workflow.status === 'paused') return `${head} · 已暂停${pending}`;
  const progress = current?.blocking !== undefined ? `阻塞：${current.blocking}` : `下一步：${current?.nextStep ?? '等待推进'}`;
  return `${head} · ${progress}${pending}`;
}

export function activitySummary(activities: WorkbenchActivities): string | undefined {
  let running: string | undefined;
  for (const [node, activity] of activities) {
    if (activity.phase === 'awaiting') return `${nodeLabel(node)}待裁决`;
    if (activity.phase === 'running') running = `${nodeLabel(node)}运行中`;
  }
  return running;
}

/** 与 hooks 里的 WorkbenchTraceObservation 结构兼容；纯层不引入 React 文件。 */
export interface WorkbenchObservationLike {
  readonly count: number;
  readonly node: string;
  readonly phase: 'enter' | 'exit';
}

/** standalone（无 workflow）时折叠摘要的最终回退。 */
export function observationSummary(observation: WorkbenchObservationLike | undefined): string {
  return observation === undefined
    ? '等待工作任务'
    : `轨迹 ${observation.count} · ${nodeLabel(observation.node)}${observation.phase === 'enter' ? '进入' : '完成'}`;
}

/** 产品外壳单一判别三模式（task 10.7）：互斥全屏面，切换不中断后台。 */
export type AppViewMode = 'workbench' | 'reading' | 'conversation';

/**
 * 模式→可见面矩阵（task 10.7/10.10）：App 外壳与冲烟同源复用，保证三模式互斥不漂移。
 * 注意：workbenchBodyVisible=false 时工作台主体只隐藏不卸载（保留滚动/高亮/订阅）；
 * findingConnector 为全屏工作台专属，其余模式卸载以停止坐标计算。
 */
export interface ViewModeSurfaces {
  /** 顶部产品栏（书目面包屑 + 模式入口）仅 workbench。 */
  readonly header: boolean;
  /** 全屏读书视图。 */
  readonly readingSurface: boolean;
  /** 全屏专注对话视图。 */
  readonly conversationSurface: boolean;
  /** 工作台主体可见；不可见时仅隐藏不卸载。 */
  readonly workbenchBodyVisible: boolean;
  /** 对话轴留在三栏面板；conversation 模式移入全屏对话且不重复挂载。 */
  readonly dialogueAxisInPanel: boolean;
  /** Hero 连线仅全屏工作台挂载（task 10.10）。 */
  readonly findingConnector: boolean;
}

export function resolveViewModeSurfaces(mode: AppViewMode): ViewModeSurfaces {
  return {
    header: mode === 'workbench',
    readingSurface: mode === 'reading',
    conversationSurface: mode === 'conversation',
    workbenchBodyVisible: mode === 'workbench',
    dialogueAxisInPanel: mode !== 'conversation',
    findingConnector: mode === 'workbench',
  };
}

/**
 * 读书模式右下角极简后台徽标（task 10.8）：裁决事项优先于常规忙碌；
 * attention 只是可点击提示，绝不自动把作者踢回工作台。
 */
export function readingBackgroundBadge(
  busy: boolean,
  needsAttention: boolean,
): 'attention' | 'busy' | 'none' {
  if (needsAttention) return 'attention';
  return busy ? 'busy' : 'none';
}
