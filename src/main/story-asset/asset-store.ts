/**
 * 故事资产不可变快照持久化。
 *
 * 布局：.novel-agent/story-assets/index.json + snapshots/<id>.json。
 * 每次提炼、编辑、确认和发布均追加一个版本，旧版本不覆盖。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StoryAssetSnapshot } from '../../core/story-asset/index.js';

export type StoryAssetSnapshotLane = 'draft' | 'formal';

interface SnapshotHistoryEntry {
  readonly id: string;
  readonly version: number;
  readonly lane: StoryAssetSnapshotLane;
  readonly createdAt: string;
}

interface StoryAssetIndex {
  readonly schemaVersion: 1;
  readonly currentDraftId?: string;
  readonly currentFormalId?: string;
  readonly history: ReadonlyArray<SnapshotHistoryEntry>;
}

function rootDir(projectDir: string): string { return path.join(projectDir, '.novel-agent', 'story-assets'); }
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

function parseIndex(raw: string): StoryAssetIndex {
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 1 || !('history' in value) || !Array.isArray(value.history)) {
    throw new Error('故事资产索引已损坏或版本不受支持');
  }
  return value as StoryAssetIndex;
}

function parseSnapshot(raw: string): StoryAssetSnapshot {
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== 'object' || value === null) throw new Error('故事资产快照不是对象');
  const candidate = value as Partial<StoryAssetSnapshot>;
  if (typeof candidate.id !== 'string' || typeof candidate.projectId !== 'string' || !Number.isInteger(candidate.version)
    || !Array.isArray(candidate.plotThreads) || !Array.isArray(candidate.characters) || !Array.isArray(candidate.relations)
    || !Array.isArray(candidate.arcs) || !Array.isArray(candidate.foreshadowings)) {
    throw new Error('故事资产快照格式不完整');
  }
  return candidate as StoryAssetSnapshot;
}

async function loadIndex(projectDir: string): Promise<StoryAssetIndex> {
  try {
    return parseIndex(await fs.readFile(indexFilePath(projectDir), 'utf-8'));
  } catch (error: unknown) {
    if (isEnoent(error)) return { schemaVersion: 1, history: [] };
    throw error;
  }
}

async function loadSnapshotById(projectDir: string, id: string): Promise<StoryAssetSnapshot> {
  try {
    return parseSnapshot(await fs.readFile(snapshotFilePath(projectDir, id), 'utf-8'));
  } catch (error: unknown) {
    if (isEnoent(error)) throw new Error(`故事资产索引引用的快照不存在：${id}`);
    throw error;
  }
}

/** 当前工作草案；没有草案时返回当前正式版。 */
export async function loadStoryAssetSnapshot(projectDir: string): Promise<StoryAssetSnapshot | undefined> {
  const index = await loadIndex(projectDir);
  const id = index.currentDraftId ?? index.currentFormalId;
  return id === undefined ? undefined : loadSnapshotById(projectDir, id);
}

export async function loadFormalStoryAssetSnapshot(projectDir: string): Promise<StoryAssetSnapshot | undefined> {
  const index = await loadIndex(projectDir);
  return index.currentFormalId === undefined ? undefined : loadSnapshotById(projectDir, index.currentFormalId);
}

export async function nextStoryAssetVersion(projectDir: string): Promise<number> {
  const index = await loadIndex(projectDir);
  return Math.max(0, ...index.history.map((entry) => entry.version)) + 1;
}

/**
 * 追加不可变快照并移动对应 lane 指针。
 * expectedVersion 用于阻止基于过期 UI 状态覆盖更新。
 */
export async function saveStoryAssetSnapshot(
  projectDir: string,
  snapshot: StoryAssetSnapshot,
  lane: StoryAssetSnapshotLane = 'draft',
  expectedVersion?: number,
): Promise<void> {
  const index = await loadIndex(projectDir);
  const currentId = lane === 'draft' ? index.currentDraftId : index.currentFormalId;
  const expectedId = expectedVersion !== undefined && lane === 'formal' ? index.currentDraftId : currentId;
  if (expectedVersion !== undefined) {
    const current = expectedId === undefined ? undefined : await loadSnapshotById(projectDir, expectedId);
    if (current?.version !== expectedVersion) throw new Error(`故事资产版本冲突：当前版本为 ${current?.version ?? '无'}，请刷新后重试`);
  }
  if (index.history.some((entry) => entry.id === snapshot.id || entry.version === snapshot.version)) throw new Error('故事资产快照 id 或版本重复');
  await writeJsonAtomically(snapshotFilePath(projectDir, snapshot.id), snapshot);
  const entry: SnapshotHistoryEntry = { id: snapshot.id, version: snapshot.version, lane, createdAt: snapshot.createdAt };
  const updated: StoryAssetIndex = {
    schemaVersion: 1,
    ...(lane === 'draft' ? { currentDraftId: snapshot.id } : (index.currentDraftId === undefined ? {} : { currentDraftId: index.currentDraftId })),
    ...(lane === 'formal' ? { currentFormalId: snapshot.id } : (index.currentFormalId === undefined ? {} : { currentFormalId: index.currentFormalId })),
    history: [...index.history, entry],
  };
  await writeJsonAtomically(indexFilePath(projectDir), updated);
}
