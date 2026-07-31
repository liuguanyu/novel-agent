/**
 * 任务化 UI 文案（信息架构收敛，Phase 4.5 C/D）。
 *
 * 按 requirement.md §7.5（中栏空状态用任务语言）与 §7.6（右栏随任务切助手角色）
 * 提供 templateStageId → 文案 的纯映射，供 App 派生后以 props 下发给中栏 / 右栏。
 * Renderer 纯展示：不访问 DB/LLM/fs，只消费投影后的 workflow 快照字段。
 */

import type { WorkflowSnapshotDto } from '../../shared/ipc/index.js';

/** 中栏未选章节时的任务语言空状态：标题 + 引导说明（§7.5）。 */
export interface ManuscriptEmptyCopy {
  readonly title: string;
  readonly hint: string;
}

/** 右栏任务助手：角色标题 + 空状态引导（§7.6）。 */
export interface AssistantCopy {
  readonly title: string;
  readonly emptyHint: string;
}

// §7.5：中栏在未定位到正文时，必须用「正在做什么 + 下一步该点哪里」的任务语言，
// 而不是只显示「未选择章节」。文案随当前阶段切换。
const MANUSCRIPT_EMPTY_BY_STAGE: Readonly<Record<string, ManuscriptEmptyCopy>> = {
  'import-book': { title: '正在确认重建范围', hint: '请在右侧确认这次要保留什么、解决什么，随后正文会在这里展开。' },
  'fact-backfill': { title: '正在建立事实底稿', hint: '系统正在整理全书人物与事实，本阶段不改正文。选择左侧章节可查看对应正文。' },
  'initial-audit': { title: '正在诊断全书', hint: '系统正在梳理全书结构问题，暂不改正文。诊断完成后可在左侧选择问题定位到章节。' },
  'issue-triage': { title: '正在分诊问题', hint: '请在左侧选择一个诊断问题。选定后系统会据证据定位对应章节，并在正文中高亮候选段落。' },
  'locate-source': { title: '正在定位原文', hint: '请选择左侧诊断问题。系统会根据问题证据查找对应章节，并在正文中高亮候选段落。' },
  'generate-rewrite': { title: '正在准备局部改写', hint: '请从当前任务卡进入局部改写。改写目标章节会在这里显示并高亮待修订段落。' },
  'hunk-review': { title: '正在等待逐处审核', hint: '请在改写面板逐处决定接受或拒绝，接受的改动会写回这里的正文。' },
  'apply-checkpoint': { title: '正在应用已接受的修改', hint: '系统正在把已接受的改动写回正文并创建可回滚存档。' },
  'targeted-verification': { title: '正在复检修订结果', hint: '系统正在确认当前问题是否真正修好。复检完成后会给出是否通过。' },
  'close-issue': { title: '正在归档问题', hint: '当前问题的修复结果正在归档，随后会推进到下一个问题或最终复检。' },
  'final-audit': { title: '正在做最终全书复检', hint: '系统正在做最终全书复检。若发现新问题会回到分诊，否则本次重建完成。' },
};

const MANUSCRIPT_EMPTY_FALLBACK: ManuscriptEmptyCopy = {
  title: '未开始正文任务',
  hint: '在左侧选择章节，或从上方任务卡发起一个创作任务。',
};

// §7.6：右栏助手随当前任务切角色标题与引导。
const ASSISTANT_BY_STAGE: Readonly<Record<string, AssistantCopy>> = {
  'import-book': { title: '重建向导助手', emptyHint: '可以问我这次重建应保留什么、优先解决什么。' },
  'fact-backfill': { title: '事实整理助手', emptyHint: '可以让我核对某个人物或设定，或补充事实底稿的约束。' },
  'initial-audit': { title: '故事诊断助手', emptyHint: '可以让我解释某条诊断结论，或补充你更在意的诊断角度。' },
  'issue-triage': { title: '故事诊断助手', emptyHint: '可以和我讨论哪些问题保留、哪些重建、哪些局部修补。' },
  'locate-source': { title: '原文定位助手', emptyHint: '可以让我根据证据定位原文，或补充定位的额外线索。' },
  'generate-rewrite': { title: '改写助手', emptyHint: '可以补充改写的约束或语气要求，我会据此生成局部改写。' },
  'hunk-review': { title: '修订审核助手', emptyHint: '可以让我解释某处改动的理由，或说明你接受/拒绝的偏好。' },
  'apply-checkpoint': { title: '修订审核助手', emptyHint: '可以让我确认已接受的改动，或对本次存档提出要求。' },
  'targeted-verification': { title: '修订审核助手', emptyHint: '可以让我说明复检结论，或补充需要额外核对的点。' },
  'close-issue': { title: '修订审核助手', emptyHint: '可以让我总结本问题的修复结果，或安排下一步。' },
  'final-audit': { title: '故事诊断助手', emptyHint: '可以让我汇报最终复检结果，或补充需要重点复检的方向。' },
};

const ASSISTANT_FALLBACK: AssistantCopy = {
  title: '创作助手',
  emptyHint: '选中章节后，在下方向助手提问或发起召唤。',
};

/** 从 workflow 快照取当前阶段的 templateStageId（无当前阶段时返回 undefined）。 */
export function currentTemplateStageId(workflow: WorkflowSnapshotDto | null): string | undefined {
  if (workflow === null || workflow.currentStageId === null) return undefined;
  const stage = workflow.stages.find((item) => item['stageId'] === workflow.currentStageId);
  const templateStageId = stage?.['templateStageId'];
  return typeof templateStageId === 'string' ? templateStageId : undefined;
}

/** 中栏空状态文案：随当前阶段切换，无阶段时回退通用引导（§7.5）。 */
export function manuscriptEmptyCopy(workflow: WorkflowSnapshotDto | null): ManuscriptEmptyCopy {
  const stageId = currentTemplateStageId(workflow);
  return stageId === undefined ? MANUSCRIPT_EMPTY_FALLBACK : (MANUSCRIPT_EMPTY_BY_STAGE[stageId] ?? MANUSCRIPT_EMPTY_FALLBACK);
}

/** 右栏助手角色文案：随当前阶段切换，无阶段时回退通用助手（§7.6）。 */
export function assistantCopy(workflow: WorkflowSnapshotDto | null): AssistantCopy {
  const stageId = currentTemplateStageId(workflow);
  return stageId === undefined ? ASSISTANT_FALLBACK : (ASSISTANT_BY_STAGE[stageId] ?? ASSISTANT_FALLBACK);
}
