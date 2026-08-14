/**
 * 审校结果结构化消费 hook (review-findings-ui)
 *
 * 消费 window.novelAgent 桥的 onControlEvent，过滤 review-completed：按 runId 存审校问题集
 * （产出 agent + ConsistencyIssueDto[]）。暴露选中态供「点击卡片 → 定位高亮 → 连线」链路驱动。
 * Renderer 无业务逻辑：仅接收后端下发的强类型结构化数据并维护 UI 选中态。
 */
import { subscribeControlEvent } from '../lib/ipc-event-bus.js';

import { useCallback, useEffect, useState } from 'react';
import type {
  BackendControlEvent,
  ConsistencyIssueDto,
} from '../../shared/ipc/index.js';

/** 一次审校运行的结构化结果。 */
export interface ReviewFinding {
  /** 产出问题的审校 agent 标识（reviewer / fact-checker / plagiarism-checker）。 */
  readonly agent: string;
  /** 强类型问题清单。 */
  readonly issues: ReadonlyArray<ConsistencyIssueDto>;
}

/** 当前选中的单条问题（runId + 该运行问题清单内的索引）。 */
export interface ActiveFinding {
  readonly runId: string;
  readonly index: number;
}

export interface UseReviewFindingsResult {
  /** 按 runId 归档的审校结果（供对话轴在对应回合下渲染卡片）。 */
  findingsByRun: ReadonlyMap<string, ReviewFinding>;
  /** 当前选中的问题（无则 undefined）。 */
  activeFinding: ActiveFinding | undefined;
  /** 选中某条问题（触发定位高亮与连线）；重复点同一条则取消选中（toggle）。 */
  selectFinding(runId: string, index: number): void;
  /** 清除当前选中（取消高亮与连线）。 */
  clearFinding(): void;
}

/** 消费 review-completed 控制事件并维护审校结果与选中态。 */
export function useReviewFindings(): UseReviewFindingsResult {
  const [findingsByRun, setFindingsByRun] = useState<ReadonlyMap<string, ReviewFinding>>(
    () => new Map(),
  );
  const [activeFinding, setActiveFinding] = useState<ActiveFinding | undefined>(undefined);

  useEffect(() => {
    const off = subscribeControlEvent((event: BackendControlEvent) => {
      if (event.type !== 'review-completed') return;
      setFindingsByRun((prev) => {
        const next = new Map(prev);
        next.set(event.runId, { agent: event.agent, issues: event.issues });
        return next;
      });
    });
    return off;
  }, []);

  const selectFinding = useCallback((runId: string, index: number): void => {
    setActiveFinding((prev) =>
      prev !== undefined && prev.runId === runId && prev.index === index
        ? undefined
        : { runId, index },
    );
  }, []);

  const clearFinding = useCallback((): void => {
    setActiveFinding(undefined);
  }, []);

  return { findingsByRun, activeFinding, selectFinding, clearFinding };
}
