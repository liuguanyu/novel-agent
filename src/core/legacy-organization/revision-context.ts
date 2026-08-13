import type { LegacyOutline, OutlineNode } from './outline.js';
import type { PreservationManifest } from './preservation.js';

export interface LegacyRevisionContext {
  readonly preservedPlots: ReadonlyArray<{
    readonly title: string;
    readonly summary: string;
    readonly authorNote?: string;
    readonly sourceChapterIds: ReadonlyArray<string>;
  }>;
  readonly preservedQuotes: ReadonlyArray<{
    readonly text: string;
    readonly sourceChapterTitle: string;
    readonly outlineNodeId?: string;
    readonly authorNote?: string;
  }>;
  readonly openCrossChapterIssues: ReadonlyArray<{
    readonly description: string;
    readonly kind: string;
    readonly severity: string;
    readonly evidence: ReadonlyArray<string>;
    readonly plotNodeIds: ReadonlyArray<string>;
    readonly chapterNodeIds: ReadonlyArray<string>;
    readonly authorNote?: string;
  }>;
  readonly crossChapterDecisions: ReadonlyArray<{
    readonly description: string;
    readonly status: 'resolved' | 'dismissed';
    readonly authorNote?: string;
  }>;
}

function chapterIdsForNode(outline: LegacyOutline, node: OutlineNode): ReadonlyArray<string> {
  const ids: string[] = [];
  let current: OutlineNode | undefined = node;
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.kind === 'chapter') ids.push(current.id);
    current = current.parentId === undefined
      ? undefined
      : outline.nodes.find((candidate) => candidate.id === current?.parentId);
  }
  return ids;
}

export function buildLegacyRevisionContext(
  outline: LegacyOutline,
  manifest: PreservationManifest,
): LegacyRevisionContext {
  const preservedPlots = manifest.plots.flatMap((plot) => {
    const node = outline.nodes.find((candidate) => candidate.id === plot.outlineNodeId);
    if (node === undefined) return [];
    return [{
      title: node.title,
      summary: node.summary,
      ...(plot.authorNote === undefined ? {} : { authorNote: plot.authorNote }),
      sourceChapterIds: chapterIdsForNode(outline, node),
    }];
  });
  const preservedQuotes = manifest.quotes.map((quote) => {
    return {
      text: quote.text,
      sourceChapterTitle: quote.sourceChapterTitle,
      ...(quote.outlineNodeId === undefined ? {} : { outlineNodeId: quote.outlineNodeId }),
      ...(quote.authorNote === undefined ? {} : { authorNote: quote.authorNote }),
    };
  });
  const openCrossChapterIssues = (outline.crossChapterIssues ?? [])
    .filter((issue) => issue.status === 'open' || issue.status === 'confirmed')
    .map((issue) => ({
      description: issue.description,
      kind: issue.kind,
      severity: issue.severity,
      evidence: issue.evidence,
      plotNodeIds: issue.plotNodeIds,
      chapterNodeIds: issue.chapterNodeIds,
      ...(issue.authorNote === undefined ? {} : { authorNote: issue.authorNote }),
    }));
  const crossChapterDecisions = (outline.crossChapterIssues ?? [])
    .filter((issue) => issue.status === 'resolved' || issue.status === 'dismissed')
    .map((issue) => ({
      description: issue.description,
      status: issue.status as 'resolved' | 'dismissed',
      ...(issue.authorNote === undefined ? {} : { authorNote: issue.authorNote }),
    }));
  return { preservedPlots, preservedQuotes, openCrossChapterIssues, crossChapterDecisions };
}

export function renderLegacyRevisionContext(context: LegacyRevisionContext): string {
  const lines = ['【旧稿整理约束】', '以下内容来自作者确认的旧稿整理结果。必须尊重保留情节和作者要求；贯穿问题只作为待处理约束，不要擅自替作者裁决。'];
  if (context.preservedPlots.length > 0) {
    lines.push('【必须保留的情节】');
    context.preservedPlots.forEach((plot) => {
      lines.push(`- ${plot.title}：${plot.summary}`);
      if (plot.authorNote !== undefined) lines.push(`  作者后续改写要求：${plot.authorNote}`);
      if (plot.sourceChapterIds.length > 0) lines.push(`  来源章节：${plot.sourceChapterIds.join('、')}`);
    });
  }
  if (context.preservedQuotes.length > 0) {
    lines.push('【可参考的保留原文】');
    context.preservedQuotes.forEach((quote) => {
      lines.push(`- ${quote.sourceChapterTitle}：「${quote.text}」`);
      if (quote.authorNote !== undefined) lines.push(`  作者说明：${quote.authorNote}`);
    });
  }
  if (context.crossChapterDecisions.length > 0) {
    lines.push('【作者对贯穿问题的最终裁决】');
    context.crossChapterDecisions.forEach((decision) => {
      const result = decision.status === 'resolved' ? '已解决，按作者方案执行' : '已忽略，不要再当作冲突';
      lines.push(`- ${decision.description}（${result}）`);
      if (decision.authorNote !== undefined) lines.push(`  作者裁决：${decision.authorNote}`);
    });
  }
  if (context.openCrossChapterIssues.length > 0) {
    lines.push('【待处理贯穿问题】');
    context.openCrossChapterIssues.forEach((issue) => {
      lines.push(`- [${issue.severity}/${issue.kind}] ${issue.description}`);
      if (issue.evidence.length > 0) lines.push(`  证据：${issue.evidence.join('；')}`);
      if (issue.authorNote !== undefined) lines.push(`  作者裁决备注：${issue.authorNote}`);
    });
  }
  return lines.length === 2 ? '' : lines.join('\n');
}
