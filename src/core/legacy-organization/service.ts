/**
 * 老书整理 v2 — 领域服务接口
 *
 * 定义旧稿大纲生成和保留内容管理的核心契约。
 * Main 进程负责实现，Renderer 通过 IPC 调用。
 */

import type { LegacyOutline, DeletedPlotSnapshot } from './outline.js';
import type { PreservationManifest, PreservedPlot, PreservedQuote } from './preservation.js';

/* ── 大纲生成 ──────────────────────────────────────────────────── */

/** 大纲生成进度状态 */
export type OutlineGenerationStatus = 'idle' | 'reading' | 'structuring' | 'analyzing' | 'completed' | 'failed';

/** 大纲生成进度 */
export interface OutlineGenerationProgress {
  readonly status: OutlineGenerationStatus;
  /** 已读取的章节数 */
  readonly chaptersRead: number | undefined;
  /** 总章节数 */
  readonly totalChapters: number | undefined;
  /** 失败原因（status === 'failed' 时） */
  readonly error: string | undefined;
  /** 批量识别时正在处理的章节；旧进度文件没有这些字段时保持兼容。 */
  readonly currentChapterTitle?: string;
  readonly currentSegment?: number;
  readonly totalSegments?: number;
  readonly failedChapters?: ReadonlyArray<{ chapterNodeId: string; title: string; error: string }>;
}

/** 大纲生成结果 */
export interface OutlineGenerationResult {
  readonly outline: LegacyOutline;
  /** 推荐的候选关键原文 */
  readonly recommendedQuotes: ReadonlyArray<PreservedQuote>;
  /** 整理出的人物列表（名称） */
  readonly detectedCharacters: ReadonlyArray<string>;
  /** 卷数 */
  readonly volumeCount: number;
  /** 主要情节数 */
  readonly plotCount: number;
}

/* ── 保留内容管理 ───────────────────────────────────────────────── */

export interface DeletedPlotsResult {
  readonly plots: ReadonlyArray<DeletedPlotSnapshot>;
}

export interface PreservePlotInput {
  readonly outlineNodeId: string;
  readonly authorNote: string | undefined;
}

export interface PreserveQuoteInput {
  readonly text: string;
  readonly sourceNodeRef: string;
  readonly sourceChapterTitle: string;
  readonly outlineNodeId: string | undefined;
  readonly authorNote: string | undefined;
}

export interface UnpreserveInput {
  readonly itemId: string;
  readonly kind: 'plot' | 'quote';
}

/* ── 服务接口 ──────────────────────────────────────────────────── */

export interface LegacyOrganizationReader {
  /** 获取最新的旧稿大纲 */
  getLatestOutline(projectId: string): Promise<LegacyOutline | undefined>;

  /** 获取保留内容清单 */
  getPreservationManifest(projectId: string): Promise<PreservationManifest | undefined>;

  /** 获取大纲生成进度 */
  getGenerationProgress(projectId: string): Promise<OutlineGenerationProgress>;
}

export interface LegacyOrganizationWriter {
  /** 开始生成大纲（异步后台任务） */
  startOutlineGeneration(projectId: string): Promise<void>;

  /** 保留情节 */
  preservePlot(projectId: string, input: PreservePlotInput): Promise<PreservedPlot>;

  /** 取消保留情节 */
  unpreservePlot(projectId: string, plotId: string): Promise<void>;

  /** 保留原文 */
  preserveQuote(projectId: string, input: PreserveQuoteInput): Promise<PreservedQuote>;

  /** 取消保留原文 */
  unpreserveQuote(projectId: string, quoteId: string): Promise<void>;

  /** 更新保留项的作者备注 */
  updatePreservationNote(
    projectId: string,
    itemId: string,
    kind: 'plot' | 'quote',
    note: string,
  ): Promise<void>;
}
