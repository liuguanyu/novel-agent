import assert from 'node:assert/strict';
import { renderBookDiagnosisPrompt } from './book-diagnoser.js';
import type { LegacyOutline } from '../../core/legacy-organization/index.js';

const outline: LegacyOutline = {
  id: 'outline-1',
  projectId: 'project-1',
  version: 1,
  createdAt: '2026-08-13T00:00:00.000Z',
  sourceChapterTreeVersion: undefined,
  nodes: [
    { id: 'chapter-1', parentId: undefined, order: 0, kind: 'chapter', title: '第一章', summary: '', characters: [], sources: [], preserved: false, authorNote: undefined },
    { id: 'chapter-2', parentId: undefined, order: 1, kind: 'chapter', title: '第二章', summary: '', characters: [], sources: [], preserved: false, authorNote: undefined },
    { id: 'plot-1', parentId: 'chapter-1', order: 0, kind: 'plot-beat', title: '印章线索', summary: '老刘告知印章在302', characters: ['顾长风', '老刘'], sources: [], preserved: true, authorNote: undefined },
    { id: 'plot-2', parentId: 'chapter-2', order: 0, kind: 'plot-beat', title: '真假印章', summary: '顾长风发现302的印章是假的', characters: ['顾长风', '佐藤'], sources: [], preserved: true, authorNote: undefined },
  ],
  crossChapterIssues: [{
    id: 'issue-1', plotNodeIds: ['plot-1', 'plot-2'], chapterNodeIds: ['chapter-1', 'chapter-2'], kind: 'timeline',
    severity: 'high', description: '印章转移时间', evidence: [], status: 'open', createdAt: '', updatedAt: '',
  }],
};

const prompt = renderBookDiagnosisPrompt(outline);

// 验证 prompt 包含全部情节
assert.match(prompt, /印章线索/);
assert.match(prompt, /真假印章/);
assert.match(prompt, /老刘/);
assert.match(prompt, /佐藤/);
assert.match(prompt, /\[id:plot-1\]/);
assert.match(prompt, /\[id:plot-2\]/);

// 验证 prompt 包含检查维度
assert.match(prompt, /时间线/);
assert.match(prompt, /人物状态/);
assert.match(prompt, /因果关系/);
assert.match(prompt, /重复事件/);
assert.match(prompt, /连续性/);

// 验证 prompt 包含已记录问题（避免重复报告）
assert.match(prompt, /已记录的贯穿问题/);
assert.match(prompt, /印章转移时间/);

// 验证 prompt 要求 JSON 输出
assert.match(prompt, /plotNodeIds/);
assert.match(prompt, /至少 2 个情节/);

console.log('book diagnosis smoke passed');
