/**
 * 老书整理 v2 — 文件级持久化存储
 *
 * MVP 1 采用 JSON 文件存储大纲和保留内容，避免过早引入新 SQLite 表。
 * 后续可平滑迁移到 SQLite。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NodeRef } from '../../core/manuscript/index.js';
import type {
  LegacyOutline,
  OutlineNode,
  OutlineGenerationProgress,
} from '../../core/legacy-organization/index.js';
import type {
  PreservationManifest,
  PreservedPlot,
  PreservedQuote,
} from '../../core/legacy-organization/index.js';

/* ── 文件路径 ──────────────────────────────────────────────────── */

function outlineFilePath(projectDir: string): string {
  return path.join(projectDir, '.novel-agent', 'legacy-outline.json');
}

function preservationFilePath(projectDir: string): string {
  return path.join(projectDir, '.novel-agent', 'legacy-preservation.json');
}

function progressFilePath(projectDir: string): string {
  return path.join(projectDir, '.novel-agent', 'legacy-outline-progress.json');
}

/* ── 大纲持久化 ────────────────────────────────────────────────── */

export async function loadOutline(projectDir: string): Promise<LegacyOutline | undefined> {
  try {
    const raw = await fs.readFile(outlineFilePath(projectDir), 'utf-8');
    return JSON.parse(raw) as LegacyOutline;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
  } catch (error: unknown) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function saveOutline(projectDir: string, outline: LegacyOutline): Promise<void> {
  await writeJsonAtomically(outlineFilePath(projectDir), outline);
}

/* ── 保留内容持久化 ────────────────────────────────────────────── */

export async function loadPreservations(projectDir: string): Promise<PreservationManifest | undefined> {
  try {
    const raw = await fs.readFile(preservationFilePath(projectDir), 'utf-8');
    return JSON.parse(raw) as PreservationManifest;
  } catch {
    return undefined;
  }
}

export async function savePreservations(projectDir: string, manifest: PreservationManifest): Promise<void> {
  await writeJsonAtomically(preservationFilePath(projectDir), manifest);
}

/* ── 进度持久化 ────────────────────────────────────────────────── */

export async function loadProgress(projectDir: string): Promise<OutlineGenerationProgress> {
  try {
    const raw = await fs.readFile(progressFilePath(projectDir), 'utf-8');
    return JSON.parse(raw) as OutlineGenerationProgress;
  } catch {
    return { status: 'idle', chaptersRead: undefined, totalChapters: undefined, error: undefined };
  }
}

export async function saveProgress(projectDir: string, progress: OutlineGenerationProgress): Promise<void> {
  await writeJsonAtomically(progressFilePath(projectDir), progress);
}

/* ── 辅助 ──────────────────────────────────────────────────────── */

export function createOutlineNode(
  id: string,
  kind: OutlineNode['kind'],
  title: string,
  order: number,
  parentId?: string,
): OutlineNode {
  return {
    id,
    parentId,
    order,
    kind,
    title,
    summary: '',
    characters: [],
    sources: [],
    crossChapter: false,
    preserved: false,
    authorNote: undefined,
  };
}

export function createPreservedPlot(
  outlineNodeId: string,
  title: string,
  sourceNodeIds: ReadonlyArray<string>,
  authorNote?: string,
): PreservedPlot {
  return {
    id: randomUUID(),
    outlineNodeId,
    title,
    sourceRefs: sourceNodeIds.map((id) => ({ id, kind: 'chapter' } as unknown as NodeRef)),
    authorNote,
    preservedAt: new Date().toISOString(),
  };
}

export function createPreservedQuote(
  text: string,
  sourceNodeId: string,
  sourceChapterTitle: string,
  outlineNodeId?: string,
  authorNote?: string,
  recommended = false,
): PreservedQuote {
  return {
    id: randomUUID(),
    text,
    sourceNodeRef: { id: sourceNodeId, kind: 'chapter' } as unknown as NodeRef,
    sourceChapterTitle,
    outlineNodeId,
    recommended,
    authorNote,
    preservedAt: new Date().toISOString(),
  };
}
