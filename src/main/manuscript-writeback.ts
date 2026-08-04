import { writeFile } from 'node:fs/promises';
import { getWorkspace, invalidateWorkspace } from './novel-reader.js';
import { resolveContentPath } from './workspace-manifest.js';

export interface ChapterDraftWritebackResult {
  readonly ok: boolean;
  readonly reason?: 'node-not-found' | 'io-error';
  readonly contentLength?: number;
}

/**
 * 将已通过自动审校、等待作者继续验收的章节草稿写入稳定 chapter node。
 * 该接口只服务新书正文生成；旧书修订仍必须走片段 diff/hunk 写回，禁止借此整章覆盖。
 */
export async function writeChapterDraft(
  nodeId: string,
  content: string,
  rootDir?: string,
): Promise<ChapterDraftWritebackResult> {
  const handle = rootDir === undefined ? await getWorkspace() : await getWorkspace(rootDir);
  const abs = resolveContentPath(handle, nodeId);
  if (abs === null) return { ok: false, reason: 'node-not-found' };
  try {
    await writeFile(abs, content, 'utf8');
  } catch {
    return { ok: false, reason: 'io-error' };
  }
  invalidateWorkspace(rootDir);
  return { ok: true, contentLength: content.length };
}
