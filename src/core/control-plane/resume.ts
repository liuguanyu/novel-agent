/**
 * 带决策数据的恢复（resume）契约 (human-in-the-loop tasks 1.2, 1.3, 1.5)
 *
 * spec: interrupt-resume「带决策数据的恢复」——作者以决策数据恢复运行，支持批准/驳回/修改，
 * 从挂起点继续、不重跑已完成节点；修改（覆写 activeBugs）对接 orchestration-state 的
 * 可覆写 reducer 与 story-bible 的 requiresHumanDecision（见 design D2）。
 *
 * 本文件为类型契约 + Zod schema + 纯 helper（无 I/O）。
 * 这里定义强类型 ResumeDecision，作为 ipc-contract 中 ResumeRunCommand.decision(unknown) 的
 * Main 侧校验目标（占位替换，见 control-event.ts 的映射说明）。
 */

import { z } from 'zod';
import type { ConsistencyIssue } from '../story-bible/consistency-issue.js';
import type { NovelStateUpdate } from '../orchestration/agent-node.js';
import { overwriteActiveBugs } from '../orchestration/novel-state.js';

/**
 * 作者恢复决策（强类型判别联合，task 1.2）。
 * - approve：批准放行，后续流程继续。
 * - reject：驳回，终止或改道后续流程。
 * - modify：修改后恢复，以新的 activeBugs 覆写状态（如删除误报、仅保留部分问题）。
 */
export type ResumeDecision =
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'modify'; activeBugs: ReadonlyArray<ConsistencyIssue> };

/**
 * ConsistencyIssue 的 Zod 校验（resume `modify` 的校验边界）。
 * 镜像 story-bible/consistency-issue.ts 的 ConsistencyIssue 结构；story-bible 未导出 schema，
 * 而作者经 IPC 回传的 activeBugs 为 unknown，MUST 在此 Main 边界校验后方可覆写状态。
 * 不标注 z.ZodType<ConsistencyIssue>，以兼容 exactOptionalPropertyTypes。
 */
const consistencyIssueSchema = z
  .object({
    type: z.string().min(1),
    severity: z.enum(['critical', 'warning', 'info']),
    anchors: z
      .array(
        z
          .object({
            id: z.string().min(1),
            kind: z.enum(['volume', 'chapter', 'scene']),
          })
          .strict(),
      )
      .min(1),
    description: z.string(),
    suggestedFix: z.string().optional(),
    requiresHumanDecision: z.boolean(),
    options: z
      .array(z.object({ id: z.string().min(1), label: z.string() }).strict())
      .optional(),
  })
  .strict();

/**
 * ResumeDecision 的 Zod 校验（task 1.2）。
 * Main 侧收到 ResumeRunCommand.decision(unknown) 后经此转强类型；失败走 validation 失败处理。
 */
export const resumeDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approve') }).strict(),
  z.object({ kind: z.literal('reject') }).strict(),
  z.object({ kind: z.literal('modify'), activeBugs: z.array(consistencyIssueSchema) }).strict(),
]);

/**
 * 将 modify 决策映射到 activeBugs 覆写 (task 1.3)。纯函数。
 * 对接 orchestration-state 的 overwriteActiveBugs（可覆写 reducer）：
 * modify → 用作者修订后的列表整体替换；approve/reject 不改 activeBugs（返回空更新）。
 * resume 后从挂起点继续、不重跑已完成节点由运行层保证（LangGraph Command(resume)）。
 */
export function applyResumeToState(
  decision: ResumeDecision,
  currentBugs: ReadonlyArray<ConsistencyIssue>,
): NovelStateUpdate {
  if (decision.kind === 'modify') {
    return { activeBugs: overwriteActiveBugs(currentBugs, decision.activeBugs) };
  }
  return {};
}
