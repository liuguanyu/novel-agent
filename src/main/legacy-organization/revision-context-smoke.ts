import assert from 'node:assert/strict';
import { asNodeId } from '../../core/manuscript/index.js';
import {
  buildLegacyRevisionContext,
  renderLegacyRevisionContext,
  type LegacyOutline,
  type PreservationManifest,
} from '../../core/legacy-organization/index.js';
import { assembleContext, renderAssembledContext, type AssemblyRequest } from '../orchestration/context-assembler.js';
import type { NovelState } from '../../core/orchestration/index.js';

const now = '2026-08-13T00:00:00.000Z';
const outline: LegacyOutline = {
  id: 'outline-1',
  projectId: 'project-1',
  version: 1,
  createdAt: now,
  sourceChapterTreeVersion: undefined,
  nodes: [
    {
      id: 'chapter-1', parentId: undefined, order: 0, kind: 'chapter', title: '第一章', summary: '',
      characters: [], sources: [], preserved: false, authorNote: undefined,
    },
    {
      id: 'plot-1', parentId: 'chapter-1', order: 0, kind: 'plot-beat', title: '真假印章',
      summary: '佐藤临时转移真印章，顾长风识破假印章。', characters: ['佐藤', '顾长风'], sources: [],
      preserved: true, authorNote: undefined,
    },
  ],
  crossChapterIssues: [
    {
      id: 'issue-open', plotNodeIds: ['plot-1'], chapterNodeIds: ['chapter-1'], kind: 'timeline',
      severity: 'high', description: '印章转移时间需要明确', evidence: ['老刘先说印章在302'], status: 'confirmed',
      authorNote: '最终由作者确认转移发生在潜入前。', createdAt: now, updatedAt: now,
    },
    {
      id: 'issue-resolved', plotNodeIds: ['plot-1'], chapterNodeIds: ['chapter-1'], kind: 'continuity',
      severity: 'low', description: '已解决问题不应带入', evidence: [], status: 'resolved', createdAt: now, updatedAt: now,
    },
  ],
};
const manifest: PreservationManifest = {
  projectId: 'project-1', outlineId: 'outline-1', updatedAt: now,
  plots: [{
    id: 'preserved-plot-1', outlineNodeId: 'plot-1', title: '旧标题',
    sourceRefs: [{ id: asNodeId('chapter-1'), kind: 'chapter' }],
    authorNote: '保留情报正确，突出佐藤警觉和顾长风急智。', preservedAt: now,
  }],
  quotes: [{
    id: 'quote-1', text: '真印章在佐藤身上。',
    sourceNodeRef: { id: asNodeId('chapter-1'), kind: 'chapter' }, sourceChapterTitle: '第一章',
    outlineNodeId: 'plot-1', recommended: false, authorNote: undefined, preservedAt: now,
  }],
};

const context = buildLegacyRevisionContext(outline, manifest);
assert.equal(context.preservedPlots.length, 1);
assert.equal(context.preservedPlots[0]?.summary, '佐藤临时转移真印章，顾长风识破假印章。');
assert.deepEqual(context.preservedPlots[0]?.sourceChapterIds, ['chapter-1']);
assert.equal(context.preservedQuotes.length, 1);
assert.deepEqual(context.openCrossChapterIssues.map((issue) => issue.description), ['印章转移时间需要明确']);
assert.deepEqual(context.crossChapterDecisions.map((issue) => issue.description), ['已解决问题不应带入']);

const rendered = renderLegacyRevisionContext(context);
assert.match(rendered, /【必须保留的情节】/);
assert.match(rendered, /作者后续改写要求：保留情报正确/);
assert.match(rendered, /【可参考的保留原文】/);
assert.match(rendered, /【待处理贯穿问题】/);
assert.match(rendered, /【作者对贯穿问题的最终裁决】/);
assert.match(rendered, /已解决问题不应带入（已解决，按作者方案执行）/);

// 集成验证：旧稿整理约束经 assembleContext → renderAssembledContext 进入模型 prompt。
const legacyBlock = renderLegacyRevisionContext(context);
const minimalState: NovelState = {
  currentChapterId: null,
  currentDraft: '',
  chatHistory: [],
  activeBugs: [],
  currentAction: 'idle',
  agentStatus: 'idle',
  contextRefs: { facts: null, corpus: null },
};
const request: AssemblyRequest = {
  agentId: 'editor',
  scope: 'project',
  additionalContext: legacyBlock,
};
const assembled = await assembleContext(undefined, minimalState, request);
const fullBlock = renderAssembledContext(assembled);
assert.match(fullBlock, /【旧稿整理约束】/);
assert.match(fullBlock, /【必须保留的情节】/);
assert.match(fullBlock, /真假印章/);
assert.match(fullBlock, /作者后续改写要求：保留情报正确/);
assert.match(fullBlock, /【作者对贯穿问题的最终裁决】/);
assert.match(fullBlock, /【待处理贯穿问题】/);

console.log('legacy revision context smoke passed');
