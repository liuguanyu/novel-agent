/**
 * 局部重构正文写回磁盘 (I6 refactor-worker-runtime task 4.3)
 *
 * spec: refactor-worker-runtime「逐 hunk 裁决经纯函数拼回并写回磁盘正文」——拼回后的片段 MUST 仅替换
 * 其锚点 [from, to) 区间写回磁盘 Markdown，片段之外正文逐字节不变；MUST NOT 整章覆盖。
 *
 * 归属：正文读写属异步 I/O，归 Main（conventions §3）。正文仍是磁盘 Markdown，MUST NOT 存入 SQLite。
 * 本模块不含 diff/拼回业务（拼回由 core 纯函数 spliceAcceptedHunks 完成，调用方传入拼回后片段文本）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import type { FragmentAnchor } from '../../core/refactor/index.js';
import { getWorkspace, invalidateWorkspace } from '../novel-reader.js';
import { resolveContentPath } from '../workspace-manifest.js';

/** 写回失败原因（结构化，不静默产错）。 */
export type WritebackErrorReason = 'node-not-found' | 'anchor-out-of-range' | 'io-error';

export interface WritebackResult {
  ok: boolean;
  /** 失败原因（ok=false 时存在） */
  reason?: WritebackErrorReason;
  /** 成功时：写回后整章新正文长度（供校验/日志） */
  newContentLength?: number;
}

/**
 * 把拼回后的片段仅替换锚点区间写回磁盘。
 * - 读章节原文 → 校验锚点 [from, to) 落在正文范围内 → 仅替换该区间为 fragmentText → 写盘。
 * - 片段之外正文逐字节保留（绝不整章覆盖）。写盘后失效工作区缓存以便下次读到新内容。
 */
export async function writeBackRefactoredFragment(
  anchor: FragmentAnchor,
  fragmentText: string,
  rootDir?: string,
): Promise<WritebackResult> {
  const handle = rootDir !== undefined ? await getWorkspace(rootDir) : await getWorkspace();
  const abs = resolveContentPath(handle, anchor.node.id);
  if (abs === null) return { ok: false, reason: 'node-not-found' };

  let content: string;
  try {
    content = await readFile(abs, 'utf8');
  } catch {
    return { ok: false, reason: 'io-error' };
  }

  if (anchor.from < 0 || anchor.to > content.length || anchor.to < anchor.from) {
    return { ok: false, reason: 'anchor-out-of-range' };
  }

  const next = content.slice(0, anchor.from) + fragmentText + content.slice(anchor.to);
  try {
    await writeFile(abs, next, 'utf8');
  } catch {
    return { ok: false, reason: 'io-error' };
  }

  // 正文已变，失效缓存（章节树/hash remap 下次重扫）。
  invalidateWorkspace(rootDir);
  return { ok: true, newContentLength: next.length };
}
