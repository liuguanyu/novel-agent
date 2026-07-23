import { useEffect, useRef, useState } from 'react';
import type { NodeName } from '../../core/orchestration/graph-topology.js';
import type {
  BackendControlEvent,
  BackendStreamMessage,
} from '../../shared/ipc/index.js';
import {
  WORKBENCH_GRAPH,
  type WorkbenchActivities,
  type WorkbenchActivity,
  type WorkbenchNodePhase,
} from '../../core/shell/workbench-graph.js';

export interface WorkbenchTraceObservation {
  readonly count: number;
  readonly node: string;
  readonly phase: 'enter' | 'exit';
}

/** 本轮真实执行路径中的一次节点经过；循环会产生多个同名步骤。 */
export interface WorkbenchTraceStep {
  readonly id: number;
  readonly node: NodeName;
  readonly phase: Exclude<WorkbenchNodePhase, 'idle'>;
}

export interface UseWorkbenchActivitiesResult {
  readonly activities: WorkbenchActivities;
  readonly trace: ReadonlyArray<WorkbenchTraceStep>;
  readonly runId: string | undefined;
  readonly observation: WorkbenchTraceObservation | undefined;
}

const KNOWN_NODES = new Set<NodeName>(WORKBENCH_GRAPH.nodes.map((graphNode) => graphNode.id));

/** 消费真实 LangGraph 节点生命周期事件，维护当前运行的状态与有序执行路径。 */
export function useWorkbenchActivities(activeRunId: string | undefined): UseWorkbenchActivitiesResult {
  const [activities, setActivities] = useState<WorkbenchActivities>(new Map());
  const [trace, setTrace] = useState<ReadonlyArray<WorkbenchTraceStep>>([]);
  const [runId, setRunId] = useState<string | undefined>(activeRunId);
  const [observation, setObservation] = useState<WorkbenchTraceObservation | undefined>(undefined);
  const activeRunRef = useRef<string | undefined>(activeRunId);
  const nextStepIdRef = useRef(1);
  const runningNodesByRunRef = useRef<Map<string, Set<NodeName>>>(new Map());

  const resetRun = (nextRunId: string): void => {
    activeRunRef.current = nextRunId;
    nextStepIdRef.current = 1;
    runningNodesByRunRef.current.clear();
    setRunId(nextRunId);
    setActivities(new Map());
    setTrace([]);
    setObservation(undefined);
  };

  useEffect(() => {
    if (activeRunId === undefined || activeRunId === activeRunRef.current) return;
    resetRun(activeRunId);
  }, [activeRunId]);

  useEffect(() => {
    const beginRun = (nextRunId: string): void => {
      if (activeRunRef.current !== nextRunId) resetRun(nextRunId);
    };

    const updateNode = (eventRunId: string, node: string, phase: WorkbenchNodePhase): void => {
      beginRun(eventRunId);
      if (!KNOWN_NODES.has(node as NodeName)) return;
      const nodeId = node as NodeName;
      const runningNodes = runningNodesByRunRef.current.get(eventRunId) ?? new Set<NodeName>();
      if (phase === 'running') {
        runningNodes.add(nodeId);
        runningNodesByRunRef.current.set(eventRunId, runningNodes);
      } else {
        runningNodes.delete(nodeId);
      }
      const activity: WorkbenchActivity = { phase, runId: eventRunId };
      setActivities((previous) => {
        const next = new Map(previous);
        next.set(nodeId, activity);
        return next;
      });
    };

    const enterNode = (eventRunId: string, node: string): void => {
      updateNode(eventRunId, node, 'running');
      if (!KNOWN_NODES.has(node as NodeName)) return;
      const step: WorkbenchTraceStep = {
        id: nextStepIdRef.current++,
        node: node as NodeName,
        phase: 'running',
      };
      setTrace((previous) => [...previous, step]);
    };

    const settleNode = (
      eventRunId: string,
      node: string,
      phase: Exclude<WorkbenchNodePhase, 'idle' | 'running'>,
    ): void => {
      updateNode(eventRunId, node, phase);
      if (!KNOWN_NODES.has(node as NodeName)) return;
      setTrace((previous) => {
        let index = -1;
        for (let stepIndex = previous.length - 1; stepIndex >= 0; stepIndex -= 1) {
          const step = previous[stepIndex];
          if (step?.node === node && step.phase === 'running') {
            index = stepIndex;
            break;
          }
        }
        if (index < 0) return previous;
        return previous.map((step, stepIndex) => (stepIndex === index ? { ...step, phase } : step));
      });
    };

    const settleRunning = (
      eventRunId: string,
      phase: 'awaiting' | 'error',
    ): void => {
      const runningNodes = runningNodesByRunRef.current.get(eventRunId);
      if (runningNodes === undefined) return;
      for (const node of [...runningNodes]) settleNode(eventRunId, node, phase);
      runningNodes.clear();
    };

    const offControl = window.novelAgent.onControlEvent((event: BackendControlEvent) => {
      if (event.type === 'graph-node-activated') {
        if (event.phase === 'enter') enterNode(event.runId, event.node);
        else settleNode(event.runId, event.node, 'done');
        setObservation((previous) => ({
          count: (previous?.count ?? 0) + 1,
          node: event.node,
          phase: event.phase,
        }));
        return;
      }
      if (event.type === 'interrupt-raised' && activeRunRef.current === event.runId) {
        settleRunning(event.runId, 'awaiting');
      }
    });

    const offDialogue = window.novelAgent.onDialogueStream((message: BackendStreamMessage) => {
      if (message.type === 'stream-start') {
        beginRun(message.runId);
        return;
      }
      if (message.type === 'stream-error' && activeRunRef.current === message.runId) {
        settleRunning(message.runId, 'error');
      }
    });

    return () => {
      offControl();
      offDialogue();
    };
  }, []);

  return { activities, trace, runId, observation };
}
