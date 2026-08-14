/**
 * 故事资产快照文件持久化 (Roadmap M2)
 *
 * 参考 legacy-organization/store.ts 的原子写入模式。
 * 存储路径：projectDir/.novel-agent/story-asset-snapshot.json
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StoryAssetSnapshot } from '../../core/story-asset/index.js';

function snapshotFilePath(projectDir: string): string {
  return path.join(projectDir, '.novel-agent', 'story-asset-snapshot.json');
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

export async function loadStoryAssetSnapshot(projectDir: string): Promise<StoryAssetSnapshot | undefined> {
  try {
    const raw = await fs.readFile(snapshotFilePath(projectDir), 'utf-8');
    return JSON.parse(raw) as StoryAssetSnapshot;
  } catch {
    return undefined;
  }
}

export async function saveStoryAssetSnapshot(projectDir: string, snapshot: StoryAssetSnapshot): Promise<void> {
  await writeJsonAtomically(snapshotFilePath(projectDir), snapshot);
}
