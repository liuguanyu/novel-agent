/**
 * 新版大纲不可变版本历史持久化。
 *
 * 布局：.novel-agent/new-outlines/index.json + snapshots/<id>.json。
 * 每次生成、编辑、确认均追加一个版本，旧版本不覆盖。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NewOutline } from '../../core/new-outline/index.js';

export type NewOutlineLane = 'draft' | 'formal';

interface SnapshotHistoryEntry {
  readonly id: string;
  readonly version: number;
  readonly lane: NewOutlineLane;
  readonly createdAt: string;
}

interface NewOutlineIndex {
  readonly schemaVersion: 1;
  readonly currentDraftId?: string;
  readonly currentFormalId?: string;
  readonly history: ReadonlyArray<SnapshotHistoryEntry>;
}

function rootDir(projectDir: string): string { return path.join(projectDir, '.novel-agent', 'new-outlines'); }
function indexFilePath(projectDir: string): string { return path.join(rootDir(projectDir), 'index.json'); }
function snapshotFilePath(projectDir: string, id: string): string { return path.join(rootDir(projectDir), 'snapshots', `${id}.json`); }

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

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function parseIndex(raw: string): NewOutlineIndex {
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 1 || !('history' in value) || !Array.isArray(value.history)) {
    throw new Error('新版大纲索引已损坏或版本不受支持');
  }
  return value as NewOutlineIndex;
}

function parseSnapshot(raw: string): NewOutline {
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== 'object' || value === null) throw new Error('新版大纲快照不是对象');
  const candidate = value as Partial<NewOutline>;
  if (typeof candidate.id !== 'string' || typeof candidate.projectId !== 'string' || !Number.isInteger(candidate.version)
    || !Array.isArray(candidate.nodes) || typeof candidate.sourceSnapshotId !== 'string') {
    throw new Error('新版大纲快照格式不完整');
  }
  return candidate as NewOutline;
}

async function loadIndex(projectDir: string): Promise<NewOutlineIndex> {
  try {
    return parseIndex(await fs.readFile(indexFilePath(projectDir), 'utf-8'));
  } catch (error: unknown) {
    if (isEnoent(error)) return { schemaVersion: 1, history: [] };
    throw error;
  }
}

async function loadSnapshotById(projectDir: string, id: string): Promise<NewOutline> {
  try {
    return parseSnapshot(await fs.readFile(snapshotFilePath(projectDir, id), 'utf-8'));
  } catch (error: unknown) {
    if (isEnoent(error)) throw new Error(`新版大纲索引引用的快照不存在：${id}`);
    throw error;
  }
}

/** 当前工作草案；没有草案时返回当前正式版。 */
export async function loadNewOutline(projectDir: string): Promise<NewOutline | undefined> {
  const index = await loadIndex(projectDir);
  const id = index.currentDraftId ?? index.currentFormalId;
  return id === undefined ? undefined : loadSnapshotById(projectDir, id);
}

export async function loadFormalNewOutline(projectDir: string): Promise<NewOutline | undefined> {
  const index = await loadIndex(projectDir);
  return index.currentFormalId === undefined ? undefined : loadSnapshotById(projectDir, index.currentFormalId);
}

export async function nextNewOutlineVersion(projectDir: string): Promise<number> {
  const index = await loadIndex(projectDir);
  return Math.max(0, ...index.history.map((entry) => entry.version)) + 1;
}

/**
 * 追加不可变快照并移动对应 lane 指针。
 * expectedVersion 用于阻止基于过期 UI 状态覆盖更新。
 */
export async function saveNewOutline(
  projectDir: string,
  outline: NewOutline,
  lane: NewOutlineLane = 'draft',
  expectedVersion?: number,
): Promise<void> {
  const index = await loadIndex(projectDir);
  const currentId = lane === 'draft' ? index.currentDraftId : index.currentFormalId;
  const expectedId = expectedVersion !== undefined && lane === 'formal' ? index.currentDraftId : currentId;
  if (expectedVersion !== undefined) {
    const current = expectedId === undefined ? undefined : await loadSnapshotById(projectDir, expectedId);
    if (current?.version !== expectedVersion) throw new Error(`新版大纲版本冲突：当前版本为 ${current?.version ?? '无'}，请刷新后重试`);
  }
  if (index.history.some((entry) => entry.id === outline.id || entry.version === outline.version)) throw new Error('新版大纲快照 id 或版本重复');
  await writeJsonAtomically(snapshotFilePath(projectDir, outline.id), outline);
  const entry: SnapshotHistoryEntry = { id: outline.id, version: outline.version, lane, createdAt: outline.createdAt };
  const updated: NewOutlineIndex = {
    schemaVersion: 1,
    ...(lane === 'draft' ? { currentDraftId: outline.id } : (index.currentDraftId === undefined ? {} : { currentDraftId: index.currentDraftId })),
    ...(lane === 'formal' ? { currentFormalId: outline.id } : (index.currentFormalId === undefined ? {} : { currentFormalId: index.currentFormalId })),
    history: [...index.history, entry],
  };
  await writeJsonAtomically(indexFilePath(projectDir), updated);
}
