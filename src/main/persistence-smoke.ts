/**
 * 持久化冒烟脚本 (persistence-sqlite tasks 6.3/6.4/6.5)
 *
 * 非产品代码：不引入测试框架（项目无 test runner），以独立可执行脚本验证三条端到端路径：
 *   1) SQLite migration + checkpoint/fact version/entity 写入 → 关闭重开 → 读回一致（6.3）。
 *   2) 工作区首次导入 `津门余味/` → 重开 id 不变 → 读回真实章节正文（6.4）。
 *   3) 改名一章文件后，remap 检测返回结构化 hash-moved，不静默错配（6.5）。
 *
 * 编译进 out/main/ 后用 `node out/main/persistence-smoke.js` 运行。
 * 全程不依赖 Electron；用临时目录/临时 DB，跑完清理，不污染源 `津门余味/`。
 */

import { mkdtemp, cp, rename, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, SqliteCheckpointer, SqliteFactStore } from './db/index.js';
import {
  openOrImportWorkspace,
  detectRemap,
  projectChapterTree,
  resolveContentPath,
} from './workspace-manifest.js';
import type { NovelState } from '../core/orchestration/index.js';
import {
  asEntityId,
  asCheckpointId,
  type Entity,
  type Provenance,
} from '../core/story-bible/index.js';
import { asNodeId } from '../core/manuscript/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** 构造一个最小合法 Provenance（锚定到任意节点，供实体入库）。 */
function sampleProvenance(): Provenance {
  return {
    sources: [
      {
        location: { id: asNodeId('smoke-chapter'), kind: 'chapter' },
        quote: '顾长风缓缓抬手',
        confidence: 0.8,
      },
    ],
  };
}

/** 构造一个最小合法 NovelState（供 checkpoint 快照）。 */
function sampleState(draft: string): NovelState {
  return {
    currentChapterId: { id: asNodeId('smoke-chapter'), kind: 'chapter' },
    currentDraft: draft,
    chatHistory: [{ role: 'user', content: '继续写' }],
    activeBugs: [],
    currentAction: 'idle',
    agentStatus: 'idle',
    contextRefs: { facts: null, corpus: null },
  };
}

/** 6.3：SQLite migration + checkpoint/fact version/entity 写入 → 关闭重开 → 读回一致。 */
async function smokeSqlite(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-sqlite-'));
  const dbPath = join(dir, 'smoke.db');

  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  check('SQLite 可用 + migration 应用', true);

  const entity: Entity = {
    id: asEntityId('ent-gu-changfeng'),
    type: 'person',
    canonicalName: '顾长风',
    aliasSet: {
      aliases: ['顾长风', '顾兄弟'],
      status: 'confirmed',
      provenance: sampleProvenance(),
    },
    attributes: [
      { key: 'handedness', value: 'left', status: 'inferred', provenance: sampleProvenance() },
    ],
    status: 'inferred',
    provenance: sampleProvenance(),
  };

  let checkpointId: string;
  {
    const checkpointer = new SqliteCheckpointer(opened.db);
    const factStore = new SqliteFactStore(opened.db);

    const cp1 = await checkpointer.commit('writer', sampleState('第一稿'), null);
    const cp2 = await checkpointer.commit('reviewer', sampleState('第二稿'), cp1.id);
    checkpointId = cp2.id;

    const version = await factStore.appendVersion();
    await factStore.putEntity(version, entity, cp2.id);

    await opened.db.close();
  }

  // 关闭后重开：验证持久化落盘、读回一致。
  const reopened = await openDatabase(dbPath);
  if (!reopened.ok) {
    check('重开数据库', false, `${reopened.reason}: ${reopened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }

  const checkpointer = new SqliteCheckpointer(reopened.db);
  const factStore = new SqliteFactStore(reopened.db);

  const readCp = await checkpointer.get(asCheckpointId(checkpointId));
  check(
    'checkpoint 读回一致',
    readCp !== null && readCp.state.currentDraft === '第二稿' && readCp.atNode === 'reviewer',
    readCp === null ? '未找到' : `draft=${readCp.state.currentDraft}`,
  );

  const history = readCp !== null ? await checkpointer.history(readCp.id) : [];
  check('history 沿 parent 链回溯到根', history.length === 2, `链长=${history.length}`);

  const version = await factStore.appendVersion();
  const readEntity = await factStore.getEntity(version, asEntityId('ent-gu-changfeng'));
  check(
    'entity 读回一致（规范名 + 别名 + 属性）',
    readEntity !== null &&
      readEntity.canonicalName === '顾长风' &&
      readEntity.aliasSet.aliases.length === 2 &&
      readEntity.attributes.length === 1 &&
      readEntity.attributes[0]?.value === 'left',
    readEntity === null ? '未找到' : `别名数=${readEntity.aliasSet.aliases.length}`,
  );

  const missing = await factStore.getEntity(version, asEntityId('ent-does-not-exist'));
  check('不存在实体读回 null', missing === null);

  await reopened.db.close();
  await rm(dir, { recursive: true, force: true });
}

/** 6.4 + 6.5：工作区导入/重开/remap。使用 `津门余味/` 的临时副本，不污染源。 */
async function smokeWorkspace(sourceNovelDir: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-ws-'));
  const wsRoot = join(dir, '津门余味');
  await cp(sourceNovelDir, wsRoot, { recursive: true });

  // 首次导入：生成 workspace.json + manuscript.json。
  const first = await openOrImportWorkspace(wsRoot);
  const firstTree = projectChapterTree(first);
  const firstChapter = findFirstChapter(firstTree.roots);
  check('首次导入生成工作区 + 章节树', firstChapter !== null, `书名=${firstTree.title}`);
  check('首次导入映射体检 clean', first.remap.consistent);

  if (firstChapter === null) {
    await rm(dir, { recursive: true, force: true });
    return;
  }

  // 读回真实章节正文（经稳定 id → manifest → Markdown 文件）。
  const contentPath = resolveContentPath(first, firstChapter.id);
  const content = contentPath !== null ? await readFile(contentPath, 'utf8') : '';
  check('以稳定 id 读回真实章节正文', content.trim().length > 0, `字数≈${content.length}`);

  // 重开：id 必须与首次一致。
  const second = await openOrImportWorkspace(wsRoot);
  const secondTree = projectChapterTree(second);
  const secondChapter = findFirstChapter(secondTree.roots);
  check(
    '重开工作区稳定 id 不变',
    secondChapter !== null && secondChapter.id === firstChapter.id,
    `id=${firstChapter.id}`,
  );

  // 6.5：手工改名一章文件 → remap 应返回 hash-moved（按内容指纹重连，不静默错配）。
  const movedEntry = second.manifest.entries.find(
    (e) => e.kind === 'chapter' && e.relativePath !== null,
  );
  if (movedEntry?.relativePath != null) {
    const oldAbs = join(wsRoot, movedEntry.relativePath);
    const newRel = `${movedEntry.relativePath.replace(/\.md$/i, '')}-改名.md`;
    const newAbs = join(wsRoot, newRel);
    await rename(oldAbs, newAbs);

    const remap = await detectRemap(wsRoot, second.manifest);
    const hashMoved = remap.issues.find((i) => i.kind === 'hash-moved' && i.nodeId === movedEntry.id);
    check(
      '改名后 remap 返回 hash-moved（按内容指纹重连）',
      !remap.consistent && hashMoved !== undefined,
      hashMoved !== undefined && 'actualPath' in hashMoved ? `→ ${hashMoved.actualPath}` : '未检出',
    );
  } else {
    check('改名后 remap 返回 hash-moved', false, '无可用章节文件');
  }

  await rm(dir, { recursive: true, force: true });
}

interface TreeNode {
  id: string;
  kind: string;
  children: ReadonlyArray<TreeNode>;
}

/** 深度优先找到第一个 chapter 节点。 */
function findFirstChapter(nodes: ReadonlyArray<TreeNode>): TreeNode | null {
  for (const node of nodes) {
    if (node.kind === 'chapter') return node;
    const inChild = findFirstChapter(node.children);
    if (inChild !== null) return inChild;
  }
  return null;
}

async function main(): Promise<void> {
  console.log('=== persistence-sqlite 冒烟 ===');
  await smokeSqlite();

  const sourceNovelDir = resolve(process.cwd(), '津门余味');
  await smokeWorkspace(sourceNovelDir);

  console.log(`=== 完成：${failures === 0 ? '全部通过' : `${failures} 项失败`} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
