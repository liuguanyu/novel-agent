/**
 * 真实小说读盘 — manifest-backed (persistence-sqlite tasks 2.1–2.4)
 *
 * 从 I1 的「相对路径即 id」升级为「工作区 manifest 稳定 id → Markdown 文件」：
 *  - 首次启动无工作区文件时，自动从现有 `津门余味/` 导入并落盘 workspace.json / manuscript.json；
 *  - 章节树/正文均经 manifest 稳定 id 解析，重开后 id 不变（manuscript-model 稳定标识符）。
 *
 * 归属：读盘属异步 I/O，归 Main（conventions §3）。产出可序列化 DTO，经 IPC 回 Renderer。
 * 正文仍是磁盘 Markdown 文件，MUST NOT 存入 SQLite（project-storage 契约）。
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChapterTreeDto, ChapterContentDto } from '../shared/ipc/index.js';
import {
  openOrImportWorkspace,
  projectChapterTree,
  resolveContentPath,
  type WorkspaceHandle,
} from './workspace-manifest.js';

/** 默认工作区根目录（项目根内示例小说，相对 cwd）。 */
export const DEFAULT_NOVEL_DIR = resolve(process.cwd(), '津门余味');

/** 进程内工作区句柄缓存（避免每次查询都重扫盘）。key=rootDir。 */
const handleCache = new Map<string, WorkspaceHandle>();

/** 取（或首次打开/导入）工作区句柄。 */
export async function getWorkspace(
  rootDir: string = DEFAULT_NOVEL_DIR,
): Promise<WorkspaceHandle> {
  const cached = handleCache.get(rootDir);
  if (cached !== undefined) return cached;
  const handle = await openOrImportWorkspace(rootDir);
  handleCache.set(rootDir, handle);
  return handle;
}

/** 丢弃缓存（供外部文件变化后强制重扫）。 */
export function invalidateWorkspace(rootDir: string = DEFAULT_NOVEL_DIR): void {
  handleCache.delete(rootDir);
}

/** 从工作区 manifest 构造章节树 DTO（节点 id = 稳定 id）。 */
export async function readChapterTree(
  rootDir: string = DEFAULT_NOVEL_DIR,
): Promise<ChapterTreeDto> {
  const handle = await getWorkspace(rootDir);
  return projectChapterTree(handle);
}

/** 按 manifest 顺序列出所有章节节点 id（卷节点/无正文节点排除）。 */
export async function readManifestChapterIds(
  rootDir: string = DEFAULT_NOVEL_DIR,
): Promise<ReadonlyArray<string>> {
  const handle = await getWorkspace(rootDir);
  return handle.manifest.entries
    .filter((entry) => entry.kind === 'chapter' && entry.relativePath !== null)
    .sort((a, b) => {
      const parent = (a.parentId ?? '').localeCompare(b.parentId ?? '');
      return parent !== 0 ? parent : a.order - b.order;
    })
    .map((entry) => entry.id);
}

/**
 * 以稳定 nodeId 取正文。卷节点或未映射节点返回空串；章节点读取对应 `.md` 原文。
 * 路径解析已在 workspace 层做目录穿越校验。
 */
export async function readChapterContent(
  nodeId: string,
  rootDir: string = DEFAULT_NOVEL_DIR,
): Promise<ChapterContentDto> {
  const handle = await getWorkspace(rootDir);
  const abs = resolveContentPath(handle, nodeId);
  if (abs === null) return { nodeId, content: '' };
  const content = await readFile(abs, 'utf8');
  return { nodeId, content };
}
