/**
 * 对话轴手刹契约 (electron-shell-ui layout-skeleton task 1.3；design D2)
 *
 * spec: layout-skeleton「对话轴手刹契约」——右对话轴呈现 chatHistory 视图与打断/继续/审批控件;
 * 打断映射 human-in-the-loop 的 abort，审批（批准/驳回/修改）与继续映射 interrupt/resume;
 * 动作 MUST 经 IPC control-event 下发并携带 runId;审批弹窗 MUST 呈现后端推送的强类型 payload
 * （如 activeBugs），MUST NOT 在 Renderer 二次加工业务数据。
 *
 * 本文件为类型契约 + 纯 mapper（无 I/O）。把 UI 手刹意图确定性地映射到 control-plane 的
 * AuthorControlCommand（复用既有语义，不自造控制结构）;实际下发经 IPC controlEvent 通道（Main 侧）。
 */

import type { RunId } from '../../shared/ipc/stream-messages.js';
import type { AuthorControlCommand } from '../control-plane/control-event.js';
import type { InterruptPayload } from '../control-plane/interrupt.js';
import type { ResumeDecision } from '../control-plane/resume.js';
import type { DialogueMessage } from '../orchestration/novel-state.js';
import type { ConsistencyIssue } from '../story-bible/consistency-issue.js';

/**
 * 对话轴呈现的对话历史视图 (spec「对话历史为状态视图」)。
 * 直接复用 orchestration novel-state 的 DialogueMessage;Renderer 只读渲染、MUST NOT 二次加工。
 */
export type DialogueHistoryView = ReadonlyArray<DialogueMessage>;

/**
 * 审批弹窗呈现的强类型数据 (spec「审批弹窗呈现强类型 payload」)。
 * 直接复用 control-plane 的 InterruptPayload（如 review-report 携 activeBugs）;
 * Renderer 仅呈现，业务处理在后端。
 */
export type ApprovalPayloadView = InterruptPayload;

/**
 * 作者在对话轴触发的手刹意图 (task 1.3)。UI 层的语义，与后端控制命令解耦、由本文件 mapper 映射。
 * - `interrupt`：打断当前运行 → 映射 abort。
 * - `approve`：审批通过 → 映射 resume(approve)。
 * - `reject`：驳回 → 映射 resume(reject)。
 * - `modify-and-continue`：修改后继续 → 映射 resume(modify)，携作者修订后的 activeBugs。
 */
export type HandbrakeIntent =
  | { kind: 'interrupt'; reason?: string }
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'modify-and-continue'; activeBugs: ReadonlyArray<ConsistencyIssue> };

/**
 * 手刹意图 → AuthorControlCommand 映射 (task 1.3)。纯函数。
 *
 * 语义（spec「手刹映射控制语义」）:
 * - interrupt → abort（即时停止，见 abort.ts）。
 * - approve / reject / modify-and-continue → resume（携强类型 ResumeDecision，见 resume.ts）。
 * 所有命令 MUST 携带 runId（经 IPC controlEvent 通道下发，见 control-event.ts）。
 *
 * 注：resume 的 ResumeDecision 由本处按意图构造;modify 的 activeBugs 由后端 Main 侧再经
 * resumeDecisionSchema 校验（作者回传数据经 IPC 时为 unknown，边界校验属 Main）。
 */
export function toControlCommand(runId: RunId, intent: HandbrakeIntent): AuthorControlCommand {
  switch (intent.kind) {
    case 'interrupt':
      return intent.reason !== undefined
        ? { type: 'abort', request: { runId, reason: intent.reason } }
        : { type: 'abort', request: { runId } };
    case 'approve':
      return { type: 'resume', runId, decision: { kind: 'approve' } };
    case 'reject':
      return { type: 'resume', runId, decision: { kind: 'reject' } };
    case 'modify-and-continue': {
      const decision: ResumeDecision = { kind: 'modify', activeBugs: intent.activeBugs };
      return { type: 'resume', runId, decision };
    }
  }
}

/**
 * 手刹动作经 control-event 携 runId 下发原则 (task 1.3 / spec「动作经 IPC control-event 下发」)。
 * 手刹控件动作 MUST 经 IPC controlEvent 通道下发并携带 runId，MUST NOT 在 Renderer 直接执行控制。
 * 此常量为该约束的显式契约标记（与 control-plane 的 CONTROL_EVENTS_CARRY_RUN_ID 对应）。
 */
export const HANDBRAKE_DISPATCHES_VIA_CONTROL_EVENT = true as const;

/**
 * 审批数据不在 Renderer 加工原则 (task 1.3 / spec「不二次加工业务数据」)。
 * 审批弹窗 MUST 原样呈现后端推送的强类型 InterruptPayload;Renderer MUST NOT 承载业务处理逻辑
 * （如重新判定问题严重度、增删问题的业务规则）。作者的修订意图经 modify-and-continue 上报，后端裁决。
 * 此常量为该边界的显式契约标记。
 */
export const APPROVAL_PAYLOAD_NOT_REPROCESSED_IN_RENDERER = true as const;
