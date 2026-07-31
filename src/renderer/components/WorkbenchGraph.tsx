/**
 * 专家工作台执行流程：展示本轮目标与按真实事件顺序形成的节点时间线。
 * 专家能力目录留在工作台下方；这里不再用静态放射拓扑冒充执行顺序。
 */

import { ArrowRight, Circle, Target } from 'lucide-react';
import {
  WORKBENCH_GRAPH,
  type WorkbenchNodePhase,
} from '../../core/shell/workbench-graph.js';
import type { WorkbenchTraceStep } from '../hooks/useWorkbenchActivities.js';
import { resolveIcon } from '../lib/agent-icons.js';

interface PhaseVisual {
  readonly label: string;
  readonly border: string;
  readonly background: string;
  readonly foreground: string;
  readonly pulse: boolean;
}

const PHASE_VISUAL: Record<Exclude<WorkbenchNodePhase, 'idle'>, PhaseVisual> = {
  running: {
    label: '运行中',
    border: 'var(--primary)',
    background: 'oklch(from var(--primary) l c h / 18%)',
    foreground: 'var(--primary)',
    pulse: true,
  },
  done: {
    label: '完成',
    border: 'oklch(0.63 0.18 150)',
    background: 'oklch(0.63 0.18 150 / 16%)',
    foreground: 'oklch(0.57 0.17 150)',
    pulse: false,
  },
  error: {
    label: '异常',
    border: 'var(--destructive)',
    background: 'oklch(from var(--destructive) l c h / 16%)',
    foreground: 'var(--destructive)',
    pulse: false,
  },
  awaiting: {
    label: '待裁决',
    border: 'oklch(0.72 0.17 75)',
    background: 'oklch(0.72 0.17 75 / 18%)',
    foreground: 'oklch(0.62 0.16 75)',
    pulse: true,
  },
};

function nodeDefinition(nodeId: string) {
  return WORKBENCH_GRAPH.nodes.find((node) => node.id === nodeId);
}

function TraceCard({ step, index }: { step: WorkbenchTraceStep; index: number }): JSX.Element {
  const node = nodeDefinition(step.node);
  const visual = PHASE_VISUAL[step.phase];
  const Icon = resolveIcon(node?.icon ?? 'Circle');
  return (
    <div className="flex shrink-0 items-center gap-2">
      {index > 0 && <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <div
        className={`relative flex min-w-36 items-center gap-2 rounded-lg border-2 px-3 py-2.5 ${
          visual.pulse ? 'animate-pulse' : ''
        }`}
        style={{ borderColor: visual.border, backgroundColor: visual.background }}
        data-workbench-node={step.node}
        data-phase={step.phase}
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full"
          style={{ color: visual.foreground, backgroundColor: 'var(--card)' }}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] text-muted-foreground">步骤 {index + 1}</span>
          <span className="block truncate text-xs font-semibold">{node?.label ?? step.node}</span>
        </span>
        <span
          className="ml-auto whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-medium"
          style={{ color: visual.foreground, borderColor: visual.border }}
        >
          {visual.label}
        </span>
      </div>
    </div>
  );
}

export function WorkbenchGraph({
  trace,
  objective,
  targetLabel,
}: {
  trace: ReadonlyArray<WorkbenchTraceStep>;
  objective: string | undefined;
  targetLabel: string | undefined;
}): JSX.Element {
  return (
    <section className="rounded-md border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 items-start gap-2">
          <Target className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">本轮目标</div>
            <div className="mt-0.5 line-clamp-2 text-sm font-medium text-foreground">
              {objective ?? '等待发起工作任务'}
            </div>
          </div>
        </div>
        <div className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
          目标专家：<span className="font-medium text-foreground">{targetLabel ?? '待指定'}</span>
        </div>
      </div>

      <div className="pt-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">实时执行路径</div>
        {trace.length === 0 ? (
          <div className="flex h-24 items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs text-muted-foreground">
            <Circle className="size-3" aria-hidden />
            等待专家开始执行
          </div>
        ) : (
          <div className="flex min-h-24 items-center overflow-x-auto pb-2">
            {trace.map((step, index) => (
              <TraceCard key={step.id} step={step} index={index} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
