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

export function actorLabel(actor: string | undefined): string {
  switch (actor) {
    case 'author': return '作者';
    case 'expert': return '专家';
    case 'quality-gate': return '质量门';
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
      return count > 0 ? `质量门未通过：${count} 个问题待处理` : '质量门未通过';
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
