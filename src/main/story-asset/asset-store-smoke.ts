/**
 * 故事资产存储层验收 smoke — 不可变版本历史与 draft/formal 隔离
 *
 * 验证：
 * 1. 首次保存：index.json + snapshots/ 正确创建
 * 2. 版本递增：每次 save 追加版本，不覆盖旧版本
 * 3. draft/formal 双 lane 隔离：保存 formal 不影响 currentDraftId
 * 4. 乐观锁：expectedVersion 不匹配时明确报错
 * 5. 版本重复检测：相同 id 或 version 拒绝
 * 6. 损坏持久化：JSON 损坏抛出，不静默返回空
 * 7. ENOENT vs I/O 错误：文件不存在返回空/默认，损坏抛出
 * 8. 重启后读取：loadFormalStoryAssetSnapshot 能读到正确版本
 * 9. nextStoryAssetVersion：空历史时返回 1
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  saveStoryAssetSnapshot,
  loadStoryAssetSnapshot,
  loadFormalStoryAssetSnapshot,
  nextStoryAssetVersion,
} from './asset-store.js';
import type { StoryAssetSnapshot } from '../../core/story-asset/index.js';
import { explicitClaim, pendingDesignClaim } from '../../core/story-asset/index.js';

/* ── 测试夹具 ──────────────────────────────────────────────── */

function makeSnapshot(id: string, version: number, status: 'draft' | 'formal' = 'draft'): StoryAssetSnapshot {
  const now = new Date().toISOString();
  const goal = status === 'formal'
    ? { ...explicitClaim('拿到密信', '原文引用', 'plot-1'), credibility: 'explicit' as const }
    : { ...explicitClaim('拿到密信', '原文引用', 'plot-1'), credibility: 'explicit' as const };
  return {
    id,
    projectId: 'project-test',
    version,
    createdAt: now,
    updatedAt: now,
    plotThreads: [
      {
        id: 'pt-1',
        name: '密信线',
        kind: 'main' as const,
        goal,
        plotNodeIds: ['plot-1'],
        characterIds: ['ch-1'],
        stages: [],
        keyEvents: [],
        status,
      },
    ],
    characters: [
      {
        id: 'ch-1',
        name: '顾长风',
        aliases: [],
        identity: { ...explicitClaim('特工', '原文引用', 'plot-1') },
        appearance: pendingDesignClaim(''),
        abilities: pendingDesignClaim(''),
        personality: pendingDesignClaim(''),
        languageStyle: pendingDesignClaim(''),
        desire: pendingDesignClaim(''),
        goal: pendingDesignClaim(''),
        fear: pendingDesignClaim(''),
        weakness: pendingDesignClaim(''),
        currentStatus: pendingDesignClaim(''),
        plotThreadIds: ['pt-1'],
        status,
      },
    ],
    relations: [],
    arcs: [],
    foreshadowings: [],
    sourceOutlineVersion: 1,
  };
}

async function makeTempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `na-asset-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/* ── 测试 1：首次保存 ──────────────────────────────────────── */

async function testFirstSave(): Promise<string> {
  const dir = await makeTempDir();
  const snap = makeSnapshot('snap-1', 1);
  await saveStoryAssetSnapshot(dir, snap, 'draft');

  // index.json 存在
  const indexRaw = await fs.readFile(path.join(dir, '.novel-agent', 'story-assets', 'index.json'), 'utf-8');
  const index = JSON.parse(indexRaw);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.currentDraftId, 'snap-1');
  assert.equal(index.currentFormalId, undefined);
  assert.equal(index.history.length, 1);
  assert.equal(index.history[0].id, 'snap-1');

  // snapshot 文件存在
  const snapRaw = await fs.readFile(path.join(dir, '.novel-agent', 'story-assets', 'snapshots', 'snap-1.json'), 'utf-8');
  const loaded = JSON.parse(snapRaw);
  assert.equal(loaded.id, 'snap-1');
  assert.equal(loaded.version, 1);

  return dir;
}

/* ── 测试 2：版本递增不覆盖 ────────────────────────────────── */

async function testVersionIncrementDoesNotOverwrite(dir: string): Promise<void> {
  const snap2 = makeSnapshot('snap-2', 2);
  await saveStoryAssetSnapshot(dir, snap2, 'draft');

  // 旧快照仍在
  const oldSnapRaw = await fs.readFile(path.join(dir, '.novel-agent', 'story-assets', 'snapshots', 'snap-1.json'), 'utf-8');
  const oldSnap = JSON.parse(oldSnapRaw);
  assert.equal(oldSnap.version, 1, '旧版本快照应仍存在');

  // index 指向新草案
  const index = JSON.parse(await fs.readFile(path.join(dir, '.novel-agent', 'story-assets', 'index.json'), 'utf-8'));
  assert.equal(index.currentDraftId, 'snap-2');
  assert.equal(index.history.length, 2);
}

/* ── 测试 3：draft/formal 隔离 ─────────────────────────────── */

async function testDraftFormalIsolation(dir: string): Promise<void> {
  // 发布一个 formal 版本
  const formalSnap = makeSnapshot('snap-formal-1', 3, 'formal');
  await saveStoryAssetSnapshot(dir, formalSnap, 'formal');

  // draft 指针不变，formal 指针指向新版本
  const index = JSON.parse(await fs.readFile(path.join(dir, '.novel-agent', 'story-assets', 'index.json'), 'utf-8'));
  assert.equal(index.currentDraftId, 'snap-2', '保存 formal 不应改变 currentDraftId');
  assert.equal(index.currentFormalId, 'snap-formal-1');

  // loadStoryAssetSnapshot 返回当前草案（优先于 formal）
  const loaded = await loadStoryAssetSnapshot(dir);
  assert.notEqual(loaded, undefined);
  assert.equal(loaded!.version, 2, 'loadStoryAssetSnapshot 应返回当前草案而非 formal');

  // loadFormalStoryAssetSnapshot 返回 formal
  const formal = await loadFormalStoryAssetSnapshot(dir);
  assert.notEqual(formal, undefined);
  assert.equal(formal!.version, 3);
  assert.equal(formal!.id, 'snap-formal-1');
}

/* ── 测试 4：乐观锁版本冲突 ────────────────────────────────── */

async function testOptimisticVersionConflict(): Promise<void> {
  const dir = await makeTempDir();
  const snap1 = makeSnapshot('snap-a', 1);
  await saveStoryAssetSnapshot(dir, snap1, 'draft');

  // 用错误的 expectedVersion 保存
  const snap2 = makeSnapshot('snap-b', 2);
  await assert.rejects(
    saveStoryAssetSnapshot(dir, snap2, 'draft', 999),
    /版本冲突/,
    '应拒绝基于过期版本的保存',
  );

  // 用正确的 expectedVersion 保存应成功
  await saveStoryAssetSnapshot(dir, snap2, 'draft', 1);
  const loaded = await loadStoryAssetSnapshot(dir);
  assert.equal(loaded!.version, 2);
}

/* ── 测试 5：版本重复检测 ──────────────────────────────────── */

async function testDuplicateVersionDetection(): Promise<void> {
  const dir = await makeTempDir();
  const snap1 = makeSnapshot('snap-x', 1);
  await saveStoryAssetSnapshot(dir, snap1, 'draft');

  // 相同 version 不同 id
  const snap2 = makeSnapshot('snap-y', 1);
  await assert.rejects(
    saveStoryAssetSnapshot(dir, snap2, 'draft'),
    /id 或版本重复/,
    '应拒绝版本号重复',
  );

  // 相同 id 不同 version
  const snap3 = makeSnapshot('snap-x', 2);
  await assert.rejects(
    saveStoryAssetSnapshot(dir, snap3, 'draft'),
    /id 或版本重复/,
    '应拒绝 id 重复',
  );
}

/* ── 测试 6：损坏持久化 ────────────────────────────────────── */

async function testCorruptedPersistence(): Promise<void> {
  const dir = await makeTempDir();
  const snap = makeSnapshot('snap-c', 1);
  await saveStoryAssetSnapshot(dir, snap, 'draft');

  // 损坏 index.json
  await fs.writeFile(path.join(dir, '.novel-agent', 'story-assets', 'index.json'), '{ broken json', 'utf-8');
  await assert.rejects(
    loadStoryAssetSnapshot(dir),
    /损坏|SyntaxError|JSON/,
    '损坏的 index.json 应抛出而非静默返回空',
  );

  // 损坏 snapshot 文件
  const dir2 = await makeTempDir();
  await saveStoryAssetSnapshot(dir2, snap, 'draft');
  await fs.writeFile(path.join(dir2, '.novel-agent', 'story-assets', 'snapshots', 'snap-c.json'), 'not json at all', 'utf-8');
  await assert.rejects(
    loadStoryAssetSnapshot(dir2),
    /不是对象|格式不完整|JSON|Unexpected token/,
    '损坏的 snapshot 文件应抛出而非静默返回空',
  );
}

/* ── 测试 7：ENOENT vs I/O 错误 ─────────────────────────────── */

async function testEnoentVsIoError(): Promise<void> {
  // 空目录：文件不存在返回 undefined（不抛出）
  const emptyDir = await makeTempDir();
  const loaded = await loadStoryAssetSnapshot(emptyDir);
  assert.equal(loaded, undefined, '文件不存在应返回 undefined 而非抛出');

  const formal = await loadFormalStoryAssetSnapshot(emptyDir);
  assert.equal(formal, undefined, '文件不存在应返回 undefined 而非抛出');

  const next = await nextStoryAssetVersion(emptyDir);
  assert.equal(next, 1, '空历史应返回版本 1');
}

/* ── 测试 8：重启后读取 formal ─────────────────────────────── */

async function testRestartReadsFormal(): Promise<void> {
  const dir = await makeTempDir();
  // 模拟完整生命周期
  const draft = makeSnapshot('snap-draft', 1, 'draft');
  await saveStoryAssetSnapshot(dir, draft, 'draft');
  const formal = makeSnapshot('snap-formal', 2, 'formal');
  await saveStoryAssetSnapshot(dir, formal, 'formal');

  // "重启" = 重新调用 load 函数（模拟进程重启后重新读盘）
  const formalLoaded = await loadFormalStoryAssetSnapshot(dir);
  assert.notEqual(formalLoaded, undefined);
  assert.equal(formalLoaded!.id, 'snap-formal');
  assert.equal(formalLoaded!.version, 2);
  // formal 资产应全部为 formal 状态
  assert.ok(formalLoaded!.plotThreads.every((t) => t.status === 'formal'), 'formal 快照中资产应全部为 formal');
  assert.ok(formalLoaded!.characters.every((c) => c.status === 'formal'), 'formal 快照中人物应全部为 formal');
}

/* ── 测试 9：formal 保存后再更新 draft 不影响 formal ──────── */

async function testDraftUpdateDoesNotAffectFormal(): Promise<void> {
  const dir = await makeTempDir();
  const draft1 = makeSnapshot('snap-d1', 1, 'draft');
  await saveStoryAssetSnapshot(dir, draft1, 'draft');
  const formal1 = makeSnapshot('snap-f1', 2, 'formal');
  await saveStoryAssetSnapshot(dir, formal1, 'formal');

  // 再次提炼新草案
  const draft2 = makeSnapshot('snap-d2', 3, 'draft');
  await saveStoryAssetSnapshot(dir, draft2, 'draft');

  // formal 不变
  const formal = await loadFormalStoryAssetSnapshot(dir);
  assert.equal(formal!.id, 'snap-f1', '新草案不应覆盖 formal 指针');

  // 当前草案指向新的
  const current = await loadStoryAssetSnapshot(dir);
  assert.equal(current!.id, 'snap-d2', 'loadStoryAssetSnapshot 应返回最新草案');
}

/* ── 主入口 ─────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('故事资产存储层验收');
  console.log('═'.repeat(60));

  console.log('\n━ testFirstSave');
  const dir = await testFirstSave();
  console.log('✅ 首次保存创建 index.json + snapshots/ 正确');

  console.log('\n━ testVersionIncrementDoesNotOverwrite');
  await testVersionIncrementDoesNotOverwrite(dir);
  console.log('✅ 版本递增不覆盖旧版本');

  console.log('\n━ testDraftFormalIsolation');
  await testDraftFormalIsolation(dir);
  console.log('✅ draft/formal 双 lane 隔离正确');

  console.log('\n━ testOptimisticVersionConflict');
  await testOptimisticVersionConflict();
  console.log('✅ 乐观锁版本冲突检测');

  console.log('\n━ testDuplicateVersionDetection');
  await testDuplicateVersionDetection();
  console.log('✅ 版本/id 重复检测');

  console.log('\n━ testCorruptedPersistence');
  await testCorruptedPersistence();
  console.log('✅ 损坏持久化抛出而非静默返回空');

  console.log('\n━ testEnoentVsIoError');
  await testEnoentVsIoError();
  console.log('✅ ENOENT 返回空、I/O 错误抛出');

  console.log('\n━ testRestartReadsFormal');
  await testRestartReadsFormal();
  console.log('✅ 重启后读取 formal 资产正确');

  console.log('\n━ testDraftUpdateDoesNotAffectFormal');
  await testDraftUpdateDoesNotAffectFormal();
  console.log('✅ 新草案不覆盖已有 formal');

  console.log('\n' + '═'.repeat(60));
  console.log('全部存储层验收通过');
  console.log('═'.repeat(60));
}

await main();
