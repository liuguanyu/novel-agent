/**
 * 跨章情节地图 — 纯函数构建全书情节关联视图
 *
 * 从旧稿大纲中提取情节之间的关联关系，供作者全局审视。
 * 不修改任何数据，只读取并组织展示。
 */

import type { LegacyOutline, OutlineNode } from './outline.js';

/** 情节在地图中的节点信息。 */
export interface PlotMapNode {
  readonly plotNodeId: string;
  readonly title: string;
  readonly summary: string;
  readonly characters: ReadonlyArray<string>;
  readonly chapterNodeId: string | undefined;
  readonly chapterTitle: string;
  readonly preserved: boolean;
  readonly crossChapter: boolean;
}

/** 两个情节之间的关联。 */
export interface PlotMapLink {
  readonly kind: 'shared-character' | 'cross-chapter-issue';
  readonly fromPlotNodeId: string;
  readonly toPlotNodeId: string;
  readonly description: string;
  /** 关联涉及的贯穿问题 id（仅 cross-chapter-issue 类型有值）。 */
  readonly issueId?: string;
  /** 共享的人物名（仅 shared-character 类型有值）。 */
  readonly sharedCharacters?: ReadonlyArray<string>;
}

/** 全书情节地图。 */
export interface PlotMap {
  readonly nodes: ReadonlyArray<PlotMapNode>;
  readonly links: ReadonlyArray<PlotMapLink>;
  readonly chapters: ReadonlyArray<{
    readonly chapterNodeId: string;
    readonly chapterTitle: string;
    readonly plotNodeIds: ReadonlyArray<string>;
  }>;
}

/** 从大纲构建情节地图。纯函数，不修改输入。 */
export function buildPlotMap(outline: LegacyOutline): PlotMap {
  const plotNodes = outline.nodes.filter((node) => node.kind === 'plot-beat');
  const chapterMap = new Map<string, OutlineNode>();
  for (const node of outline.nodes) {
    if (node.kind === 'chapter') chapterMap.set(node.id, node);
  }

  const nodes: PlotMapNode[] = plotNodes.map((plot) => {
    const chapter = plot.parentId !== undefined ? chapterMap.get(plot.parentId) : undefined;
    return {
      plotNodeId: plot.id,
      title: plot.title,
      summary: plot.summary,
      characters: plot.characters,
      chapterNodeId: plot.parentId,
      chapterTitle: chapter?.title ?? '未归属章节',
      preserved: plot.preserved,
      crossChapter: plot.crossChapter ?? false,
    };
  });

  const links: PlotMapLink[] = [];

  // 共享人物的关联
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const shared = a.characters.filter((c) => b.characters.includes(c));
      if (shared.length > 0) {
        links.push({
          kind: 'shared-character',
          fromPlotNodeId: a.plotNodeId,
          toPlotNodeId: b.plotNodeId,
          description: `共享人物：${shared.join('、')}`,
          sharedCharacters: shared,
        });
      }
    }
  }

  // 贯穿问题关联
  const issues = outline.crossChapterIssues ?? [];
  for (const issue of issues) {
    for (let i = 0; i < issue.plotNodeIds.length; i++) {
      for (let j = i + 1; j < issue.plotNodeIds.length; j++) {
        links.push({
          kind: 'cross-chapter-issue',
          fromPlotNodeId: issue.plotNodeIds[i]!,
          toPlotNodeId: issue.plotNodeIds[j]!,
          description: issue.description,
          issueId: issue.id,
        });
      }
    }
  }

  const chapters = outline.nodes
    .filter((node) => node.kind === 'chapter')
    .map((chapter) => ({
      chapterNodeId: chapter.id,
      chapterTitle: chapter.title,
      plotNodeIds: plotNodes
        .filter((plot) => plot.parentId === chapter.id)
        .map((plot) => plot.id),
    }));

  return { nodes, links, chapters };
}

/** 按人物分组，返回每个人物出现的情节列表。 */
export function groupPlotsByCharacter(map: PlotMap): ReadonlyArray<{
  readonly character: string;
  readonly plotNodeIds: ReadonlyArray<string>;
}> {
  const charToPlots = new Map<string, string[]>();
  for (const node of map.nodes) {
    for (const character of node.characters) {
      const existing = charToPlots.get(character);
      if (existing !== undefined) {
        existing.push(node.plotNodeId);
      } else {
        charToPlots.set(character, [node.plotNodeId]);
      }
    }
  }
  return [...charToPlots.entries()]
    .filter(([, plotIds]) => plotIds.length >= 2)
    .map(([character, plotIds]) => ({ character, plotNodeIds: plotIds }))
    .sort((a, b) => b.plotNodeIds.length - a.plotNodeIds.length);
}
