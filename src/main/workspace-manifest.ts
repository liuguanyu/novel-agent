/**
 * 工作区文件层持久化 (persistence-sqlite tasks 1.1–1.6, 2.4)
 *
 * spec: workspace-persistence / project-storage / workspace-model / storage-layout。
 *
 * 职责：把一个「现有小说目录」升级为「可重开的工作区」——
 *  - `workspace.json`：WorkspaceMetadata（书名/体裁/语言…）。
 *  - `manuscript.json`：ManuscriptManifest（章节树 + 稳定 id + id↔相对路径映射 + contentHash）。
 *  - 正文仍是磁盘上的 Markdown 文件，MUST NOT 存入 SQLite（project-storage 契约）。
 *
 * 稳定 id：首次导入时用 randomUUID 生成，写入 manifest；重开时从 manifest 恢复，保持不变
 *（manuscript-model「稳定唯一标识符」）。手改文件后经 contentHash 做鲁棒 remap（不静默错配）。
 *
 * 归属：读写盘属异步 I/O，归 Main（conventions §3）。本文件产出可序列化结构与 DTO 投影。
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, relative, sep } from 'node:path';
import {
  WORKSPACE_LAYOUT,
  type ManifestEntry,
  type ManuscriptManifest,
  type RemapDetection,
  type RemapIssue,
} from '../core/storage/index.js';
import {
  workspaceMetadataSchema,
  type WorkspaceMetadata,
} from '../core/workspace/index.js';
import type { ChapterTreeDto, ChapterTreeNodeDto } from '../shared/ipc/index.js';

/** 当前 manifest 结构版本。 */
const MANIFEST_VERSION = 1;

/** 非正文文件名（导入时排除）。 */
const NON_PROSE_FILES: ReadonlySet<string> = new Set(['自省报告.md']);

/** 工作区内文件排除集（自身元数据文件不应被当作正文/卷）。 */
const RESERVED_FILES: ReadonlySet<string> = new Set([
  WORKSPACE_LAYOUT.metadataFile,
  WORKSPACE_LAYOUT.manifestFile,
]);

/** 打开的工作区句柄：内存态的 metadata + manifest + 本次打开的 remap 体检结果。 */
export interface WorkspaceHandle {
  /** 工作区根目录（绝对路径） */
  rootDir: string;
  metadata: WorkspaceMetadata;
  manifest: ManuscriptManifest;
  /** 本次打开时的映射体检（consistent=true 表示无需干预） */
  remap: RemapDetection;
}

/** 从章节文件名投影展示标题：去 `.md`，`第N章-标题` → `标题`（保留原文兜底）。 */
function chapterTitle(fileName: string): string {
  const withoutExt = fileName.replace(/\.md$/i, '');
  const dashIdx = withoutExt.indexOf('-');
  if (dashIdx > 0 && dashIdx < withoutExt.length - 1) {
    return withoutExt.slice(dashIdx + 1);
  }
  return withoutExt;
}

/** 从「第N章/第N卷…」名提取序号用于排序；无法解析回退极大值（排末尾，稳定）。 */
function chineseOrder(name: string): number {
  const numerals: Readonly<Record<string, number>> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const match = /^第([零一二三四五六七八九十百]+)[章卷]/.exec(name);
  if (match === null || match[1] === undefined) return Number.MAX_SAFE_INTEGER;
  let section = 0;
  for (const ch of match[1]) {
    if (ch === '十') section = (section === 0 ? 1 : section) * 10;
    else if (ch === '百') section = (section === 0 ? 1 : section) * 100;
    else {
      const digit = numerals[ch];
      if (digit !== undefined) section += digit;
    }
  }
  return section === 0 ? Number.MAX_SAFE_INTEGER : section;
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

async function listEntries(dir: string): Promise<DirEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  return dirents.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
}

/** 内容指纹：正文文件字节的 sha256（用于按内容而非路径重定位）。 */
async function hashFile(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash('sha256').update(buf).digest('hex');
}

/** 校验并规整相对路径：解析后 MUST 仍位于工作区根内（防目录穿越）。返回绝对路径或 null。 */
function safeResolveInRoot(rootDir: string, relativePath: string): string | null {
  const target = resolve(rootDir, relativePath);
  const rootWithSep = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  if (target !== rootDir && !target.startsWith(rootWithSep)) return null;
  return target;
}

/**
 * 扫描现有小说目录，生成 metadata + manifest（首次导入）。
 * 卷=子目录、章=`.md` 文件；排除保留文件与非正文文件。稳定 id 用 randomUUID。
 */
export async function importFromDirectory(
  rootDir: string,
): Promise<{ metadata: WorkspaceMetadata; manifest: ManuscriptManifest }> {
  const rootEntries = await listEntries(rootDir);

  const volumeDirs = rootEntries
    .filter((e) => e.isDirectory)
    .map((e) => e.name)
    .sort((a, b) => {
      const d = chineseOrder(a) - chineseOrder(b);
      return d !== 0 ? d : a.localeCompare(b, 'zh');
    });

  const entries: ManifestEntry[] = [];
  let volumeOrder = 0;

  for (const volumeName of volumeDirs) {
    const volumeId = randomUUID();
    entries.push({
      id: volumeId,
      kind: 'volume',
      title: volumeName,
      order: volumeOrder++,
      parentId: null,
      relativePath: null,
    });

    const volumeDir = join(rootDir, volumeName);
    const chapterFiles = (await listEntries(volumeDir))
      .filter((e) => !e.isDirectory)
      .filter((e) => e.name.toLowerCase().endsWith('.md'))
      .filter((e) => !NON_PROSE_FILES.has(e.name) && !RESERVED_FILES.has(e.name))
      .map((e) => e.name)
      .sort((a, b) => {
        const d = chineseOrder(a) - chineseOrder(b);
        return d !== 0 ? d : a.localeCompare(b, 'zh');
      });

    let chapterOrder = 0;
    for (const fileName of chapterFiles) {
      const rel = `${volumeName}/${fileName}`;
      const abs = join(rootDir, rel);
      entries.push({
        id: randomUUID(),
        kind: 'chapter',
        title: chapterTitle(fileName),
        order: chapterOrder++,
        parentId: volumeId,
        relativePath: rel,
        contentHash: await hashFile(abs),
      });
    }
  }

  const title = rootDir.split(sep).filter((s) => s.length > 0).pop() ?? '未命名';
  const metadata: WorkspaceMetadata = {
    title,
    genre: '未分类',
    language: 'zh-CN',
  };
  const manifest: ManuscriptManifest = { version: MANIFEST_VERSION, entries };
  return { metadata, manifest };
}

/** 读取 workspace.json（不存在返回 null）。 */
async function loadMetadata(rootDir: string): Promise<WorkspaceMetadata | null> {
  const file = join(rootDir, WORKSPACE_LAYOUT.metadataFile);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  const parsed = workspaceMetadataSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    title: d.title,
    genre: d.genre,
    language: d.language,
    ...(d.synopsis !== undefined ? { synopsis: d.synopsis } : {}),
    ...(d.targetAudience !== undefined ? { targetAudience: d.targetAudience } : {}),
    ...(d.tone !== undefined ? { tone: d.tone } : {}),
    ...(d.extra !== undefined ? { extra: d.extra } : {}),
  };
}

/** 读取 manuscript.json（不存在或结构不符返回 null）。 */
async function loadManifest(rootDir: string): Promise<ManuscriptManifest | null> {
  const file = join(rootDir, WORKSPACE_LAYOUT.manifestFile);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const obj: unknown = JSON.parse(raw);
    if (
      typeof obj === 'object' &&
      obj !== null &&
      'version' in obj &&
      'entries' in obj &&
      Array.isArray((obj as { entries: unknown }).entries)
    ) {
      return obj as ManuscriptManifest;
    }
  } catch {
    // fallthrough
  }
  return null;
}

/** 写入 workspace.json + manuscript.json（可读 JSON，Git 友好）。 */
export async function persistWorkspace(
  rootDir: string,
  metadata: WorkspaceMetadata,
  manifest: ManuscriptManifest,
): Promise<void> {
  await writeFile(
    join(rootDir, WORKSPACE_LAYOUT.metadataFile),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(rootDir, WORKSPACE_LAYOUT.manifestFile),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

/**
 * 打开工作区时的鲁棒映射体检（task 1.6）。
 * 对每条章节条目：路径存在且 hash 匹配 → clean；路径缺失但 hash 在别处唯一命中 → hash-moved；
 * 否则 → missing-file。磁盘上未登记的 `.md` → orphan-file。MUST NOT 静默错配。
 */
export async function detectRemap(
  rootDir: string,
  manifest: ManuscriptManifest,
): Promise<RemapDetection> {
  const chapterEntries = manifest.entries.filter(
    (e) => e.kind === 'chapter' && e.relativePath !== null,
  );

  // 收集磁盘上全部 .md 的相对路径与 hash（供 hash-moved / orphan 检测）。
  const diskFiles = new Map<string, string>(); // relPath -> hash
  const volumeDirs = (await listEntries(rootDir)).filter((e) => e.isDirectory);
  for (const vol of volumeDirs) {
    const volDir = join(rootDir, vol.name);
    for (const f of await listEntries(volDir)) {
      if (f.isDirectory || !f.name.toLowerCase().endsWith('.md')) continue;
      if (NON_PROSE_FILES.has(f.name) || RESERVED_FILES.has(f.name)) continue;
      const rel = `${vol.name}/${f.name}`;
      diskFiles.set(rel, await hashFile(join(rootDir, rel)));
    }
  }

  const issues: RemapIssue[] = [];
  const claimedPaths = new Set<string>();

  for (const entry of chapterEntries) {
    const rel = entry.relativePath;
    if (rel === null) continue;
    const abs = safeResolveInRoot(rootDir, rel);
    const onDisk = abs !== null ? diskFiles.get(rel) : undefined;

    if (onDisk !== undefined) {
      claimedPaths.add(rel);
      if (entry.contentHash !== undefined && entry.contentHash !== onDisk) {
        // 路径在但内容变了：正文被外部编辑（不属错配，仅记录以便刷新 hash）。
        issues.push({
          kind: 'hash-moved',
          nodeId: entry.id,
          expectedPath: rel,
          actualPath: rel,
          message: `章节「${entry.title}」正文已在系统外被修改（内容指纹变化）。`,
        });
      }
      continue;
    }

    // 路径缺失：尝试按 hash 在别处唯一命中。
    if (entry.contentHash !== undefined) {
      const matches = [...diskFiles.entries()].filter(([, h]) => h === entry.contentHash);
      if (matches.length === 1 && matches[0] !== undefined) {
        const [movedPath] = matches[0];
        claimedPaths.add(movedPath);
        issues.push({
          kind: 'hash-moved',
          nodeId: entry.id,
          expectedPath: rel,
          actualPath: movedPath,
          message: `章节「${entry.title}」疑似被移动/重命名至 ${movedPath}（内容指纹一致）。`,
        });
        continue;
      }
    }

    issues.push({
      kind: 'missing-file',
      nodeId: entry.id,
      expectedPath: rel,
      message: `章节「${entry.title}」的正文文件缺失，且无法按内容唯一定位。`,
    });
  }

  // orphan：磁盘上存在但无 manifest 认领。
  for (const [rel] of diskFiles) {
    if (!claimedPaths.has(rel)) {
      issues.push({
        kind: 'orphan-file',
        nodeId: null,
        actualPath: rel,
        message: `发现未登记的正文文件 ${rel}（清单中无对应稳定 id）。`,
      });
    }
  }

  return { consistent: issues.length === 0, issues };
}

/**
 * 打开工作区：若已有 manifest 则加载 + remap 体检；否则从目录导入并落盘。
 * 保证 I1 冒烟路径继续可用（首次启动自动导入现有 `津门余味/`）。
 */
export async function openOrImportWorkspace(rootDir: string): Promise<WorkspaceHandle> {
  const existingManifest = await loadManifest(rootDir);
  const existingMetadata = await loadMetadata(rootDir);

  if (existingManifest !== null && existingMetadata !== null) {
    const remap = await detectRemap(rootDir, existingManifest);
    return { rootDir, metadata: existingMetadata, manifest: existingManifest, remap };
  }

  const { metadata, manifest } = await importFromDirectory(rootDir);
  await persistWorkspace(rootDir, metadata, manifest);
  return { rootDir, metadata, manifest, remap: { consistent: true, issues: [] } };
}

/** 将 manifest 投影为章节树 DTO（节点 id = 稳定 manifest id）。 */
export function projectChapterTree(handle: WorkspaceHandle): ChapterTreeDto {
  const byParent = new Map<string | null, ManifestEntry[]>();
  for (const entry of handle.manifest.entries) {
    const bucket = byParent.get(entry.parentId) ?? [];
    bucket.push(entry);
    byParent.set(entry.parentId, bucket);
  }

  const toNode = (entry: ManifestEntry): ChapterTreeNodeDto => {
    const children = (byParent.get(entry.id) ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(toNode);
    return {
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      order: entry.order,
      children,
    };
  };

  const roots = (byParent.get(null) ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(toNode);

  return { title: handle.metadata.title, roots };
}

/**
 * 以稳定 nodeId 解析正文绝对路径（防目录穿越）。
 * 卷节点或未映射节点返回 null（调用方回空正文）。
 */
export function resolveContentPath(handle: WorkspaceHandle, nodeId: string): string | null {
  const entry = handle.manifest.entries.find((e) => e.id === nodeId);
  if (entry === undefined || entry.relativePath === null) return null;
  return safeResolveInRoot(handle.rootDir, entry.relativePath);
}

/** 供诊断/日志：把绝对路径转为相对工作区根的展示串。 */
export function toRelative(handle: WorkspaceHandle, absPath: string): string {
  return relative(handle.rootDir, absPath);
}
