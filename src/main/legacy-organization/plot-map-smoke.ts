import assert from 'node:assert/strict';
import { buildPlotMap, groupPlotsByCharacter, type LegacyOutline } from '../../core/legacy-organization/index.js';

const outline: LegacyOutline = {
  id: 'outline-1',
  projectId: 'project-1',
  version: 1,
  createdAt: '2026-08-13T00:00:00.000Z',
  sourceChapterTreeVersion: undefined,
  nodes: [
    { id: 'chapter-1', parentId: undefined, order: 0, kind: 'chapter', title: '第一章', summary: '', characters: [], sources: [], preserved: false, authorNote: undefined },
    { id: 'chapter-2', parentId: undefined, order: 1, kind: 'chapter', title: '第二章', summary: '', characters: [], sources: [], preserved: false, authorNote: undefined },
    { id: 'plot-1', parentId: 'chapter-1', order: 0, kind: 'plot-beat', title: '印章线索', summary: '发现假印章', characters: ['顾长风', '老刘'], sources: [], preserved: true, authorNote: undefined },
    { id: 'plot-2', parentId: 'chapter-1', order: 1, kind: 'plot-beat', title: '夜访', summary: '夜间潜入', characters: ['顾长风'], sources: [], preserved: false, authorNote: undefined },
    { id: 'plot-3', parentId: 'chapter-2', order: 0, kind: 'plot-beat', title: '佐藤警觉', summary: '佐藤转移印章', characters: ['佐藤', '顾长风'], sources: [], preserved: true, authorNote: undefined, crossChapter: true },
  ],
  crossChapterIssues: [
    {
      id: 'issue-1', plotNodeIds: ['plot-1', 'plot-3'], chapterNodeIds: ['chapter-1', 'chapter-2'], kind: 'timeline',
      severity: 'high', description: '印章转移时间需要明确', evidence: [], status: 'open', createdAt: '', updatedAt: '',
    },
  ],
};

const map = buildPlotMap(outline);
assert.equal(map.nodes.length, 3);
assert.equal(map.chapters.length, 2);
assert.deepEqual(map.chapters[0]?.plotNodeIds, ['plot-1', 'plot-2']);

// 共享人物：顾长风出现在 plot-1/plot-2/plot-3，老刘只在 plot-1
const sharedCharLinks = map.links.filter((l) => l.kind === 'shared-character');
assert.ok(sharedCharLinks.some((l) => l.fromPlotNodeId === 'plot-1' && l.toPlotNodeId === 'plot-3' && l.sharedCharacters?.includes('顾长风')));
assert.ok(sharedCharLinks.some((l) => l.fromPlotNodeId === 'plot-1' && l.toPlotNodeId === 'plot-2' && l.sharedCharacters?.includes('顾长风')));

// 贯穿问题关联
const issueLinks = map.links.filter((l) => l.kind === 'cross-chapter-issue');
assert.equal(issueLinks.length, 1);
assert.equal(issueLinks[0]?.fromPlotNodeId, 'plot-1');
assert.equal(issueLinks[0]?.toPlotNodeId, 'plot-3');
assert.equal(issueLinks[0]?.issueId, 'issue-1');

// 跨章情节
const crossChapterNodes = map.nodes.filter((n) => n.crossChapter);
assert.equal(crossChapterNodes.length, 1);
assert.equal(crossChapterNodes[0]?.title, '佐藤警觉');

// 人物分组
const groups = groupPlotsByCharacter(map);
assert.ok(groups.some((g) => g.character === '顾长风' && g.plotNodeIds.length === 3));
assert.ok(!groups.some((g) => g.character === '老刘')); // 老刘只出现 1 次，不进入分组

console.log('plot map smoke passed');
