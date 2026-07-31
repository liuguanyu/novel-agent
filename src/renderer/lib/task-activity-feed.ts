import { WORKBENCH_GRAPH } from '../../core/shell/workbench-graph.js';
import type { BackendTaskActivityEvent, WorkflowSnapshotDto } from '../../shared/ipc/index.js';
import type { DashboardState } from '../hooks/useDashboard.js';
import type { ModelTaskAttemptView } from '../hooks/useModelTaskSessions.js';
import type { WorkbenchTraceStep } from '../hooks/useWorkbenchActivities.js';
import { WORKFLOW_TASK_GOAL } from '../components/WorkflowGraph.js';

export type TaskActivitySource = 'task' | 'workflow' | 'fact' | 'audit' | 'expert';

export interface TaskActivityFeedItem {
  readonly id: string;
  readonly source: TaskActivitySource;
  readonly label: string;
  readonly message: string;
  readonly tone: 'running' | 'waiting' | 'done' | 'error' | 'idle';
  readonly input?: string;
  readonly output?: string;
  readonly feedback?: string;
  readonly details?: ReadonlyArray<string>;
  /** 模型交互可审计记录（仅白名单字段，不含 hidden CoT）。 */
  readonly modelAudit?: {
    readonly goal: string;
    readonly agent: string;
    readonly tier: string;
    readonly inputSummary: string;
    readonly outputSummary: string;
    readonly adoption: 'adopted' | 'rejected' | 'pending';
    readonly contextRefs?: ReadonlyArray<string>;
    readonly constraints?: ReadonlyArray<string>;
    readonly toolResults?: ReadonlyArray<string>;
    readonly validation?: string;
    readonly structuredResult?: ReadonlyArray<string>;
  };
}

const STAGE_PLAYBOOK: Readonly<Record<string, {
  readonly purpose: string;
  readonly method: string;
  readonly inputHint: string;
  readonly outputHint: string;
  readonly feedbackHint: string;
}>> = {
  'locate-source': {
    purpose: '把已选择的诊断问题落回可修订的原文证据位置。',
    method: '当前实现主要消费诊断阶段保存的 issue 锚点和证据引文，在章节树/正文中做稳定定位；不会直接向模型询问。',
    inputHint: '已选择的问题、问题锚点、诊断证据 quote、章节树和当前正文。',
    outputHint: '目标章节、证据引文和正文高亮位置；若缺少锚点会阻塞。',
    feedbackHint: '定位完成后进入“生成局部改写方案”；若定位不到，需要回到诊断结果或重新选择问题。',
  },
  'generate-rewrite': {
    purpose: '基于定位到的原文和诊断问题生成局部改写方案。',
    method: '会进入专家/模型协作；实时日志展示专家节点和对话输出，不展示隐藏思维链。',
    inputHint: '目标原文片段、诊断问题、作者目标和当前章节上下文。',
    outputHint: '局部改写建议与可审阅 diff/hunk。',
    feedbackHint: '作者在后续 hunk 阶段逐处接受或拒绝。',
  },
  'hunk-review': {
    purpose: '让作者逐处确认改写是否进入正文。',
    method: '人工决策，不自动改正文。',
    inputHint: '改写方案、原文片段和 hunk 差异。',
    outputHint: '每个 hunk 的接受/拒绝决策。',
    feedbackHint: '确认后才能进入正文落盘与 checkpoint。',
  },
  'apply-checkpoint': {
    purpose: '把已接受的 hunk 安全写回正文并建立 checkpoint。',
    method: '本地正文写入与 checkpoint 记录。',
    inputHint: '已接受的 hunk、目标章节和当前正文版本。',
    outputHint: '更新后的正文和 checkpoint。',
    feedbackHint: '落盘后进行针对性复检。',
  },
};

const PHASE_LABEL: Readonly<Record<string, string>> = {
  map: '正在逐章提取问题线索',
  reduce: '正在核对跨章节关联',
  score: '正在汇总质量评分',
};

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function fieldCountLabel(value: unknown, singular: string): string | undefined {
  const count = asArray(value).length;
  return count > 0 ? `${count} ${singular}` : undefined;
}

function scopeLabel(scope: unknown): string {
  if (scope === null || typeof scope !== 'object') return '当前项目';
  const record = scope as Record<string, unknown>;
  const kind = String(record['kind'] ?? 'project');
  if (kind === 'issue') return `当前问题${typeof record['issueId'] === 'string' ? `（${record['issueId']}）` : ''}`;
  if (kind === 'chapter') return `当前章节${typeof record['chapterId'] === 'string' ? `（${record['chapterId']}）` : ''}`;
  return '整本书';
}

function shortJson(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function workflowItem(workflow: WorkflowSnapshotDto | null): TaskActivityFeedItem | undefined {
  if (workflow === null) return undefined;
  // 终态文案按任务类型区分：旧作沿用「书目整理」，新书用中性的「创作流程」，避免对新书任务泄露旧作语言。
  const flowLabel = workflow.kind === 'legacy-book-revision' ? '书目整理' : '创作流程';
  if (workflow.status === 'paused') return { id: 'workflow:paused', source: 'workflow', label: flowLabel, message: `${flowLabel}已暂停，可从上方恢复`, tone: 'waiting', feedback: '等待作者恢复' };
  if (workflow.status === 'completed') return { id: 'workflow:completed', source: 'workflow', label: flowLabel, message: `本次${flowLabel}已完成`, tone: 'done', output: '所有业务阶段已关闭' };
  if (workflow.status === 'cancelled') return { id: 'workflow:cancelled', source: 'workflow', label: flowLabel, message: `本次${flowLabel}已取消`, tone: 'idle', feedback: '不会继续推进后续阶段' };
  if (workflow.status === 'failed') return { id: 'workflow:failed', source: 'workflow', label: flowLabel, message: '运行失败，请查看工作流提示', tone: 'error', feedback: '需要重试或人工处理失败原因' };
  const stage = workflow.stages.find((item) => item['stageId'] === workflow.currentStageId);
  if (stage === undefined) return { id: 'workflow:sync', source: 'workflow', label: flowLabel, message: '正在同步当前任务', tone: 'running' };
  const templateStageId = typeof stage['templateStageId'] === 'string' ? stage['templateStageId'] : '';
  const goal = WORKFLOW_TASK_GOAL[templateStageId] ?? '完成当前任务';
  const status = typeof stage['status'] === 'string' ? stage['status'] : 'ready';
  const runCount = asArray(stage['runIds']).length;
  const artifactCount = asArray(stage['artifactRefs']).length;
  const evidenceCount = asArray(stage['completionEvidence']).length;
  const statusText = status === 'ready' ? '等待开始' : status === 'running' ? '正在进行' : status === 'awaiting-confirmation' ? '等待你确认' : status === 'blocked' ? '当前任务受阻' : status === 'failed' ? '当前任务失败' : '准备进入下一步';
  const tone = status === 'running' ? 'running' : status === 'failed' || status === 'blocked' ? 'error' : status === 'completed' || status === 'skipped' ? 'done' : 'waiting';
  const details = [
    fieldCountLabel(stage['runIds'], '次运行'),
    fieldCountLabel(stage['artifactRefs'], '个产物'),
    fieldCountLabel(stage['completionEvidence'], '条完成证据'),
  ].filter((item): item is string => item !== undefined);
  const feedback = status === 'awaiting-confirmation' ? '等待作者确认后进入下一步' : status === 'running' ? '后台正在执行，完成后会写入证据或产物' : status === 'ready' ? '点击上方按钮开始这项任务' : status === 'blocked' ? `阻塞原因：${shortJson(stage['blockingReason'])}` : undefined;
  const playbook = STAGE_PLAYBOOK[templateStageId];
  const mergedFeedback = playbook?.feedbackHint ?? feedback;
  return {
    id: `workflow:${String(stage['stageId'])}:${status}:${runCount}:${artifactCount}:${evidenceCount}`,
    source: 'workflow',
    label: '当前流程',
    message: `${statusText} · ${goal}`,
    tone,
    input: playbook === undefined ? `${scopeLabel(stage['scope'])}；目标：${workflow.objective}` : `${playbook.inputHint} 目标：${workflow.objective}`,
    output: artifactCount > 0 ? `已产生 ${artifactCount} 个阶段产物` : playbook?.outputHint ?? (status === 'ready' ? '尚未产生输出' : '输出生成中'),
    ...(mergedFeedback === undefined ? {} : { feedback: mergedFeedback }),
    details: [
      ...(playbook === undefined ? [] : [`这一步要解决：${playbook.purpose}`, `执行方式：${playbook.method}`]),
      ...details,
    ],
  };
}

function runtimeItems(events: ReadonlyArray<BackendTaskActivityEvent>): ReadonlyArray<TaskActivityFeedItem> {
  return events.map((event) => {
    if (event.type === 'task-run-completed') {
      return {
        id: `task:${event.taskRunId}:completed`, source: 'task' as const, label: event.title,
        message: event.summary, tone: 'done' as const, output: event.summary,
        feedback: '任务结果已保存，可继续下一步',
      };
    }
    if (event.type === 'task-run-failed') {
      return {
        id: `task:${event.taskRunId}:failed:${event.failedAt}`, source: 'task' as const, label: event.title,
        message: event.error.message, tone: 'error' as const,
        ...(event.error.recovery === undefined ? {} : { feedback: event.error.recovery }),
      };
    }
    return {
      id: `task:${event.taskRunId}:${event.activityId}`, source: 'task' as const, label: event.title,
      message: event.message,
      tone: event.status === 'awaiting-author' ? 'waiting' as const : event.status === 'paused' ? 'waiting' as const : event.phase === 'failed' || event.status === 'failed' ? 'error' as const : event.status === 'cancelled' ? 'idle' as const : event.phase === 'completed' ? 'done' as const : 'running' as const,
      ...(event.inputSummary === undefined ? {} : { input: event.inputSummary }),
      ...(event.outputSummary === undefined ? {} : { output: event.outputSummary }),
      ...(event.feedback === undefined && event.nextAction === undefined
        ? {}
        : { feedback: [event.feedback, event.nextAction].filter((item): item is string => item !== undefined).join('；') }),
      ...(event.evidenceRefs === undefined ? {} : { details: event.evidenceRefs.map((item) => `${item.label}：${item.ref}`) }),
      ...(event.modelAudit === undefined ? {} : {
        modelAudit: {
          goal: event.modelAudit.goal,
          agent: event.modelAudit.agent,
          tier: event.modelAudit.tier,
          inputSummary: event.modelAudit.inputSummary,
          outputSummary: event.modelAudit.outputSummary,
          adoption: event.modelAudit.adoption,
          ...(event.modelAudit.contextRefs === undefined ? {} : { contextRefs: event.modelAudit.contextRefs }),
          ...(event.modelAudit.constraints === undefined ? {} : { constraints: event.modelAudit.constraints }),
          ...(event.modelAudit.toolResults === undefined ? {} : { toolResults: event.modelAudit.toolResults }),
          ...(event.modelAudit.validation === undefined ? {} : { validation: event.modelAudit.validation }),
          ...(event.modelAudit.structuredResult === undefined ? {} : {
            structuredResult: Object.entries(event.modelAudit.structuredResult).map(([key, value]) => `${key}: ${String(value)}`),
          }),
        },
      }),
    };
  });
}

function factItems(attempt: ModelTaskAttemptView | undefined, chapterLabel: string | undefined): ReadonlyArray<TaskActivityFeedItem> {
  if (attempt === undefined) return [];
  const where = chapterLabel === undefined ? '' : `「${chapterLabel}」 · `;
  return attempt.activities.map((activity) => {
    const metadata = activity.metadata ?? {};
    const metadataText = Object.entries(metadata).map(([key, value]) => `${key}: ${String(value)}`);
    const conflictCount = activity.conflicts?.length ?? 0;
    const feedback = activity.phase === 'conflict' ? '需要作者在事实底稿中结构化裁决，才会写入事实库' : attempt.status === 'running' ? '活动由 Main 实时推送，Renderer 只展示结果' : undefined;
    const details = activity.conflicts?.map((conflict) => `候选：${conflict.candidateSummary}；已有：${conflict.existingSummary}`);
    return {
      id: `fact:${attempt.attemptId}:${activity.activityId}`,
      source: 'fact' as const,
      label: '事实核对',
      message: `${where}${activity.phase === 'reading' && chapterLabel !== undefined ? '正在读取章节正文' : activity.message}`,
      tone: activity.phase === 'failed' ? 'error' as const : activity.phase === 'completed' ? 'done' as const : activity.phase === 'conflict' ? 'waiting' as const : 'running' as const,
      input: `${chapterLabel ?? attempt.chapterId ?? '当前章节'}；任务 ${attempt.taskId} / 尝试 ${attempt.attemptId}`,
      output: conflictCount > 0 ? `发现 ${conflictCount} 条冲突候选` : metadataText.length > 0 ? metadataText.join('；') : '等待模型返回结构化结果',
      ...(feedback === undefined ? {} : { feedback }),
      ...(details === undefined ? {} : { details }),
    };
  });
}

function expertItems(trace: ReadonlyArray<WorkbenchTraceStep>): ReadonlyArray<TaskActivityFeedItem> {
  return trace.map((step) => {
    const label = WORKBENCH_GRAPH.nodes.find((node) => node.id === step.node)?.label ?? '专家';
    return {
      id: `expert:${step.id}:${step.phase}`,
      source: 'expert' as const,
      label: '专家协作',
      message: `${label}${step.phase === 'running' ? '正在整理意见' : step.phase === 'done' ? '已完成本轮工作' : step.phase === 'awaiting' ? '等待你的裁决' : '运行遇到问题'}`,
      tone: step.phase === 'running' ? 'running' as const : step.phase === 'done' ? 'done' as const : step.phase === 'error' ? 'error' as const : 'waiting' as const,
      input: '当前对话目标、选中章节和 @专家 指令',
      output: step.phase === 'done' ? '意见已进入右侧专家对话' : '回复生成中',
      feedback: step.phase === 'awaiting' ? '等待作者处理冲突或继续追问' : '可在右侧对话继续追问或切换专家',
    };
  });
}

function auditItem(state: DashboardState): TaskActivityFeedItem | undefined {
  if (state.status === 'idle') return undefined;
  if (state.status === 'failed') return { id: `audit:${String(state.runId)}:failed`, source: 'audit', label: '全书诊断', message: state.error ?? '诊断失败', tone: 'error', input: `事实版本 ${state.factVersion ?? '未知'}`, feedback: '可重试全书诊断' };
  if (state.status === 'aborted') return { id: `audit:${String(state.runId)}:aborted`, source: 'audit', label: '全书诊断', message: '诊断已中断', tone: 'idle', input: `事实版本 ${state.factVersion ?? '未知'}` };
  if (state.status === 'completed') return { id: `audit:${String(state.runId)}:completed`, source: 'audit', label: '全书诊断', message: '诊断完成，可查看诊断结果', tone: 'done', input: `事实版本 ${state.factVersion ?? '未知'}`, output: state.dashboard === undefined ? '诊断结果已生成' : `健康分 ${state.dashboard.healthScore}；问题 ${state.dashboard.issues.length} 条`, feedback: '打开诊断结果查看红黄牌与章节锚点' };
  const phase = PHASE_LABEL[state.phase ?? ''] ?? '正在准备诊断';
  const progress = state.totalItems > 0 ? ` · ${state.completedItems}/${state.totalItems}` : '';
  return { id: `audit:${String(state.runId)}:${state.phase ?? 'prepare'}:${state.completedItems}`, source: 'audit', label: '全书诊断', message: `${phase}${progress}`, tone: 'running', input: `事实版本 ${state.factVersion ?? '未知'}；全书范围`, output: `已处理 ${state.completedItems}/${state.totalItems} 项`, feedback: '完成后进入诊断结果面板' };
}

export function buildTaskActivityFeed(input: {
  readonly workflow: WorkflowSnapshotDto | null;
  readonly modelTask: ModelTaskAttemptView | undefined;
  readonly modelTaskChapterLabel: string | undefined;
  readonly dashboard: DashboardState;
  readonly trace: ReadonlyArray<WorkbenchTraceStep>;
  readonly taskEvents: ReadonlyArray<BackendTaskActivityEvent>;
}): ReadonlyArray<TaskActivityFeedItem> {
  const items: TaskActivityFeedItem[] = [...runtimeItems(input.taskEvents)];
  const hasCurrentRuntimeTask = input.taskEvents.some((event) => event.status === 'running' || event.status === 'awaiting-author' || event.status === 'paused');
  const workflow = hasCurrentRuntimeTask ? undefined : workflowItem(input.workflow);
  if (workflow !== undefined) items.push(workflow);
  items.push(...expertItems(input.trace));
  const audit = auditItem(input.dashboard);
  if (audit !== undefined) items.push(audit);
  items.push(...factItems(input.modelTask, input.modelTaskChapterLabel));
  return items.length === 0
    ? [{ id: 'idle', source: 'workflow', label: '实时任务', message: '后台空闲', tone: 'idle', feedback: '暂无工作流或后台任务' }]
    : items;
}
