import { useEffect, useRef } from 'react';
import type { TaskActivityEvent, TaskUiEffectDto, TaskUiEffectResultDto } from '../../shared/ipc/index.js';

interface TaskUiEffectExecutors {
  readonly selectChapter: (chapterId: string) => Promise<void>;
  readonly highlightQuote: (chapterId: string, quote: string) => Promise<void>;
  readonly showDiff: (nodeId: string, diffId: string) => Promise<void>;
  readonly showHunkReview: (refactorRunId: string) => Promise<void>;
  readonly showCheckpoint: (checkpointId: string) => Promise<void>;
  readonly openFactSheet: () => Promise<void>;
  readonly openDashboard: () => Promise<void>;
}

function appliedMessage(effect: TaskUiEffectDto): string {
  switch (effect.kind) {
    case 'select-chapter': return '已切换到定位结果所在章节';
    case 'scroll-to-evidence': return '已滚动到诊断证据对应的原文';
    case 'highlight-quote': return '已在正文中高亮诊断证据';
    case 'show-diff': return '已打开局部改写差异';
    case 'show-hunk-review': return '已打开逐处审核面板';
    case 'show-checkpoint': return '已打开正文检查点';
    case 'open-fact-sheet': return '已打开事实底稿';
    case 'open-dashboard': return '已打开复检报告';
  }
}

async function executeEffect(effect: TaskUiEffectDto, executors: TaskUiEffectExecutors): Promise<void> {
  switch (effect.kind) {
    case 'select-chapter': return executors.selectChapter(effect.chapterId);
    case 'highlight-quote':
    case 'scroll-to-evidence': return executors.highlightQuote(effect.chapterId, effect.quote);
    case 'show-diff': return executors.showDiff(effect.nodeId, effect.diffId);
    case 'show-hunk-review': return executors.showHunkReview(effect.refactorRunId);
    case 'show-checkpoint': return executors.showCheckpoint(effect.checkpointId);
    case 'open-fact-sheet': return executors.openFactSheet();
    case 'open-dashboard': return executors.openDashboard();
  }
}

export function useTaskUiEffects(
  activities: ReadonlyArray<TaskActivityEvent>,
  executors: TaskUiEffectExecutors,
): void {
  const executed = useRef(new Set<string>());

  useEffect(() => {
    const settled = new Set(
      activities.flatMap((activity) => activity.uiEffectResult === undefined ? [] : [activity.uiEffectResult.effectId]),
    );
    const pending = activities.flatMap((activity) =>
      (activity.uiEffects ?? [])
        .filter((effect) => !settled.has(effect.effectId) && !executed.current.has(effect.effectId))
        .map((effect) => ({ activity, effect })),
    );
    for (const { effect } of pending) executed.current.add(effect.effectId);

    void (async () => {
      for (const { activity, effect } of pending) {
        let result: TaskUiEffectResultDto;
        try {
          await executeEffect(effect, executors);
          result = {
            taskRunId: activity.taskRunId,
            activityId: activity.activityId,
            effectId: effect.effectId,
            effectKind: effect.kind,
            status: 'applied',
            message: appliedMessage(effect),
          };
        } catch (error) {
          result = {
            taskRunId: activity.taskRunId,
            activityId: activity.activityId,
            effectId: effect.effectId,
            effectKind: effect.kind,
            status: 'failed',
            message: error instanceof Error ? error.message : '工作区未能完成该操作',
          };
        }
        window.novelAgent.sendCommand({
          type: 'report-task-ui-effect-result',
          runId: activity.runId,
          operationId: `task-ui-effect:${activity.taskRunId}:${effect.effectId}`,
          result,
        });
      }
    })();


  }, [activities, executors]);
}
