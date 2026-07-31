/**
 * 新书写作/审校循环 playbook 的生产执行器（Phase 5.2）。
 *
 * 把 `new-book-playbooks.ts` 声明的四份写作循环 playbook（章节初稿生成 / 作者修订 /
 * 连贯性检查 / 事实底稿更新）接上真实模型交互，产出可追踪的产物、引用与作者决策。
 *
 * 红线：
 *  - 每步执行器只消费注入的 `inputs`（作者可见的立意/大纲/上文产物）与注入的 ModelResolver，
 *    MUST NOT 直接读写 DB / 正文 / fs——产物持久化由通用引擎（runtime）在 recordStepOutput 完成。
 *  - 禁止把隐藏思维链写进产物；产物只放作者可见的成文与结构化摘要。
 */

import type { CapabilityTier } from '../../core/model/index.js';
import type { ModelAdapter } from '../../core/model/index.js';
import {
  NEW_BOOK_DRAFT_WRITING_PLAYBOOK,
  NEW_BOOK_AUTHOR_REVISION_PLAYBOOK,
  NEW_BOOK_COHERENCE_CHECK_PLAYBOOK,
  NEW_BOOK_FACT_UPDATE_PLAYBOOK,
} from '../../core/task-runtime/new-book-playbooks.js';
import type {
  PlaybookRegistration,
  PlaybookStepContext,
  PlaybookStepOutput,
} from './runtime.js';

/**
 * 执行器所需的最小模型能力：与 FactExtractor 同构，仅取 complete。
 * 生产由 `ModelResolver` 提供；smoke 注入 fake 实现即可覆盖真实事件顺序与产物持久化。
 */
export interface NewBookModelResolver {
  createAdapter(agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'>;
}

/** 取输入里某个 key 的字符串化摘要，用于拼提示词（不泄露隐藏信息，仅作者可见输入）。 */
function describeInput(value: unknown): string {
  if (value === undefined || value === null) return '（未提供）';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 统一的一次成文调用：system 约束不吐思维链，user 为拼装的作者可见上下文。 */
async function completeText(
  resolver: NewBookModelResolver,
  agentId: string,
  tier: CapabilityTier,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<string> {
  const adapter = resolver.createAdapter(agentId, tier);
  const result = await adapter.complete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    options: { temperature: 0.6, maxTokens: 4096, signal },
  });
  return result.text;
}

const NO_COT_SYSTEM =
  '你是小说创作协作者。只输出面向作者的成文或结构化结论，任何思考过程、自我对话或解释性旁白都不得进入回答。';

/**
 * 章节初稿生成：compose-draft 调用 prose 档产出初稿正文，author-accept-draft 等作者确认或提修订方向。
 */
function buildDraftWritingRegistration(resolver: NewBookModelResolver): PlaybookRegistration {
  return {
    playbook: NEW_BOOK_DRAFT_WRITING_PLAYBOOK,
    title: '章节初稿生成',
    completedSummary: '已产出经作者确认的章节初稿',
    handlers: {
      'compose-draft': {
        run: async (ctx: PlaybookStepContext): Promise<PlaybookStepOutput> => {
          const user =
            `请依据以下分场大纲写出该章初稿正文，保持人物与世界观一致：\n` +
            `分场大纲：${describeInput(ctx.inputs['sceneOutline'])}\n` +
            `人物档案：${describeInput(ctx.inputs['characterProfiles'])}\n` +
            `世界观设定：${describeInput(ctx.inputs['worldSetting'])}`;
          const draft = await completeText(resolver, 'writer', 'prose', NO_COT_SYSTEM, user, ctx.signal);
          return {
            message: '已按分场大纲写出章节初稿',
            outputSummary: `初稿约 ${draft.length.toLocaleString()} 字`,
            modelAudit: {
              goal: '根据分场大纲写出章节初稿正文',
              agent: 'writer',
              tier: 'prose',
              inputSummary: '分场大纲、人物档案、世界观设定',
              contextRefs: ['分场大纲', '人物档案', '世界观设定'],
              constraints: ['保持人物与世界观一致', '只输出成文，不得含思考过程'],
              outputSummary: `产出章节初稿，约 ${draft.length.toLocaleString()} 字`,
              structuredResult: { chars: draft.length },
              adoption: 'pending',
            },
            artifacts: [
              {
                outputKey: 'chapterDraft',
                value: { text: draft, chars: draft.length },
                ref: { kind: 'draft', label: '章节初稿', ref: `draft:${ctx.run.id}` },
              },
            ],
          };
        },
      },
      'author-accept-draft': {
        requiresAuthor: true,
        prompt: async (): Promise<{ message: string; nextAction: string }> => ({
          message: '初稿已生成，请确认采纳或给出修订方向',
          nextAction: '在任务卡确认初稿或填写修订意见',
        }),
        apply: async (ctx: PlaybookStepContext, decision: unknown): Promise<PlaybookStepOutput> => ({
          message: '已记录作者对初稿的决策',
          artifacts: [
            {
              outputKey: 'chapterDraft',
              value: { accepted: true, authorDecision: decision },
              ref: { kind: 'draft', label: '作者确认初稿', ref: `draft-accept:${ctx.run.id}` },
            },
          ],
        }),
      },
    },
  };
}

/**
 * 作者修订：propose-revisions 整理可执行修订方案，author-approve-revisions 由作者取舍，apply-revisions 产出修订稿。
 */
function buildAuthorRevisionRegistration(resolver: NewBookModelResolver): PlaybookRegistration {
  return {
    playbook: NEW_BOOK_AUTHOR_REVISION_PLAYBOOK,
    title: '作者修订',
    completedSummary: '已产出经作者确认的修订稿',
    handlers: {
      'propose-revisions': {
        run: async (ctx: PlaybookStepContext): Promise<PlaybookStepOutput> => {
          const user =
            `请基于作者修订意见，对以下初稿整理可执行的修订方案（逐条列出，不改写全文）：\n` +
            `初稿：${describeInput(ctx.inputs['chapterDraft'])}\n` +
            `作者修订意见：${describeInput(ctx.inputs['revisionBrief'])}`;
          const proposal = await completeText(resolver, 'editor', 'reasoning', NO_COT_SYSTEM, user, ctx.signal);
          return {
            message: '已整理可执行的修订方案',
            outputSummary: '产出逐条修订建议',
            modelAudit: {
              goal: '基于作者修订意见整理可执行的逐条修订方案',
              agent: 'editor',
              tier: 'reasoning',
              inputSummary: '章节初稿、作者修订意见',
              contextRefs: ['章节初稿', '作者修订意见'],
              constraints: ['逐条列出，不改写全文', '只输出结论，不得含思考过程'],
              outputSummary: '产出逐条可取舍的修订建议',
              adoption: 'pending',
            },
            artifacts: [
              {
                outputKey: 'revisionProposal',
                value: { proposal },
                ref: { kind: 'draft', label: '修订方案', ref: `revision-proposal:${ctx.run.id}` },
              },
            ],
          };
        },
      },
      'author-approve-revisions': {
        requiresAuthor: true,
        prompt: async (): Promise<{ message: string; nextAction: string }> => ({
          message: '修订方案已就绪，请选择接受、调整或拒绝各项',
          nextAction: '在任务卡对各修订项做出取舍',
        }),
        apply: async (ctx: PlaybookStepContext, decision: unknown): Promise<PlaybookStepOutput> => ({
          message: '已记录作者对修订项的取舍',
          artifacts: [
            {
              outputKey: 'revisionDecision',
              value: decision,
              ref: { kind: 'draft', label: '作者修订决策', ref: `revision-decision:${ctx.run.id}` },
            },
          ],
        }),
      },
      'apply-revisions': {
        run: async (ctx: PlaybookStepContext): Promise<PlaybookStepOutput> => {
          const decision = ctx.run.authorDecisions.find((item) => item.stepId === 'author-approve-revisions');
          const user =
            `请仅将作者已接受的修订项应用到初稿，产出修订稿正文：\n` +
            `初稿：${describeInput(ctx.inputs['chapterDraft'])}\n` +
            `作者已确认的修订取舍：${describeInput(decision?.decision)}`;
          const revised = await completeText(resolver, 'editor', 'prose', NO_COT_SYSTEM, user, ctx.signal);
          return {
            message: '已按作者取舍产出修订稿',
            outputSummary: `修订稿约 ${revised.length.toLocaleString()} 字`,
            modelAudit: {
              goal: '仅将作者已接受的修订项应用到初稿，产出修订稿正文',
              agent: 'editor',
              tier: 'prose',
              inputSummary: '章节初稿、作者已确认的修订取舍',
              contextRefs: ['章节初稿', '作者修订取舍'],
              constraints: ['只应用作者已接受的修订项', '只输出成文，不得含思考过程'],
              outputSummary: `产出修订稿，约 ${revised.length.toLocaleString()} 字`,
              structuredResult: { chars: revised.length },
              adoption: 'adopted',
            },
            artifacts: [
              {
                outputKey: 'revisedDraft',
                value: { text: revised, chars: revised.length },
                ref: { kind: 'draft', label: '修订稿', ref: `revised:${ctx.run.id}` },
              },
            ],
          };
        },
      },
    },
  };
}

/**
 * 连贯性检查：scan-coherence 比对设定/前文产出候选问题，author-triage-issues 由作者裁决是否返修。
 */
function buildCoherenceCheckRegistration(resolver: NewBookModelResolver): PlaybookRegistration {
  return {
    playbook: NEW_BOOK_COHERENCE_CHECK_PLAYBOOK,
    title: '连贯性检查',
    completedSummary: '已产出经作者裁决的连贯性报告',
    handlers: {
      'scan-coherence': {
        run: async (ctx: PlaybookStepContext): Promise<PlaybookStepOutput> => {
          const user =
            `请对以下章节稿做上下文与设定一致性检查，逐条列出候选问题（含定位与依据），不改写正文：\n` +
            `章节稿：${describeInput(ctx.inputs['revisedDraft'])}\n` +
            `事实底稿：${describeInput(ctx.inputs['factView'])}`;
          const report = await completeText(resolver, 'fact-checker', 'reasoning', NO_COT_SYSTEM, user, ctx.signal);
          return {
            message: '已完成连贯性扫描',
            outputSummary: '产出候选一致性问题',
            modelAudit: {
              goal: '对章节稿做上下文与设定一致性检查，逐条列出候选问题',
              agent: 'fact-checker',
              tier: 'reasoning',
              inputSummary: '章节稿、事实底稿',
              contextRefs: ['章节稿', '事实底稿'],
              constraints: ['只列出候选问题，不改写正文', '含定位与依据', '不得含思考过程'],
              outputSummary: '产出候选一致性问题，等待作者裁决',
              adoption: 'pending',
            },
            artifacts: [
              {
                outputKey: 'coherenceScan',
                value: { report },
                ref: { kind: 'diagnosis', label: '连贯性问题', ref: `coherence:${ctx.run.id}` },
              },
            ],
          };
        },
      },
      'author-triage-issues': {
        requiresAuthor: true,
        prompt: async (): Promise<{ message: string; nextAction: string }> => ({
          message: '发现若干一致性问题，请裁决哪些需要返修',
          nextAction: '在任务卡对各问题标注处理结论',
        }),
        apply: async (ctx: PlaybookStepContext, decision: unknown): Promise<PlaybookStepOutput> => ({
          message: '已记录作者对连贯性问题的裁决',
          artifacts: [
            {
              outputKey: 'coherenceReport',
              value: { triage: decision },
              ref: { kind: 'diagnosis', label: '连贯性裁决', ref: `coherence-triage:${ctx.run.id}` },
            },
          ],
        }),
      },
    },
  };
}

/**
 * 事实底稿更新：extract-facts 抽取新事实，author-resolve-conflicts 裁决冲突，merge-facts 产出合并后版本引用。
 */
function buildFactUpdateRegistration(resolver: NewBookModelResolver): PlaybookRegistration {
  return {
    playbook: NEW_BOOK_FACT_UPDATE_PLAYBOOK,
    title: '事实底稿更新',
    completedSummary: '已产出经作者裁决的事实底稿新版本',
    handlers: {
      'extract-facts': {
        run: async (ctx: PlaybookStepContext): Promise<PlaybookStepOutput> => {
          const user =
            `请从以下定稿章节抽取人物、设定、情节等新事实候选（结构化列出），不复述整章正文：\n` +
            `定稿章节：${describeInput(ctx.inputs['revisedDraft'])}\n` +
            `既有事实底稿：${describeInput(ctx.inputs['factView'])}`;
          const facts = await completeText(resolver, 'fact-extractor', 'cheap-fast', NO_COT_SYSTEM, user, ctx.signal);
          return {
            message: '已抽取章节新事实候选',
            outputSummary: '产出待合并事实候选',
            modelAudit: {
              goal: '从定稿章节抽取人物/设定/情节等新事实候选',
              agent: 'fact-extractor',
              tier: 'cheap-fast',
              inputSummary: '定稿章节、既有事实底稿',
              contextRefs: ['定稿章节', '既有事实底稿'],
              constraints: ['结构化列出，不复述整章正文', '不得含思考过程'],
              outputSummary: '产出待合并的事实候选，待作者裁决冲突',
              adoption: 'pending',
            },
            artifacts: [
              {
                outputKey: 'factCandidates',
                value: { facts },
                ref: { kind: 'fact-sheet', label: '新事实候选', ref: `facts:${ctx.run.id}` },
              },
            ],
          };
        },
      },
      'author-resolve-conflicts': {
        requiresAuthor: true,
        prompt: async (): Promise<{ message: string; nextAction: string }> => ({
          message: '新事实与既有底稿存在需裁决的冲突项，请确认取舍',
          nextAction: '在任务卡裁决冲突事实的取舍',
        }),
        apply: async (ctx: PlaybookStepContext, decision: unknown): Promise<PlaybookStepOutput> => ({
          message: '已记录作者对冲突事实的裁决',
          artifacts: [
            {
              outputKey: 'factConflictDecision',
              value: decision,
              ref: { kind: 'fact-sheet', label: '事实冲突裁决', ref: `fact-conflict:${ctx.run.id}` },
            },
          ],
        }),
      },
      'merge-facts': {
        run: async (ctx: PlaybookStepContext): Promise<PlaybookStepOutput> => {
          const decision = ctx.run.authorDecisions.find((item) => item.stepId === 'author-resolve-conflicts');
          return {
            message: '已按作者裁决合并事实底稿',
            outputSummary: '产出事实底稿新版本引用',
            artifacts: [
              {
                outputKey: 'factStoreUpdate',
                value: { merged: true, resolvedConflicts: decision?.decision ?? null },
                ref: { kind: 'fact-sheet', label: '事实底稿新版本', ref: `fact-merge:${ctx.run.id}` },
              },
            ],
          };
        },
      },
    },
  };
}

/**
 * 构建新书写作/审校循环的四份生产执行器注册项。
 * 由 main/index.ts 在模型解析器就绪后注入调用，缺模型时不注册（任务经通用引擎报缺依赖失败）。
 */
export function buildNewBookWritingRegistrations(
  resolver: NewBookModelResolver,
): ReadonlyArray<PlaybookRegistration> {
  return [
    buildDraftWritingRegistration(resolver),
    buildAuthorRevisionRegistration(resolver),
    buildCoherenceCheckRegistration(resolver),
    buildFactUpdateRegistration(resolver),
  ];
}
