/** 常驻专家工作台：只呈现本轮目标、目标专家与真实有序执行路径。 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, CircleDot, Workflow } from 'lucide-react';
import {
  WORKBENCH_GRAPH,
  type WorkbenchActivities,
} from '../../core/shell/workbench-graph.js';
import { WorkbenchGraph } from './WorkbenchGraph.js';
import type {
  WorkbenchTraceObservation,
  WorkbenchTraceStep,
} from '../hooks/useWorkbenchActivities.js';

interface ExpertWorkbenchProps {
  readonly activities: WorkbenchActivities;
  readonly trace: ReadonlyArray<WorkbenchTraceStep>;
  readonly objective: string | undefined;
  readonly targetAgent: string | undefined;
  readonly observation: WorkbenchTraceObservation | undefined;
}

function nodeLabel(id: string): string {
  return WORKBENCH_GRAPH.nodes.find((node) => node.id === id)?.label ?? id;
}

function activitySummary(activities: WorkbenchActivities): string | undefined {
  let running: string | undefined;
  for (const [node, activity] of activities) {
    if (activity.phase === 'awaiting') return `${nodeLabel(node)}待裁决`;
    if (activity.phase === 'running') running = `${nodeLabel(node)}运行中`;
  }
  return running;
}

export function ExpertWorkbench({
  activities,
  trace,
  objective,
  targetAgent,
  observation,
}: ExpertWorkbenchProps): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const summary = activitySummary(activities);
  const targetLabel = targetAgent === undefined ? undefined : nodeLabel(targetAgent);
  return (
    <section className="border-t border-border bg-card/45 px-3 py-2" aria-label="专家工作台">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between gap-3 text-xs ${expanded ? 'mb-2' : ''}`}
      >
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          {expanded ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          <Workflow className="size-3.5 text-primary" aria-hidden />
          专家工作台
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {summary !== undefined && <CircleDot className="size-3 animate-pulse text-primary" aria-hidden />}
          {summary ??
            (observation === undefined
              ? '等待工作任务'
              : `轨迹 ${observation.count} · ${nodeLabel(observation.node)}${observation.phase === 'enter' ? '进入' : '完成'}`)}
        </span>
      </button>
      {expanded && <WorkbenchGraph trace={trace} objective={objective} targetLabel={targetLabel} />}
    </section>
  );
}
