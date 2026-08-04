/**
 * 对话流式消费 hook (walking-skeleton tasks 6.2, 6.3)
 *
 * 消费 window.novelAgent 桥的 onDialogueStream，按 runId 归并 BackendStreamMessage 为一次会话回复：
 * 正文（content）与 reasoning（旁路，带 \u0001reasoning\u0001 前缀）分流拼接。
 * 手刹（中断）经 abort-run 命令经桥上报。Renderer 无业务逻辑：仅渲染与交互。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toControlCommand } from '../../core/shell/handbrake.js';
import { resolveAgentEntry } from '../../core/shell/agent-catalog.js';
import { buildAssetClarificationSelectionCommand } from '../lib/workflow-ui-contracts.js';
import type {
  BackendControlEvent,
  BackendStreamMessage,
  WorkflowRefDto,
  ConsistencyIssueDto,
  FrontendCommandMessage,
  ResumeRunCommand,
  SummonRunCommand,
} from '../../shared/ipc/index.js';

const REASONING_PREFIX = '\u0001reasoning\u0001';

/** 一条对话消息（用户发起或助手回复）。 */
export interface DialogueTurn {
  runId: string;
  role: 'user' | 'assistant';
  /** 正文内容（助手回复只含 content，不含 reasoning）。 */
  content: string;
  /** 助手思考过程（reasoning 旁路），可折叠展示。 */
  reasoning: string;
  /** 运行状态。 */
  status: 'streaming' | 'completed' | 'aborted' | 'error';
  /** 错误消息（status==='error' 时）。 */
  error?: string;
  /** 发言专家 agent 标识（助手 turn 本次召唤的目标 agent；用户 turn 无）。 */
  agent?: string;
}

/** 发起一次召唤的入参（对话轴/命令面板共用）。 */
export interface SummonRequest {
  agent: string;
  mode: 'diagnose' | 'mutate';
  scope: 'selection' | 'node' | 'document' | 'project';
  anchorNodeId?: string;
  instruction?: string;
  /** writer 新草稿完成后是否触发事实抽取。 */
  autoExtractFacts?: boolean;
  /** 跨阶段资产澄清时由作者明确选择的目标资产。 */
  targetAssetId?: string;
  workflowRef?: WorkflowRefDto;
}

/** 某次召唤运行因 reviewer 抛出需人工裁决问题而挂起的待裁决态。 */
export interface PendingConflict {
  runId: string;
  issues: ReadonlyArray<ConsistencyIssueDto>;
  workflowRef?: WorkflowRefDto;
}

function newRunId(): string {
  return crypto.randomUUID();
}

export interface UseDialogueResult {
  turns: ReadonlyArray<DialogueTurn>;
  /** 当前进行中的 runId（无则 undefined）。 */
  activeRunId: string | undefined;
  /** 因 reviewer 冲突挂起、等待作者裁决的运行（无则 undefined）。 */
  pendingConflict: PendingConflict | undefined;
  /** 发起一次召唤，返回 runId。 */
  summon(request: SummonRequest): string;
  /** 中断指定运行（手刹）。 */
  abort(runId: string): void;
  /** 认可放行挂起的运行（知情放行）。 */
  approveConflict(runId: string): void;
  /** 驳回并终止挂起的运行。 */
  rejectConflict(runId: string): void;
  /** 以选定候选项纠偏挂起的运行。 */
  correctConflict(runId: string, optionId: string): void;
  /** 以作者修订后的问题清单恢复运行（覆盖 activeBugs → 交写手改写）。 */
  modifyConflict(runId: string, issues: ReadonlyArray<ConsistencyIssueDto>): void;
}

/** 消费对话流并维护 turns 状态。 */
export function useDialogue(workflowRef?: WorkflowRefDto): UseDialogueResult {
  const [turns, setTurns] = useState<ReadonlyArray<DialogueTurn>>([]);
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | undefined>(undefined);
  const activeRunIdRef = useRef<string | undefined>(undefined);
  /** 本 hook 发起的召唤 runId 集合：仅处理自己的 interrupt-raised，不抢抽取冲突（归 useFactExtraction）。 */
  const startedRunsRef = useRef<Set<string>>(new Set());
  const runRefsRef = useRef<Map<string, WorkflowRefDto>>(new Map());

  const applyToRun = useCallback(
    (runId: string, updater: (turn: DialogueTurn) => DialogueTurn): void => {
      setTurns((prev) =>
        prev.map((t) => (t.runId === runId && t.role === 'assistant' ? updater(t) : t)),
      );
    },
    [],
  );

  const clearActive = useCallback((runId: string): void => {
    if (activeRunIdRef.current === runId) {
      activeRunIdRef.current = undefined;
      setActiveRunId(undefined);
    }
  }, []);

  useEffect(() => {
    const off = window.novelAgent.onDialogueStream((message: BackendStreamMessage) => {
      switch (message.type) {
        case 'stream-start':
          applyToRun(message.runId, (t) => ({ ...t, status: 'streaming' }));
          break;
        case 'stream-chunk':
          if (message.delta.startsWith(REASONING_PREFIX)) {
            const delta = message.delta.slice(REASONING_PREFIX.length);
            applyToRun(message.runId, (t) => ({ ...t, reasoning: t.reasoning + delta }));
          } else {
            applyToRun(message.runId, (t) => ({ ...t, content: t.content + message.delta }));
          }
          break;
        case 'stream-end':
          applyToRun(message.runId, (t) => ({
            ...t,
            status: message.reason === 'aborted' ? 'aborted' : 'completed',
          }));
          clearActive(message.runId);
          break;
        case 'stream-error':
          applyToRun(message.runId, (t) => ({
            ...t,
            status: 'error',
            error: message.error.message,
          }));
          clearActive(message.runId);
          break;
      }
    });
    return off;
  }, [applyToRun, clearActive]);

  // 订阅控制事件通道：主召唤/对话流因 reviewer 抛出需裁决问题而挂起时，后端推 interrupt-raised。
  // 仅处理本 hook 发起的 runId（抽取冲突由 useFactExtraction 处理，避免双重接管）。
  useEffect(() => {
    const off = window.novelAgent.onControlEvent((event: BackendControlEvent) => {
      if (event.type !== 'interrupt-raised') return;
      if (!startedRunsRef.current.has(event.runId)) return;
      setPendingConflict({ runId: event.runId, issues: event.issues, ...(event.workflowRef === undefined ? {} : { workflowRef: event.workflowRef }) });
      if (event.workflowRef !== undefined) runRefsRef.current.set(event.runId, event.workflowRef);
    });
    return off;
  }, []);

  const summon = useCallback((request: SummonRequest): string => {
    const runId = newRunId();
    // 无显式指令时（如工具条一键召唤），用“召唤 <专家名>”作为作者气泡文本，不显示裸 (无指令)。
    const summonLabel = ((): string => {
      const entry = resolveAgentEntry(request.agent);
      return `召唤${entry?.label ?? request.agent}`;
    })();
    const userTurn: DialogueTurn = {
      runId,
      role: 'user',
      content: request.instruction ?? summonLabel,
      reasoning: '',
      status: 'completed',
    };
    const assistantTurn: DialogueTurn = {
      runId,
      role: 'assistant',
      content: '',
      reasoning: '',
      status: 'streaming',
      agent: request.agent,
    };
    setTurns((prev) => [...prev, userTurn, assistantTurn]);
    startedRunsRef.current.add(runId);
    activeRunIdRef.current = runId;
    setActiveRunId(runId);

    const resolvedWorkflowRef = request.workflowRef ?? workflowRef;
    const command: SummonRunCommand = request.targetAssetId === undefined
      ? {
          type: 'summon-run',
          runId,
          agent: request.agent,
          mode: request.mode,
          scope: request.scope,
          ...(request.anchorNodeId !== undefined ? { anchorNodeId: request.anchorNodeId } : {}),
          ...(request.instruction !== undefined ? { instruction: request.instruction } : {}),
          ...(request.autoExtractFacts !== undefined ? { autoExtractFacts: request.autoExtractFacts } : {}),
          ...(resolvedWorkflowRef === undefined ? {} : { workflowRef: resolvedWorkflowRef }),
        }
      : buildAssetClarificationSelectionCommand({
          runId,
          agent: request.agent,
          mode: request.mode,
          scope: request.scope,
          targetAssetId: request.targetAssetId,
          ...(request.anchorNodeId === undefined ? {} : { anchorNodeId: request.anchorNodeId }),
          ...(request.instruction === undefined ? {} : { instruction: request.instruction }),
          ...(request.autoExtractFacts === undefined ? {} : { autoExtractFacts: request.autoExtractFacts }),
          ...(resolvedWorkflowRef === undefined ? {} : { workflowRef: resolvedWorkflowRef }),
        });
    if (command.workflowRef !== undefined) runRefsRef.current.set(runId, command.workflowRef);
    window.novelAgent.sendCommand(command);
    return runId;
  }, []);

  const abort = useCallback((runId: string): void => {
    // 手前意图经 core/shell/handbrake 的 toControlCommand 映射（interrupt → abort），
    // 再投影为可序列化的 IPC DTO（shared 叶子层）经桥上报。
    const control = toControlCommand(runId, { kind: 'interrupt' });
    if (control.type === 'abort') {
      const command: FrontendCommandMessage = { type: 'abort-run', runId: control.request.runId };
      window.novelAgent.sendCommand(command);
    }
  }, []);

  const resumeWith = useCallback(
    (runId: string, decision: ResumeRunCommand['decision']): void => {
      setPendingConflict((prev) => (prev?.runId === runId ? undefined : prev));
      // approve/reject 会终止；correct 回 writer 续写，会重新产生同 runId 的流分片，
      // 故对 correct 重新置为 streaming 并接管 activeRunId（手刹可再次作用）。
      if (decision.kind === 'correct' || decision.kind === 'modify') {
        applyToRun(runId, (t) => ({ ...t, status: 'streaming' }));
        activeRunIdRef.current = runId;
        setActiveRunId(runId);
      }
      const ref = runRefsRef.current.get(runId);
      const command: ResumeRunCommand = { type: 'resume-run', runId, decision, ...(ref === undefined ? {} : { workflowRef: ref }) };
      window.novelAgent.sendCommand(command);
    },
    [applyToRun],
  );

  const approveConflict = useCallback(
    (runId: string): void => resumeWith(runId, { kind: 'approve' }),
    [resumeWith],
  );

  const rejectConflict = useCallback(
    (runId: string): void => resumeWith(runId, { kind: 'reject' }),
    [resumeWith],
  );

  const correctConflict = useCallback(
    (runId: string, optionId: string): void => resumeWith(runId, { kind: 'correct', optionId }),
    [resumeWith],
  );

  const modifyConflict = useCallback(
    (runId: string, issues: ReadonlyArray<ConsistencyIssueDto>): void =>
      resumeWith(runId, { kind: 'modify', issues }),
    [resumeWith],
  );

  return {
    turns,
    activeRunId,
    pendingConflict,
    summon,
    abort,
    approveConflict,
    rejectConflict,
    correctConflict,
    modifyConflict,
  };
}
