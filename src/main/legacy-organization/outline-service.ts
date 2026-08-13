/**
 * 老书整理 v2 — 大纲生成服务
 *
 * 从章节树提取卷章结构，并通过模型识别章节内的情节候选。
 */

import { randomUUID } from 'node:crypto';
import type { ChapterTreeDto } from '../../shared/ipc/index.js';
import type {
  LegacyOutline,
  OutlineNode,
  OutlineGenerationResult,
  CrossChapterIssue,
  CrossChapterIssueKind,
  CrossChapterIssueSeverity,
  CrossChapterIssueStatus,
  AdvisorConversation,
  AdvisorConversationTurn,
} from '../../core/legacy-organization/index.js';
import type {
  PreservationManifest,
  PreservedPlot,
  PreservedQuote,
  PreservePlotInput,
  PreserveQuoteInput,
} from '../../core/legacy-organization/index.js';
import * as store from './store.js';
import { readChapterContent } from '../novel-reader.js';
import { PlotRecognizer, type PlotRecognizerModelResolver } from './plot-recognizer.js';

/* ── 大纲生成 ──────────────────────────────────────────────────── */

/**
 * 从章节树 DTO 构建大纲。
 *
 * 策略：
 * - volume → 卷节点
 * - chapter → 章节点
 * - scene → 不单独生成节点（情节候选由章节识别单独生成）
 *
 * 每个大纲节点记录来源章节引用。
 */
function buildOutlineFromChapterTree(
  projectId: string,
  tree: ChapterTreeDto,
): LegacyOutline {
  const nodes: OutlineNode[] = [];
  let order = 0;
  let volumeIndex = 0;

  for (const root of tree.roots) {
    if (root.kind === 'volume') {
      volumeIndex++;
      const volumeId = randomUUID();
      const volumeOrder = order++;
      const volumeTitle = root.title || `第${volumeIndex}卷`;
      const volumeSummary = root.children.length > 0
        ? `共 ${root.children.length} 章`
        : '';

      nodes.push({
        id: volumeId,
        parentId: undefined,
        order: volumeOrder,
        kind: 'volume',
        title: volumeTitle,
        summary: volumeSummary,
        characters: [],
        sources: [],
        crossChapter: false,
        preserved: false,
        authorNote: undefined,
      });

      // 卷下的章节作为章节点；情节候选由作者显式触发识别
      for (const child of root.children) {
        if (child.kind === 'chapter') {
          nodes.push({
            id: child.id,
            parentId: volumeId,
            order: child.order,
            kind: 'chapter',
            title: child.title || `第${child.order + 1}章`,
            summary: '',
            characters: [],
            sources: [{
              nodeRef: { id: child.id, kind: child.kind } as unknown as import('../../core/manuscript/index.js').NodeRef,
              label: `${volumeTitle} · ${child.title || `第${child.order + 1}章`}`,
              quote: undefined,
            }],
            crossChapter: false,
            preserved: false,
            authorNote: undefined,
          });
        }
      }
    } else if (root.kind === 'chapter') {
      // 顶层章节（无卷分组）
      nodes.push({
        id: root.id,
        parentId: undefined,
        order: root.order,
        kind: 'chapter',
        title: root.title || `第${root.order + 1}章`,
        summary: '',
        characters: [],
        sources: [{
          nodeRef: { id: root.id, kind: root.kind } as unknown as import('../../core/manuscript/index.js').NodeRef,
          label: root.title || `第${root.order + 1}章`,
          quote: undefined,
        }],
        crossChapter: false,
        preserved: false,
        authorNote: undefined,
      });
    }
  }

  return {
    id: randomUUID(),
    projectId,
    version: 1,
    createdAt: new Date().toISOString(),
    nodes,
    deletedPlots: [],
    sourceChapterTreeVersion: undefined,
  };
}

/**
 * 从章节树收集所有章节元信息（供生成大纲使用）。
 */
function collectChapterMeta(tree: ChapterTreeDto): Array<{ nodeId: string; title: string; parentTitle?: string }> {
  const result: Array<{ nodeId: string; title: string; parentTitle?: string }> = [];
  for (const root of tree.roots) {
    if (root.kind === 'volume') {
      for (const child of root.children) {
        result.push({ nodeId: child.id, title: child.title, parentTitle: root.title });
      }
    } else {
      result.push({ nodeId: root.id, title: root.title });
    }
  }
  return result;
}

/**
 * 生成或重新生成旧稿大纲。
 * MVP 1 仅从章节树结构提取，不调用 LLM。
 */
export async function generateOutline(
  projectId: string,
  projectDir: string,
  tree: ChapterTreeDto,
): Promise<OutlineGenerationResult> {
  // 更新进度：开始
  await store.saveProgress(projectDir, { status: 'reading', chaptersRead: undefined, totalChapters: countChapters(tree), error: undefined });

  // 收集章节信息
  const chapters = collectChapterMeta(tree);

  // 更新进度：结构化
  await store.saveProgress(projectDir, { status: 'structuring', chaptersRead: 0, totalChapters: chapters.length, error: undefined });

  // 构建大纲
  const outline = buildOutlineFromChapterTree(projectId, tree);

  // 生成简单的推荐原文候选（每章取标题作为候选）
  const allNodes = outline.nodes;
  const recommendedQuotes: PreservedQuote[] = [];
  const characters: Set<string> = new Set();

  // 检测人物（简单的启发式：从章节标题中提取人名）
  for (const node of allNodes) {
    // 从标题中提取可能的名称（简单的启发式）
    const nameMatch = node.title.match(/[^\s·.]{2,4}/g);
    if (nameMatch) {
      for (const name of nameMatch) {
        if (name.length >= 2 && name.length <= 4 && !/^[0-9]+$/.test(name)) {
          characters.add(name);
        }
      }
    }
  }

  // 更新进度：完成
  await store.saveProgress(projectDir, {
    status: 'completed',
    chaptersRead: chapters.length,
    totalChapters: chapters.length,
    error: undefined,
  });

  // 保存大纲
  await store.saveOutline(projectDir, outline);

  // 初始化空的保留清单
  const manifest: PreservationManifest = {
    projectId,
    outlineId: outline.id,
    plots: [],
    quotes: [],
    updatedAt: new Date().toISOString(),
  };
  await store.savePreservations(projectDir, manifest);

  return {
    outline,
    recommendedQuotes,
    detectedCharacters: Array.from(characters),
    volumeCount: allNodes.filter((n) => n.kind === 'volume').length,
    plotCount: allNodes.filter((n) => n.kind === 'plot-beat').length,
  };
}

function countChapters(tree: ChapterTreeDto): number {
  let count = 0;
  for (const root of tree.roots) {
    if (root.kind === 'volume') {
      count += root.children.length;
    } else if (root.kind === 'chapter') {
      count += 1;
    }
  }
  return count;
}

/* ── 情节候选识别与人工整理 ─────────────────────────────────────── */

/** 中文章节编号近似解析；解析失败时回退到章节树原 order。重名标题不参与身份判断。 */
function parseChineseChapterNumber(title: string): number | undefined {
  const match = title.match(/第\s*([零〇一二两三四五六七八九十百千0-9]+)\s*[章节回]/);
  if (match?.[1] === undefined) return undefined;
  if (/^\d+$/.test(match[1])) return Number(match[1]);
  const digit: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let section = 0;
  let current = 0;
  for (const char of match[1]) {
    if (digit[char] !== undefined) {
      current = digit[char];
    } else if (char === '十' || char === '百' || char === '千') {
      const unit = char === '十' ? 10 : char === '百' ? 100 : 1000;
      section += (current || 1) * unit;
      current = 0;
    }
  }
  total = section + current;
  return total > 0 ? total : undefined;
}

function approximateChapterOrder(nodes: ReadonlyArray<OutlineNode>): ReadonlyArray<OutlineNode> {
  const volumeOrder = new Map(nodes.filter((node) => node.kind === 'volume').map((node) => [node.id, node.order]));
  return nodes.filter((node) => node.kind === 'chapter').sort((a, b) => {
    const volumeDiff = (a.parentId === undefined ? -1 : volumeOrder.get(a.parentId) ?? Number.MAX_SAFE_INTEGER)
      - (b.parentId === undefined ? -1 : volumeOrder.get(b.parentId) ?? Number.MAX_SAFE_INTEGER);
    if (volumeDiff !== 0) return volumeDiff;
    const parsedA = parseChineseChapterNumber(a.sources[0]?.label ?? a.title);
    const parsedB = parseChineseChapterNumber(b.sources[0]?.label ?? b.title);
    if (parsedA !== undefined && parsedB !== undefined && parsedA !== parsedB) return parsedA - parsedB;
    return a.order - b.order;
  });
}

/** 兼容旧 JSON：先采用已保存顺序，再按近似章节顺序补入新识别情节。 */
export function resolvePlotSequence(outline: LegacyOutline): ReadonlyArray<string> {
  const plots = new Set(outline.nodes.filter((node) => node.kind === 'plot-beat').map((node) => node.id));
  const saved = (outline.plotSequence ?? []).filter((id) => plots.delete(id));
  const derived = approximateChapterOrder(outline.nodes).flatMap((chapter) =>
    outline.nodes.filter((node) => node.kind === 'plot-beat' && node.parentId === chapter.id).sort((a, b) => a.order - b.order).map((node) => node.id),
  );
  return [...saved, ...derived.filter((id) => plots.delete(id)), ...plots];
}

/**
 * 通过模型识别本章的语义情节候选。重新识别只替换未保留候选；失败时不修改大纲。
 */
export async function recognizeChapterPlots(
  projectDir: string,
  projectId: string,
  chapterNodeId: string,
  resolver: PlotRecognizerModelResolver,
  progressContext?: { chaptersRead: number; totalChapters: number },
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const chapter = outline.nodes.find((node) => node.id === chapterNodeId && node.kind === 'chapter');
  if (chapter === undefined) return outline;

  const baseProgress = progressContext ?? { chaptersRead: 0, totalChapters: 1 };
  await store.saveProgress(projectDir, {
    status: 'analyzing', ...baseProgress, error: undefined, currentChapterTitle: chapter.title,
  });
  try {
    const content = (await readChapterContent(chapterNodeId, projectDir)).content;
    const recognized = await new PlotRecognizer(resolver).recognize(chapter.title, content, async ({ segment, totalSegments }) => {
      await store.saveProgress(projectDir, {
        status: 'analyzing', ...baseProgress, error: undefined, currentChapterTitle: chapter.title,
        currentSegment: segment, totalSegments,
      });
    });
    // 模型调用期间作者可能修改或保留情节；提交前重新读取最新版本，避免覆盖并发修改。
    const latestOutline = await store.loadOutline(projectDir);
    if (latestOutline === undefined) return undefined;
    const existingChildren = latestOutline.nodes.filter((node) => node.parentId === chapterNodeId && node.kind === 'plot-beat');
    const preservedChildren = existingChildren.filter((node) => node.preserved);
    const candidates: OutlineNode[] = recognized.map((plot, index) => ({
      id: randomUUID(),
      parentId: chapterNodeId,
      order: preservedChildren.length + index,
      kind: 'plot-beat',
      title: plot.title,
      summary: plot.summary,
      characters: plot.characters,
      sources: [{
        nodeRef: { id: chapterNodeId, kind: 'chapter' } as unknown as import('../../core/manuscript/index.js').NodeRef,
        label: chapter.title,
        quote: plot.quote || undefined,
      }],
      crossChapter: false,
      preserved: false,
      authorNote: '模型识别候选，请人工确认、修改或删除。',
    }));
    const keptNodes = latestOutline.nodes.filter((node) => node.parentId !== chapterNodeId || node.kind !== 'plot-beat');
    const updatedNodes = [...keptNodes, ...preservedChildren, ...candidates];
    const replacedIds = new Set(existingChildren.filter((node) => !node.preserved).map((node) => node.id));
    const previousSequence = resolvePlotSequence(latestOutline).filter((id) => !replacedIds.has(id));
    const preservedIds = new Set(preservedChildren.map((node) => node.id));
    const insertionIndex = previousSequence.findIndex((id) => {
      const node = latestOutline.nodes.find((item) => item.id === id);
      return node?.parentId === chapterNodeId && preservedIds.has(id);
    });
    const nextSequence = [...previousSequence];
    nextSequence.splice(insertionIndex < 0 ? nextSequence.length : insertionIndex + preservedChildren.length, 0, ...candidates.map((node) => node.id));
    const updated: LegacyOutline = {
      ...latestOutline,
      projectId,
      version: latestOutline.version + 1,
      createdAt: new Date().toISOString(),
      nodes: updatedNodes,
      plotSequence: nextSequence,
    };
    await store.saveOutline(projectDir, updated);
    await store.saveProgress(projectDir, progressContext === undefined
      ? {
          status: 'completed', chaptersRead: 1, totalChapters: 1,
          error: undefined, currentChapterTitle: chapter.title,
        }
      : {
          status: 'analyzing', chaptersRead: baseProgress.chaptersRead + 1, totalChapters: baseProgress.totalChapters,
          error: undefined, currentChapterTitle: chapter.title,
        });
    return updated;
  } catch (error: unknown) {
    await store.saveProgress(projectDir, {
      status: progressContext === undefined ? 'failed' : 'analyzing',
      chaptersRead: baseProgress.chaptersRead,
      totalChapters: baseProgress.totalChapters,
      error: error instanceof Error ? error.message : String(error),
      currentChapterTitle: chapter.title,
    });
    throw error;
  }
}

/**
 * 按章节顺序补齐全书情节。默认跳过已有任意情节节点的章节，避免覆盖作者已整理内容；
 * 失败章节记录后继续，下一次运行会自动重试仍然没有情节结果的章节。
 */
export async function recognizeBookPlots(
  projectDir: string,
  projectId: string,
  resolver: PlotRecognizerModelResolver,
): Promise<LegacyOutline | undefined> {
  const initial = await store.loadOutline(projectDir);
  if (initial === undefined) return undefined;
  const byParent = (parentId: string | undefined): ReadonlyArray<OutlineNode> => initial.nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order);
  const chapters = byParent(undefined).flatMap((root) =>
    root.kind === 'chapter' ? [root] : root.kind === 'volume' ? byParent(root.id).filter((node) => node.kind === 'chapter') : [],
  );
  const pending = chapters.filter((chapter) =>
    !initial.nodes.some((node) => node.kind === 'plot-beat' && node.parentId === chapter.id),
  );
  const failedChapters: Array<{ chapterNodeId: string; title: string; error: string }> = [];
  let completed = chapters.length - pending.length;

  if (pending.length === 0) {
    await store.saveProgress(projectDir, {
      status: 'completed', chaptersRead: chapters.length, totalChapters: chapters.length, error: undefined,
      failedChapters: [],
    });
    return initial;
  }

  for (const chapter of pending) {
    try {
      await recognizeChapterPlots(projectDir, projectId, chapter.id, resolver, {
        chaptersRead: completed,
        totalChapters: chapters.length,
      });
      completed += 1;
    } catch (error: unknown) {
      failedChapters.push({
        chapterNodeId: chapter.id,
        title: chapter.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await store.saveProgress(projectDir, {
    status: 'completed',
    chaptersRead: completed,
    totalChapters: chapters.length,
    error: failedChapters.length > 0 ? `${failedChapters.length} 章识别失败，可再次运行重试` : undefined,
    failedChapters,
  });
  return store.loadOutline(projectDir);
}

export async function addOutlinePlot(
  projectDir: string,
  projectId: string,
  chapterNodeId: string,
  title: string,
  summary: string,
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const chapter = outline.nodes.find((node) => node.id === chapterNodeId && node.kind === 'chapter');
  if (chapter === undefined) return outline;
  const siblings = outline.nodes.filter((node) => node.parentId === chapterNodeId);
  const plot: OutlineNode = {
    id: randomUUID(), parentId: chapterNodeId, order: siblings.length, kind: 'plot-beat',
    title: title.trim() || '未命名情节', summary: summary.trim(), characters: [], sources: chapter.sources,
    crossChapter: false, preserved: false, authorNote: '人工添加。',
  };
  const updated = {
    ...outline, projectId, version: outline.version + 1, createdAt: new Date().toISOString(),
    nodes: [...outline.nodes, plot], plotSequence: [...resolvePlotSequence(outline), plot.id],
  };
  await store.saveOutline(projectDir, updated);
  return updated;
}

export async function updateOutlinePlot(
  projectDir: string,
  projectId: string,
  plotNodeId: string,
  title: string,
  summary: string,
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const updated = {
    ...outline, projectId, version: outline.version + 1, createdAt: new Date().toISOString(),
    nodes: outline.nodes.map((node) => node.id === plotNodeId && node.kind === 'plot-beat'
      ? { ...node, title: title.trim() || node.title, summary: summary.trim() }
      : node),
  };
  await store.saveOutline(projectDir, updated);
  return updated;
}

export async function moveOutlinePlot(
  projectDir: string,
  projectId: string,
  plotNodeId: string,
  direction: 'up' | 'down',
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const sequence = [...resolvePlotSequence(outline)];
  const index = sequence.indexOf(plotNodeId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= sequence.length) return outline;
  [sequence[index], sequence[target]] = [sequence[target]!, sequence[index]!];
  const updated: LegacyOutline = {
    ...outline, projectId, version: outline.version + 1, createdAt: new Date().toISOString(), plotSequence: sequence,
  };
  await store.saveOutline(projectDir, updated);
  return updated;
}

export async function deleteOutlinePlot(
  projectDir: string,
  projectId: string,
  plotNodeId: string,
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const node = outline.nodes.find((item) => item.id === plotNodeId);
  if (node?.kind !== 'plot-beat' || node.preserved) return outline;
  const deleted = { node, deletedAt: new Date().toISOString() };
  const updated: LegacyOutline = {
    ...outline,
    projectId,
    version: outline.version + 1,
    createdAt: new Date().toISOString(),
    nodes: outline.nodes.filter((item) => item.id !== plotNodeId),
    plotSequence: resolvePlotSequence(outline).filter((id) => id !== plotNodeId),
    deletedPlots: [...(outline.deletedPlots ?? []), deleted],
  };
  await store.saveOutline(projectDir, updated);
  return updated;
}

export async function restoreDeletedPlot(
  projectDir: string,
  projectId: string,
  deletedPlotId: string,
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const snapshot = (outline.deletedPlots ?? []).find((item) => item.node.id === deletedPlotId);
  if (snapshot === undefined) return outline;
  const restoredNode = { ...snapshot.node, preserved: false };
  const updated: LegacyOutline = {
    ...outline,
    projectId,
    version: outline.version + 1,
    createdAt: new Date().toISOString(),
    nodes: [...outline.nodes, restoredNode],
    plotSequence: [...resolvePlotSequence(outline), restoredNode.id],
    deletedPlots: (outline.deletedPlots ?? []).filter((item) => item.node.id !== deletedPlotId),
  };
  await store.saveOutline(projectDir, updated);
  return updated;
}

export async function mergeOutlinePlots(
  projectDir: string,
  projectId: string,
  plotNodeIds: ReadonlyArray<string>,
  primaryChapterNodeId: string,
  title: string,
  summary: string,
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined || plotNodeIds.length < 2) return outline;
  const selected = outline.nodes.filter((node) => plotNodeIds.includes(node.id) && node.kind === 'plot-beat');
  // 保留情节已进入作者约束清单，不能在未同步清单的情况下被合并或丢失。
  if (selected.length < 2 || selected.some((node) => node.preserved) || !selected.some((node) => node.parentId === primaryChapterNodeId)) return outline;
  const primary = selected.find((node) => node.parentId === primaryChapterNodeId) ?? selected[0];
  if (primary === undefined) return outline;
  const sourceKeys = new Set<string>();
  const sources = selected.flatMap((node) => node.sources).filter((source) => {
    const key = `${source.nodeRef.id}:${source.label}:${source.quote ?? ''}`;
    if (sourceKeys.has(key)) return false;
    sourceKeys.add(key);
    return true;
  });
  const merged: OutlineNode = {
    ...primary,
    title: title.trim() || primary.title,
    summary: summary.trim() || primary.summary,
    sources,
    crossChapter: new Set(selected.map((node) => node.parentId)).size > 1,
  };
  const removedIds = new Set(selected.map((node) => node.id));
  const updated: LegacyOutline = {
    ...outline,
    projectId,
    version: outline.version + 1,
    createdAt: new Date().toISOString(),
    nodes: outline.nodes.map((node) => node.id === primary.id ? merged : node).filter((node) => !removedIds.has(node.id) || node.id === primary.id),
  };
  await store.saveOutline(projectDir, updated);
  return updated;
}

export async function addCrossChapterIssue(
  projectDir: string,
  projectId: string,
  plotNodeIds: ReadonlyArray<string>,
  kind: CrossChapterIssueKind,
  severity: CrossChapterIssueSeverity,
  description: string,
  evidence: ReadonlyArray<string>,
  authorNote: string | undefined,
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const plots = outline.nodes.filter((node) => plotNodeIds.includes(node.id) && node.kind === 'plot-beat');
  if (plots.length < 2) return outline;
  const now = new Date().toISOString();
  const issue: CrossChapterIssue = {
    id: randomUUID(),
    plotNodeIds: plots.map((plot) => plot.id),
    chapterNodeIds: Array.from(new Set(plots.map((plot) => plot.parentId).filter((id): id is string => id !== undefined))),
    kind,
    severity,
    description: description.trim(),
    evidence: evidence.map((item) => item.trim()).filter((item) => item.length > 0),
    status: 'open',
    ...(authorNote === undefined ? {} : { authorNote: authorNote.trim() }),
    createdAt: now,
    updatedAt: now,
  };
  const updated: LegacyOutline = { ...outline, projectId, version: outline.version + 1, createdAt: now, crossChapterIssues: [...(outline.crossChapterIssues ?? []), issue] };
  await store.saveOutline(projectDir, updated);
  return updated;
}

export async function updateCrossChapterIssue(
  projectDir: string,
  projectId: string,
  issueId: string,
  status: CrossChapterIssueStatus,
  authorNote: string | undefined,
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const now = new Date().toISOString();
  const updated: LegacyOutline = {
    ...outline,
    projectId,
    version: outline.version + 1,
    createdAt: now,
    crossChapterIssues: (outline.crossChapterIssues ?? []).map((issue) => issue.id === issueId
      ? { ...issue, status, ...(authorNote === undefined ? {} : { authorNote: authorNote.trim() }), updatedAt: now }
      : issue),
  };
  await store.saveOutline(projectDir, updated);
  return updated;
}

/**
 * 保存某情节的参谋讨论记录。
 *
 * 讨论记录与作者最终改写要求严格分开：
 * - 讨论记录存此处（advisorConversations）
 * - 最终改写要求存 PreservationManifest.plots[].authorNote（作者点击“保存本轮结论”时写入）
 */
export async function saveAdvisorConversation(
  projectDir: string,
  projectId: string,
  plotNodeId: string,
  turns: ReadonlyArray<AdvisorConversationTurn>,
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const now = new Date().toISOString();
  const existing = (outline.advisorConversations ?? []).filter((conv) => conv.plotNodeId !== plotNodeId);
  const conversation: AdvisorConversation = { plotNodeId, turns, updatedAt: now };
  const updated: LegacyOutline = {
    ...outline,
    projectId,
    version: outline.version + 1,
    createdAt: now,
    advisorConversations: [...existing, conversation],
  };
  await store.saveOutline(projectDir, updated);
  return updated;
}

/** 清空某情节的参谋讨论记录（“重新开始”时调用）。 */
export async function clearAdvisorConversation(
  projectDir: string,
  projectId: string,
  plotNodeId: string,
): Promise<LegacyOutline | undefined> {
  const outline = await store.loadOutline(projectDir);
  if (outline === undefined) return undefined;
  const now = new Date().toISOString();
  const updated: LegacyOutline = {
    ...outline,
    projectId,
    version: outline.version + 1,
    createdAt: now,
    advisorConversations: (outline.advisorConversations ?? []).filter((conv) => conv.plotNodeId !== plotNodeId),
  };
  await store.saveOutline(projectDir, updated);
  return updated;
}

/** 确保保留清单存在 */
async function ensureManifest(projectDir: string, projectId: string, outlineId: string): Promise<PreservationManifest> {
  const existing = await store.loadPreservations(projectDir);
  if (existing !== undefined) return existing;

  const manifest: PreservationManifest = {
    projectId,
    outlineId,
    plots: [],
    quotes: [],
    updatedAt: new Date().toISOString(),
  };
  await store.savePreservations(projectDir, manifest);
  return manifest;
}

export async function preservePlot(
  projectDir: string,
  projectId: string,
  outlineId: string,
  input: PreservePlotInput,
  nodeTitle: string,
): Promise<PreservedPlot> {
  const manifest = await ensureManifest(projectDir, projectId, outlineId);
  const existing = manifest.plots.find((p) => p.outlineNodeId === input.outlineNodeId);
  if (existing !== undefined) {
    if (input.authorNote !== undefined && input.authorNote.trim().length > 0 && input.authorNote !== existing.authorNote) {
      const revised = { ...existing, authorNote: input.authorNote.trim() };
      await store.savePreservations(projectDir, {
        ...manifest,
        plots: manifest.plots.map((plot) => plot.id === existing.id ? revised : plot),
        updatedAt: new Date().toISOString(),
      });
      return revised;
    }
    return existing;
  }

  // 找到大纲节点的来源
  const outline = await store.loadOutline(projectDir);
  const node = outline?.nodes.find((n) => n.id === input.outlineNodeId);
  const sourceNodeIds = node?.sources.map((s) => s.nodeRef.id) ?? [];

  const plot = store.createPreservedPlot(input.outlineNodeId, nodeTitle, sourceNodeIds, input.authorNote);

  const updated: PreservationManifest = {
    ...manifest,
    plots: [...manifest.plots, plot],
    updatedAt: new Date().toISOString(),
  };
  await store.savePreservations(projectDir, updated);

  // 更新大纲节点标记
  if (outline !== undefined) {
    const updatedOutline: LegacyOutline = {
      ...outline,
      nodes: outline.nodes.map((n) =>
        n.id === input.outlineNodeId ? { ...n, preserved: true } : n,
      ),
    };
    await store.saveOutline(projectDir, updatedOutline);
  }

  return plot;
}

export async function unpreservePlot(
  projectDir: string,
  projectId: string,
  outlineId: string,
  plotId: string,
): Promise<void> {
  const manifest = await ensureManifest(projectDir, projectId, outlineId);
  const plot = manifest.plots.find((p) => p.id === plotId);
  if (plot === undefined) return;

  const updated: PreservationManifest = {
    ...manifest,
    plots: manifest.plots.filter((p) => p.id !== plotId),
    updatedAt: new Date().toISOString(),
  };
  await store.savePreservations(projectDir, updated);

  // 更新大纲节点标记
  const outline = await store.loadOutline(projectDir);
  if (outline !== undefined) {
    const updatedOutline: LegacyOutline = {
      ...outline,
      nodes: outline.nodes.map((n) =>
        n.id === plot.outlineNodeId ? { ...n, preserved: false } : n,
      ),
    };
    await store.saveOutline(projectDir, updatedOutline);
  }
}

export async function preserveQuote(
  projectDir: string,
  projectId: string,
  outlineId: string,
  input: PreserveQuoteInput,
): Promise<PreservedQuote> {
  const manifest = await ensureManifest(projectDir, projectId, outlineId);
  const quote = store.createPreservedQuote(
    input.text,
    input.sourceNodeRef,
    input.sourceChapterTitle,
    input.outlineNodeId,
    input.authorNote,
  );

  const updated: PreservationManifest = {
    ...manifest,
    quotes: [...manifest.quotes, quote],
    updatedAt: new Date().toISOString(),
  };
  await store.savePreservations(projectDir, updated);

  return quote;
}

export async function unpreserveQuote(
  projectDir: string,
  projectId: string,
  outlineId: string,
  quoteId: string,
): Promise<void> {
  const manifest = await ensureManifest(projectDir, projectId, outlineId);
  const updated: PreservationManifest = {
    ...manifest,
    quotes: manifest.quotes.filter((q) => q.id !== quoteId),
    updatedAt: new Date().toISOString(),
  };
  await store.savePreservations(projectDir, updated);
}

export async function updateNote(
  projectDir: string,
  projectId: string,
  outlineId: string,
  itemId: string,
  kind: 'plot' | 'quote',
  note: string,
): Promise<void> {
  const manifest = await ensureManifest(projectDir, projectId, outlineId);

  const updated: PreservationManifest = {
    ...manifest,
    plots: kind === 'plot'
      ? manifest.plots.map((p) => p.id === itemId ? { ...p, authorNote: note } : p)
      : manifest.plots,
    quotes: kind === 'quote'
      ? manifest.quotes.map((q) => q.id === itemId ? { ...q, authorNote: note } : q)
      : manifest.quotes,
    updatedAt: new Date().toISOString(),
  };
  await store.savePreservations(projectDir, updated);
}
