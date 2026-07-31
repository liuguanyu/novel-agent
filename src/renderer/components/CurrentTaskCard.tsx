import { CircleAlert, CircleX, Loader2, Pause, Play, Route, Target, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BackendTaskActivityEvent, WorkflowSnapshotDto } from '../../shared/ipc/index.js';
import { WORKFLOW_TASK_GOAL } from './WorkflowGraph.js';

interface CurrentTaskCardProps {
  readonly workflow: WorkflowSnapshotDto | null;
  readonly events: ReadonlyArray<BackendTaskActivityEvent>;
  readonly onOpenTaskCenter: () => void;
  readonly onChooseSourceLocation: (taskRunId: string, candidateId: string) => void;
  readonly onControlTask: (taskRunId: string, action: 'pause' | 'resume' | 'cancel') => void;
  readonly onEnterRefactor: (params: { readonly chapterId: string; readonly quote: string; readonly issueId?: string }) => void;
}

const TASK_DETAILS: Readonly<Record<string, {
  readonly purpose: string;
  readonly inputs: string;
  readonly execution: string;
  readonly output: string;
}>> = {
  'locate-source': {
    purpose: '把诊断问题落到可安全修订的具体章节和段落。',
    inputs: '诊断问题、证据引文、章节锚点和当前正文',
    execution: '读取诊断证据 → 查找目标章节 → 匹配引文 → 验证上下文',
    output: '目标章节、原文高亮和下一步局部改写入口',
  },
  'generate-rewrite': {
    purpose: '围绕已定位的问题生成可审阅的局部改写方案。',
    inputs: '目标原文、诊断问题、作者目标和章节上下文',
    execution: '整理约束 → 调用改写助手 → 验证事实 → 生成差异',
    output: '局部改写建议与可逐处审核的差异',
  },
  'fact-backfill': {
    purpose: '在修改正文前建立可追溯的全书事实底稿。',
    inputs: '全书章节正文和作者整理目标',
    execution: '逐章读取 → 模型抽取 → 规则校验 → 入库或等待裁决',
    output: '人物、事件、关系、时间线和伏笔事实',
  },
  // 新书创作模板阶段（与旧作共用同一任务卡，不复制工作台）。
  concept: {
    purpose: '确立作品的核心命题、类型定位与目标读者。',
    inputs: '初始构想和可选的类型、基调、读者偏好',
    execution: '探索立意角度 → 差异化定位 → 等待作者确认',
    output: '经作者确认的作品立意与定位',
  },
  worldbuilding: {
    purpose: '在立意之上构建世界规则与设定基线。',
    inputs: '已确认立意和可选的题材约束与参考',
    execution: '起草世界设定 → 梳理规则与势力 → 等待作者确认',
    output: '经作者确认的世界观设定基线',
  },
  'character-design': {
    purpose: '从立意与世界观出发设计互补的人物阵容。',
    inputs: '作品立意、世界观设定和人物关系偏好',
    execution: '起草人物阵容 → 作者取舍 → 产出人物档案',
    output: '经作者确认的结构化人物档案',
  },
  'book-outline': {
    purpose: '整合立意、世界观与人物规划全书故事线。',
    inputs: '立意、人物档案和世界观设定',
    execution: '起草主支线与转折 → 等待作者确认大纲',
    output: '经作者确认的全书故事线结构',
  },
  'chapter-plan': {
    purpose: '把全书大纲拆解为卷章结构与每章目标。',
    inputs: '全书大纲和可选的本次规划范围',
    execution: '起草卷章结构 → 等待作者确认章节',
    output: '经作者确认的卷章结构与每章目标',
  },
  'scene-outline': {
    purpose: '把单章目标拆解为分场节拍。',
    inputs: '目标章节规划和人物档案',
    execution: '起草分场节拍 → 等待作者确认分场',
    output: '经作者确认的分场大纲',
  },
  'draft-writing': {
    purpose: '基于分场大纲写出本章初稿供作者审阅。',
    inputs: '分场大纲、人物档案和世界观设定',
    execution: '撰写章节初稿 → 等待作者确认或提修订',
    output: '经作者确认的章节初稿',
  },
  'author-review': {
    purpose: '接收作者修订意见并产出修订稿。',
    inputs: '章节初稿和作者修订意见',
    execution: '整理修订方案 → 作者取舍 → 产出修订稿',
    output: '经作者确认的章节修订稿',
  },
  'automatic-review': {
    purpose: '对章节稿做上下文与设定一致性检查。',
    inputs: '待检查章节稿和事实底稿',
    execution: '扫描一致性问题 → 等待作者裁决',
    output: '经作者裁决的连贯性报告',
  },
  'fact-extraction': {
    purpose: '从定稿章节抽取新事实并更新事实底稿。',
    inputs: '定稿章节和既有事实底稿',
    execution: '抽取新事实 → 作者裁决冲突 → 合并底稿',
    output: '经作者裁决合并的事实底稿新版本',
  },
};

export function CurrentTaskCard({ workflow, events, onOpenTaskCenter, onChooseSourceLocation, onControlTask, onEnterRefactor }: CurrentTaskCardProps): JSX.Element | null {
  if (workflow === null) return null;
  const stage = workflow.stages.find((item) => item['stageId'] === workflow.currentStageId);
  if (stage === undefined) return null;
  const templateStageId = String(stage['templateStageId'] ?? '');
  const goal = WORKFLOW_TASK_GOAL[templateStageId] ?? '完成当前创作任务';
  const details = TASK_DETAILS[templateStageId] ?? {
    purpose: goal,
    inputs: '当前创作目标、工作流上下文和已有产物',
    execution: '读取上下文 → 执行当前任务 → 验证结果',
    output: '当前阶段产物和下一步建议',
  };
  let latest: BackendTaskActivityEvent | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.workflowRef?.workflowId === workflow.workflowId && event.workflowRef.stageId === workflow.currentStageId) {
      latest = event;
      break;
    }
  }
  const status = latest?.status ?? String(stage['status'] ?? 'ready');
  const running = status === 'running';
  const waiting = status === 'awaiting-author';
  const paused = status === 'paused';
  const failed = status === 'failed';
  const cancelled = status === 'cancelled';

  // 4.3 定位完成后的「进入局部改写」下一步入口：从最近完成的 locate-source run 取章节/问题/证据引文。
  let locatedSource: { readonly chapterId: string; readonly quote: string; readonly issueId?: string } | undefined;
  if (templateStageId === 'generate-rewrite') {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== 'task-run-completed' || event.kind !== 'locate-source') continue;
      if (event.workflowRef?.workflowId !== workflow.workflowId) continue;
      const chapterId = event.chapterId;
      if (chapterId === undefined) continue;
      // 引文文本不进 completed 产物（避免整章正文外泄），从同一 run 的高亮 UI Effect 取已验证片段。
      let quote: string | undefined;
      for (let j = events.length - 1; j >= 0; j -= 1) {
        const activity = events[j];
        if (activity?.type !== 'task-activity' || activity.taskRunId !== event.taskRunId) continue;
        const highlight = activity.uiEffects?.find((effect) => effect.kind === 'highlight-quote');
        if (highlight !== undefined && highlight.kind === 'highlight-quote') { quote = highlight.quote; break; }
      }
      if (quote === undefined || quote.length === 0) continue;
      locatedSource = { chapterId, quote, ...(event.issueId === undefined ? {} : { issueId: event.issueId }) };
      break;
    }
  }
  const statusLabel = failed ? '执行失败' : cancelled ? '已取消' : paused ? '已暂停' : waiting ? '等待作者' : running ? '执行中' : status === 'completed' ? '已完成' : '待开始';
  const statusIcon = failed || cancelled ? <CircleX className="size-3.5" aria-hidden /> : paused ? <Pause className="size-3.5" aria-hidden /> : running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : waiting ? <CircleAlert className="size-3.5" aria-hidden /> : <Target className="size-3.5" aria-hidden />;

  return (
    <section className="border-b border-border bg-card px-4 py-3" aria-label="当前任务">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            {statusIcon}
            当前任务 · {statusLabel}
          </div>
          <h2 className="mt-1 text-base font-semibold text-foreground">{goal}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{details.purpose}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onOpenTaskCenter}>
          <Route className="size-3.5" aria-hidden />
          查看任务中心
        </Button>
      </div>
      {latest !== undefined && (running || waiting || paused) && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="任务控制">
          {(running || waiting) && (
            <Button type="button" size="xs" variant="outline" onClick={() => onControlTask(latest.taskRunId, 'pause')}>
              <Pause className="size-3.5" aria-hidden />
              暂停
            </Button>
          )}
          {paused && (
            <Button type="button" size="xs" variant="outline" onClick={() => onControlTask(latest.taskRunId, 'resume')}>
              <Play className="size-3.5" aria-hidden />
              恢复
            </Button>
          )}
          <Button type="button" size="xs" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => onControlTask(latest.taskRunId, 'cancel')}>
            <X className="size-3.5" aria-hidden />
            取消
          </Button>
        </div>
      )}
      <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
        <div className="rounded border border-border/70 bg-background/60 p-2">
          <div className="text-muted-foreground">输入</div>
          <div className="mt-1 text-foreground/85">{latest?.type === 'task-activity' ? latest.inputSummary ?? details.inputs : details.inputs}</div>
        </div>
        <div className="rounded border border-border/70 bg-background/60 p-2">
          <div className="text-muted-foreground">执行方式</div>
          <div className="mt-1 text-foreground/85">{details.execution}</div>
        </div>
        <div className="rounded border border-border/70 bg-background/60 p-2">
          <div className="text-muted-foreground">输出与下一步</div>
          <div className="mt-1 text-foreground/85">{latest?.type === 'task-activity' ? latest.outputSummary ?? latest.nextAction ?? details.output : details.output}</div>
        </div>
      </div>
      {latest !== undefined && (
        <div className={`mt-2 rounded border px-2.5 py-2 text-xs ${failed || cancelled ? 'border-destructive/30 bg-destructive/5 text-destructive' : paused || waiting ? 'border-amber-500/30 bg-amber-500/5 text-foreground/85' : 'border-primary/20 bg-primary/5 text-foreground/85'}`}>
          <div>{latest.type === 'task-activity' ? latest.message : latest.type === 'task-run-completed' ? latest.summary : latest.error.message}</div>
          {latest.type === 'task-run-failed' && (
            <div className="mt-1 space-y-1 text-destructive/85">
              <div>已完成步骤：{latest.error.category === 'aborted' ? '已执行到中断点' : '已保留此前已完成的读取与校验步骤'}</div>
              {latest.error.recovery !== undefined && <div>恢复建议：{latest.error.recovery}</div>}
              <Button type="button" size="xs" variant="outline" className="mt-1 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={onOpenTaskCenter}>查看任务详情与恢复选项</Button>
            </div>
          )}
          {latest.type === 'task-activity' && latest.nextAction !== undefined && !waiting && (
            <div className="mt-1 text-foreground/70">下一步：{latest.nextAction}</div>
          )}
        </div>
      )}
      {latest?.type === 'task-activity' && latest.status === 'awaiting-author' && latest.authorCandidates !== undefined && (
        <div className="mt-2 grid gap-2 md:grid-cols-2" aria-label="待确认原文候选">
          {latest.authorCandidates.map((candidate) => (
            <button
              key={candidate.candidateId}
              type="button"
              className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-left transition-colors hover:border-amber-500 hover:bg-amber-500/10"
              onClick={() => onChooseSourceLocation(latest.taskRunId, candidate.candidateId)}
            >
              <div className="text-xs font-medium text-foreground">{candidate.label}</div>
              <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">…{candidate.preview}…</div>
              <div className="mt-2 text-xs font-medium text-primary">确认这个位置</div>
            </button>
          ))}
        </div>
      )}
      {locatedSource !== undefined && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs" aria-label="下一步局部改写">
          <span className="text-foreground/85">已定位到可修订的原文位置，可针对该片段进入局部改写。</span>
          <Button
            type="button"
            size="xs"
            onClick={() => onEnterRefactor(locatedSource)}
          >
            <Target className="size-3.5" aria-hidden />
            进入局部改写
          </Button>
        </div>
      )}
    </section>
  );
}
