/**
 * 事实一致性判定：章号纠偏 + 指令冲突硬阻断 (orchestration-runtime tasks 7.3, 7.4)
 *
 * spec: historical-fact-retrieval——
 *  - 章号纠偏（7.3）：软召回命中的真实出处章号与作者陈述章号不一致时，产出确认/纠偏提示，
 *    列出真实出处候选交作者裁决；候选 MAY 按接近度排序并标注「最接近」，
 *    但系统 MUST NOT 默认替作者勾选任一候选（design D5）。
 *  - 指令冲突（7.4）：作者指令与事实库既有事实冲突（如要求某角色「首次登场」但其已在前文登场）时，
 *    产出 severity=critical、requiresHumanDecision=true 的问题硬阻断（不裁决不落笔），
 *    且 MUST 始终提供「知情放行」逃生选项（作者拥有最终主权）。
 *
 * 本文件为纯判定逻辑（无 I/O，读传入的 RetrievalResult），可迁移到 utilityProcess。
 * 产出的 ConsistencyIssue 由 reviewer 节点写入 activeBugs，经既有 awaitDecision→control-event 回路裁决。
 */

import type { ConsistencyIssue, DecisionOption } from '../../core/story-bible/index.js';
import { asNodeId, type NodeRef } from '../../core/manuscript/node-id.js';
import { detectChapterMismatches, type RetrievalResult } from './fact-retrieval.js';

/** 纠偏裁决的稳定选项 id（前端/后端约定；correct 决策回传其一）。 */
export const KEEP_STATED_OPTION_ID = 'keep-stated';
export const MANUAL_ANCHOR_OPTION_ID = 'manual-anchor';
/** 候选出处选项 id 前缀（后接真实章节 nodeId）。 */
export const CANDIDATE_OPTION_PREFIX = 'candidate:';

/** 知情放行选项 id（冲突硬阻断的逃生门；approve 即知情放行）。 */
export const OVERRIDE_OPTION_ID = 'informed-override';
export const AMEND_INSTRUCTION_OPTION_ID = 'amend-instruction';

/** 把 nodeId 字符串包成章节 NodeRef（纠偏/冲突锚点用）。 */
function chapterAnchor(nodeId: string): NodeRef {
  return { id: asNodeId(nodeId), kind: 'chapter' };
}

/**
 * 章号纠偏（task 7.3）。
 * 从「软召回命中 vs 作者陈述章号」的不一致中，为每条命中产出一个需裁决的 ConsistencyIssue：
 *  - anchors：作者陈述章节 + 真实出处章节（双锚点，供 UI 对照）；
 *  - options：真实出处候选（可标「最接近」）+「维持原述」+「手动指定」，MUST NOT 默认勾选；
 *  - requiresHumanDecision=true。
 *
 * statedChapterNodeId 为作者对话中陈述的软章号（仅软提示，不硬过滤见 context-assembler）。
 */
export function buildCorrectionIssues(
  hits: RetrievalResult,
  statedChapterNodeId: string,
): ReadonlyArray<ConsistencyIssue> {
  const mismatches = detectChapterMismatches(hits, statedChapterNodeId);
  if (mismatches.length === 0) return [];

  // 按 (kind,id) 聚合：同一条目的多处真实出处收进一个问题的候选集，避免重复问话。
  const byItem = new Map<string, { description: string; realChapters: Set<string> }>();
  for (const m of mismatches) {
    const key = `${m.kind}:${m.id}`;
    const entry = byItem.get(key) ?? { description: m.description, realChapters: new Set<string>() };
    entry.realChapters.add(m.realChapterNodeId);
    byItem.set(key, entry);
  }

  const issues: ConsistencyIssue[] = [];
  for (const [, entry] of byItem) {
    const realChapters = [...entry.realChapters];
    // 候选选项：真实出处（第一个标「最接近」，仅为接近度提示，非默认勾选）。
    const candidateOptions: DecisionOption[] = realChapters.map((nodeId, idx) => ({
      id: `${CANDIDATE_OPTION_PREFIX}${nodeId}`,
      label: idx === 0 ? `出处 [${nodeId}]（最接近）` : `出处 [${nodeId}]`,
    }));
    const options: DecisionOption[] = [
      ...candidateOptions,
      { id: KEEP_STATED_OPTION_ID, label: `维持作者所述章节 [${statedChapterNodeId}]` },
      { id: MANUAL_ANCHOR_OPTION_ID, label: '手动指定其它章节' },
    ];

    // 双锚点：作者陈述章 + 真实出处章（取第一个真实出处为主锚，其余在描述里列出）。
    const anchors: NodeRef[] = [
      chapterAnchor(statedChapterNodeId),
      ...realChapters.map(chapterAnchor),
    ];

    issues.push({
      type: 'other',
      severity: 'warning',
      anchors,
      description:
        `你提到「${entry.description}」在章节 [${statedChapterNodeId}]，` +
        `但召回命中的真实出处在 ${realChapters.map((c) => `[${c}]`).join('、')}。` +
        `请确认你指的是哪一处（系统不替你选）。`,
      requiresHumanDecision: true,
      options,
    });
  }
  return issues;
}

/** 指令中触发「首次/初次登场」语义的关键短语（命中即可能与既有出处冲突）。 */
const FIRST_APPEARANCE_MARKERS: ReadonlyArray<string> = [
  '首次登场',
  '首次出现',
  '第一次登场',
  '第一次出现',
  '初次登场',
  '初次出现',
  '首度登场',
  'first appearance',
  'first appears',
  'debut',
];

/**
 * 指令冲突硬阻断（task 7.4）。
 * 启发式：作者指令声称某实体「首次登场」，但事实库召回显示该实体已有既往出处（provenance）→ 冲突。
 * 产出 severity=critical、requiresHumanDecision=true 的问题：
 *  - anchors：实体既有出处章节（供作者核对）；
 *  - options：「知情放行」（照作者所述写、知悉矛盾）+「改指令」，MUST 始终含知情放行逃生门。
 *
 * @param retrieval 已按指令关键词召回的事实（命中的实体带真实出处）
 * @param instruction 作者自然语言指令原文
 */
export function detectInstructionConflicts(
  retrieval: RetrievalResult,
  instruction: string,
): ReadonlyArray<ConsistencyIssue> {
  if (instruction.length === 0) return [];
  const lower = instruction.toLowerCase();
  const claimsFirstAppearance = FIRST_APPEARANCE_MARKERS.some((m) => lower.includes(m.toLowerCase()));
  if (!claimsFirstAppearance) return [];

  const issues: ConsistencyIssue[] = [];
  for (const entity of retrieval.entities) {
    // 指令声称「首次登场」，但该实体在事实库已有出处 → 与既有事实冲突。
    if (entity.provenance.length === 0) continue;
    // 仅当指令实际提到了该实体名/别名时才判冲突（避免召回噪声误报）。
    const mentioned =
      lower.includes(entity.canonicalName.toLowerCase()) ||
      entity.aliases.some((a) => lower.includes(a.toLowerCase()));
    if (!mentioned) continue;

    const anchors: NodeRef[] = entity.provenance.map((p) => p.location);
    const priorChapters = anchors.map((a) => `[${a.id as string}]`).join('、');
    const options: DecisionOption[] = [
      {
        id: OVERRIDE_OPTION_ID,
        label: '知情放行（照我所述写，我知悉会与前文矛盾）',
      },
      { id: AMEND_INSTRUCTION_OPTION_ID, label: '改指令（不写作「首次登场」）' },
    ];
    issues.push({
      type: 'state-contradiction',
      severity: 'critical',
      anchors,
      description:
        `你要求「${entity.canonicalName}」首次登场，但其在前文已登场（出处：${priorChapters}）。` +
        `此为硬冲突，未经你裁决不落笔。你可「知情放行」照原意继续，或改指令。`,
      requiresHumanDecision: true,
      options,
    });
  }
  return issues;
}