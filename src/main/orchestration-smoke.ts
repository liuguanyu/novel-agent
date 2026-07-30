/**
 * 编排冒烟脚本 (orchestration-runtime tasks 9.1–9.4)
 *
 * 非产品代码：不引入测试框架，以独立可执行脚本端到端验证编排核心路径：
 *   9.2 召唤→写手产出→审校挂起→correct 续跑不重跑同一纠偏→time-travel 回溯重开；
 *   9.3 软召回作者记错章号→产出纠偏候选（不自动选）；指令撞事实→硬阻断 + 知情放行可通过。
 *
 * 全程不依赖 Electron 运行时（@langchain/langgraph 在 Node 下可用）。
 * 用临时 SQLite DB + 真 SqliteFactStore / SqliteCheckpointer + fake ModelResolver（吐 canned JSON）+
 * fake WebContents（仅收集 wc.send 调用）。
 * 编译进 out-smoke/ 后用 `node out-smoke/main/orchestration-smoke.js` 运行。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import {
  CreativeAssetRepository,
  openDatabase,
  SqliteCheckpointer,
  SqliteFactStore,
  SqliteStageRunEvidenceRecorder,
  WorkflowIssueRepository,
  WorkflowRepository,
} from './db/index.js';
import { OrchestrationRuntime, targetedVerificationAgentFor, type BackfillFactsParams, type SummonParams } from './orchestration/runtime.js';
import { WorkflowApplicationService } from './workflow-application-service.js';
import { readManifestChapterIds } from './novel-reader.js';
import { InlineAuditRunner, type AuditRunner } from './audit/audit-runner.js';
import { InlineDiffRunner } from './refactor/diff-runner.js';
import { InlineEmbedRunner } from './corpus/embed-runner.js';
import { InMemoryCorpusStore } from './corpus/corpus-store.js';
import {
  computeEmbeddings,
  asCorpusItemId,
  asCorpusProjectId,
  type CorpusItem,
  type CorpusScope,
} from '../core/corpus/index.js';
import {
  carveFragment,
  spliceAcceptedHunks,
  type FragmentAnchor,
  type HunkValidity,
} from '../core/refactor/index.js';
import { parseReviewerIssuesWithDiagnostics } from './orchestration/consistency-schema.js';
import {
  AGENT_CATALOG_ENTRIES,
  resolveAgentMention,
} from '../core/shell/agent-catalog.js';
import { TOOLBOX_BOARD_ITEMS, TOOLBOX_ACTION_ITEMS } from '../core/shell/toolbox-catalog.js';
import {
  cycleThemePreference,
  resolveTheme,
  type ThemePreference,
} from '../core/shell/theme.js';
import type { ModelResolver } from './model-resolver.js';
import type {
  BackendControlEvent,
  BackendModelTaskEvent,
  BackendStreamMessage,
  ConsistencyIssueDto,
  GraphNodeActivatedEvent,
  RunId,
} from '../shared/ipc/index.js';
import { IPC_CHANNELS } from '../shared/ipc/index.js';
import type { CapabilityTier, ModelAdapter, ModelCallInput } from '../core/model/index.js';
import { asEntityId, asCheckpointId, asFactVersionId, type ConsistencyIssue, type Entity, type Provenance } from '../core/story-bible/index.js';
import { asNodeId } from '../core/manuscript/index.js';
import type { NovelState } from '../core/orchestration/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** 构造带真实出处（在 chapter-A）的实体：顾长风。 */
function sampleEntity(): Entity {
  const provenance: Provenance = {
    sources: [
      {
        location: { id: asNodeId('chapter-A'), kind: 'chapter' },
        quote: '顾长风在第一章缓缓登场',
        confidence: 0.9,
      },
    ],
  };
  return {
    id: asEntityId('ent-gu-changfeng'),
    type: 'person',
    canonicalName: '顾长风',
    aliasSet: {
      aliases: ['顾长风', '顾兄弟'],
      status: 'confirmed',
      provenance,
    },
    attributes: [],
    status: 'inferred',
    provenance,
  };
}

/** 构造最小合法 NovelState（供 checkpoint 快照播种）。 */
function sampleState(draft: string): NovelState {
  return {
    currentChapterId: { id: asNodeId('chapter-A'), kind: 'chapter' },
    currentDraft: draft,
    chatHistory: [{ role: 'user', content: '继续写' }],
    activeBugs: [],
    currentAction: 'idle',
    agentStatus: 'idle',
    contextRefs: { facts: null, corpus: null },
  };
}

/** fake WebContents：仅按通道分流收集 wc.send 调用，不依赖 Electron 运行时。 */
class FakeWebContents {
  readonly stream: BackendStreamMessage[] = [];
  readonly control: BackendControlEvent[] = [];
  readonly modelTask: BackendModelTaskEvent[] = [];
  send(channel: string, message: unknown): void {
    if (channel === IPC_CHANNELS.dialogueStream) {
      this.stream.push(message as BackendStreamMessage);
    } else if (channel === IPC_CHANNELS.controlEvent) {
      this.control.push(message as BackendControlEvent);
    } else if (channel === IPC_CHANNELS.modelTaskEvent) {
      this.modelTask.push(message as BackendModelTaskEvent);
    }
  }
  // 类型断言：运行时只用 send，不调用其它 Electron WebContents 方法。
  asWebContents(): WebContents {
    return this as unknown as WebContents;
  }
}

/** fake adapter：吐 canned 文本（writer=正文，reviewer=空 JSON 数组）。 */
function fakeAdapter(canned: string): ModelAdapter {
  const stream = async function* (input: ModelCallInput): AsyncIterable<string> {
    // 触发一次 await 让流为真异步（避免空 generator 被同步消费完）。
    await Promise.resolve();
    if (input.options?.signal?.aborted) return;
    yield canned;
  };
  return {
    stream,
    async complete(_input) {
      return {
        text: canned,
        finishReason: 'stop',
      };
    },
  };
}

/** fake ModelResolver：按 agentId 分流吐 canned adapter（writer→正文，reviewer→空审校）。 */
class FakeModelResolver {
  constructor(
    private readonly writerText: string,
    private readonly reviewerText: string,
    private readonly extractorText?: string,
  ) {}

  createAdapter(
    _agentId: string,
    _tier: CapabilityTier,
    _options: { onReasoning?: (delta: string) => void } = {},
  ): ModelAdapter {
    if (_agentId === 'reviewer') return fakeAdapter(this.reviewerText);
    if (_agentId === 'fact-extractor') return fakeAdapter(this.extractorText ?? this.writerText);
    return fakeAdapter(this.writerText);
  }

  asResolver(): ModelResolver {
    return this as unknown as ModelResolver;
  }
}

/** 从流式消息中拼回完整对话文本（含 reasoning 旁路标）。 */
function collectDialogue(wc: FakeWebContents): string {
  let full = '';
  for (const m of wc.stream) {
    if (m.type === 'stream-chunk') full += m.delta;
  }
  return full;
}

/** 取收到的 interrupt-raised 控制事件（若有）。 */
function collectInterrupt(wc: FakeWebContents): BackendControlEvent | undefined {
  return wc.control.find((e) => e.type === 'interrupt-raised');
}

/** 取 LangGraph tasks stream 投影出的逐节点生命周期事件。 */
function collectGraphEvents(wc: FakeWebContents): GraphNodeActivatedEvent[] {
  return wc.control.filter((event): event is GraphNodeActivatedEvent => event.type === 'graph-node-activated');
}

function graphEventIndex(
  events: ReadonlyArray<GraphNodeActivatedEvent>,
  node: string,
  phase: GraphNodeActivatedEvent['phase'],
): number {
  return events.findIndex((event) => event.node === node && event.phase === phase);
}

function checkGraphNodeLifecycle(
  label: string,
  events: ReadonlyArray<GraphNodeActivatedEvent>,
  node: string,
): void {
  const enter = graphEventIndex(events, node, 'enter');
  const exit = graphEventIndex(events, node, 'exit');
  check(
    label,
    enter >= 0 && exit >= 0 && enter < exit,
    `node=${node} enter=${enter} exit=${exit}`,
  );
}

/**
 * 9.2：召唤→写手产出→审校挂起→correct 续跑不重跑同一纠偏→time-travel 回溯重开。
 *
 * 这里 reviewer canned 为 `[]`（模型审校无问题），使软召回纠偏成为唯一需裁决问题，
 * 从而验证 reviewer 节点的 factIssues 分支 + factsChecked flag 防死循环。
 */
async function smokeSummonResumeTimeTravel(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-'));
  const dbPath = join(dir, 'orch.db');

  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const checkpointer = new SqliteCheckpointer(db);
  const factStore = new SqliteFactStore(db);

  // 播种事实：顾长风在 chapter-A 有出处。
  const version = await factStore.appendVersion();
  await factStore.putEntity(version, sampleEntity(), null);

  // fake 模型：writer 吐一段正文，reviewer 吐空审校数组。
  const resolver = new FakeModelResolver(
    '顾长风缓步走入津门夜色，灯笼一盏盏亮起。',
    '[]',
  ).asResolver();

  const runtime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => checkpointer,
    getFactStore: () => factStore,
  });

  // 召唤 mutate 模式 + 软章号故意说成 chapter-B（错！真实在 chapter-A）→ 应触发纠偏。
  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  const params: SummonParams = {
    runId,
    mode: 'mutate',
    agent: 'writer',
    scope: 'project',
    softChapterNodeId: 'chapter-B', // 作者记错章号
    keywords: ['顾长风'],
    instruction: '写一段顾长风登场场景',
  };
  await runtime.summon(wc.asWebContents(), params);

  // 流式应产 stream-start / chunks / stream-end。
  const dialogue = collectDialogue(wc);
  check('召唤产出对话流式分片', dialogue.length > 0, `字数≈${dialogue.length}`);
  check(
    '召唤流式收 stream-end',
    wc.stream.some((m) => m.type === 'stream-end'),
  );

  const graphEvents = collectGraphEvents(wc);
  check('活图追踪：召唤下发 graph-node-activated', graphEvents.length > 0, `events=${graphEvents.length}`);
  checkGraphNodeLifecycle('活图追踪：supervisor enter 在 exit 前', graphEvents, 'supervisor');
  checkGraphNodeLifecycle('活图追踪：writer enter 在 exit 前', graphEvents, 'writer');
  checkGraphNodeLifecycle('活图追踪：reviewer enter 在 exit 前', graphEvents, 'reviewer');

  // 应挂起 + 推 interrupt-raised，issues 含一个「other」类型纠偏问题。
  const interrupt = collectInterrupt(wc);
  check('纠偏挂起 + interrupt-raised', interrupt !== undefined);
  let issue: ConsistencyIssueDto | undefined;
  if (interrupt !== undefined && interrupt.type === 'interrupt-raised') {
    issue = interrupt.issues[0];
  }
  const interruptIndex = wc.control.findIndex((event) => event.type === 'interrupt-raised');
  const reviewerExitIndex = wc.control.findIndex(
    (event) => event.type === 'graph-node-activated' && event.node === 'reviewer' && event.phase === 'exit',
  );
  check(
    '活图追踪：中断前已有触发节点事件',
    reviewerExitIndex >= 0 && interruptIndex > reviewerExitIndex,
    `reviewerExit=${reviewerExitIndex} interrupt=${interruptIndex}`,
  );
  check(
    '纠偏产 other 类型问题 + requiresHumanDecision',
    issue !== undefined &&
      issue.type === 'other' &&
      issue.requiresHumanDecision === true,
    issue !== undefined ? `type=${issue.type}` : '无 issue',
  );
  // 候选选项含「维持原述」+「手动指定」+ 至少一个真实出处候选（chapter-A，标「最接近」）。
  const optionIds = issue?.options?.map((o) => o.id) ?? [];
  check(
    '纠偏候选含真实出处 chapter-A（不替作者默认选）',
    optionIds.some((id) => id.startsWith('candidate:chapter-A')),
    `options=${JSON.stringify(optionIds)}`,
  );
  check(
    '纠偏候选含「维持原述」+「手动指定」',
    optionIds.includes('keep-stated') && optionIds.includes('manual-anchor'),
  );

  // resume correct：选「维持原述」→ 清 activeBugs 回 writer→reviewer。
  // factsChecked=true → reviewer 不再重跑 factChecks → 不再产纠偏 → 路由 END。
  const wc2 = new FakeWebContents();
  await runtime.resume(wc2.asWebContents(), runId, { kind: 'correct', optionId: 'keep-stated' });
  const interrupt2 = collectInterrupt(wc2);
  check(
    'correct 后不再重复挂起同一纠偏（factsChecked 防死循环）',
    interrupt2 === undefined,
    interrupt2 !== undefined ? '仍挂起！' : '干净完成',
  );
  check(
    'correct 续跑完成（无 stream-error / 无重复挂起）',
    wc2.stream.every((m) => m.type !== 'stream-error'),
  );

  // time-travel：取历史链（应非空，至少一个 reviewer 里程碑）。
  const history = await runtime.getCheckpointHistory();
  check(
    'time-travel 历史链非空',
    history.checkpoints.length > 0,
    `链长=${history.checkpoints.length}`,
  );
  const reviewerCp = history.checkpoints.find((c) => c.atNode === 'reviewer');
  check('里程碑链含 reviewer 节点', reviewerCp !== undefined);

  // restart from checkpoint：新 runId、从历史 reviewer 快照重开。
  if (reviewerCp !== undefined) {
    const wc3 = new FakeWebContents();
    await runtime.restartFromCheckpoint(wc3.asWebContents(), {
      runId: randomUUID() as RunId,
      checkpointId: reviewerCp.id,
      instruction: '从这处再写一段',
    });
    check(
      'time-travel 回溯重开收 stream-end',
      wc3.stream.some((m) => m.type === 'stream-end'),
    );
    check(
      '回溯重开产出新对话',
      collectDialogue(wc3).length > 0,
    );
  }

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

/**
 * 9.3：指令撞事实硬阻断 + 知情放行可通过。
 * 指令含「首次登场」+ 提及既有实体名 → detectInstructionConflicts 产 critical 问题；
 * resume approve（=知情放行）→ END。
 */
async function smokeInstructionConflictOverride(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-conflict-'));
  const dbPath = join(dir, 'orch-conflict.db');

  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const checkpointer = new SqliteCheckpointer(db);
  const factStore = new SqliteFactStore(db);

  const version = await factStore.appendVersion();
  await factStore.putEntity(version, sampleEntity(), null);

  const resolver = new FakeModelResolver(
    '正文草稿……',
    '[]',
  ).asResolver();

  const runtime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => checkpointer,
    getFactStore: () => factStore,
  });

  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  // 指令声明「首次登场」但顾长风已有出处 → 硬冲突。
  const params: SummonParams = {
    runId,
    mode: 'mutate',
    agent: 'writer',
    scope: 'project',
    keywords: ['顾长风'],
    instruction: '写顾长风首次登场的场景',
  };
  await runtime.summon(wc.asWebContents(), params);

  const interrupt = collectInterrupt(wc);
  check('冲突硬阻断挂起', interrupt !== undefined);
  let conflict: ConsistencyIssueDto | undefined;
  if (interrupt !== undefined && interrupt.type === 'interrupt-raised') {
    conflict = interrupt.issues.find(
      (i) => i.type === 'state-contradiction' && i.severity === 'critical',
    );
  }
  check(
    '产 state-contradiction critical 问题',
    conflict !== undefined,
    conflict !== undefined ? `severity=${conflict.severity}` : '无冲突 issue',
  );
  const optionIds = conflict?.options?.map((o) => o.id) ?? [];
  check(
    '冲突选项始终含知情放行逃生门',
    optionIds.includes('informed-override'),
    `options=${JSON.stringify(optionIds)}`,
  );

  // resume approve（=知情放行）→ END。
  const wc2 = new FakeWebContents();
  await runtime.resume(wc2.asWebContents(), runId, { kind: 'approve' });
  const interrupt2 = collectInterrupt(wc2);
  check(
    '知情放行后 END（不再挂起）',
    interrupt2 === undefined,
    interrupt2 !== undefined ? '仍挂起！' : '干净完成',
  );
  check(
    '知情放行完成（无 stream-error / 无重复挂起）',
    wc2.stream.every((m) => m.type !== 'stream-error'),
  );

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

/** 额外验证：无事实库注入时图降级为不召回（happy path 不受影响）。 */
async function smokeNoFactStoreHappyPath(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-nofact-'));
  const dbPath = join(dir, 'orch-nofact.db');
  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const checkpointer = new SqliteCheckpointer(db);

  const resolver = new FakeModelResolver('happy path 正文', '[]').asResolver();
  const runtime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => checkpointer,
    getFactStore: () => undefined, // 无事实库 → 降级
  });

  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  const params: SummonParams = {
    runId,
    mode: 'mutate',
    agent: 'writer',
    scope: 'project',
    instruction: '写一段',
  };
  await runtime.summon(wc.asWebContents(), params);
  const interrupt = collectInterrupt(wc);
  check(
    '无事实库时不挂起（降级为不召回）',
    interrupt === undefined,
    interrupt !== undefined ? '误挂起！' : '干净完成',
  );
  check(
    'happy path 收 stream-end',
    wc.stream.some((m) => m.type === 'stream-end'),
  );

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

async function smokeExplicitFactExtraction(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-extract-'));
  const dbPath = join(dir, 'orch-extract.db');
  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const factStore = new SqliteFactStore(db);
  const resolver = new FakeModelResolver(
    `{
      "candidates": [
        {
          "kind": "entity",
          "suggestedAnchor": {"id": "chapter-extract", "kind": "chapter"},
          "confidence": 0.9,
          "payload": {"entityType": "person", "canonicalName": "顾长风", "quote": "顾长风把八音盒交给豹头"}
        },
        {
          "kind": "plot-hook",
          "suggestedAnchor": {"id": "chapter-extract", "kind": "chapter"},
          "confidence": 0.82,
          "payload": {"description": "八音盒被交给豹头", "state": "planted", "quote": "顾长风把八音盒交给豹头"}
        }
      ]
    }`,
    'unused reviewer text',
  ).asResolver();
  const runtime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => undefined,
    getFactStore: () => factStore,
  });

  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  await runtime.extractFacts(wc.asWebContents(), runId, {
    location: { id: asNodeId('chapter-extract'), kind: 'chapter' },
    text: '顾长风把八音盒交给豹头。',
  });

  const started = wc.control.find((event) => event.type === 'fact-extraction-started');
  const completed = wc.control.find((event) => event.type === 'fact-extraction-completed');
  check(
    '显式抽取：进度/完成事件走 control-event',
    started !== undefined && completed !== undefined,
  );
  check(
    '显式抽取：完成事件含候选与自动入库诊断',
    completed?.type === 'fact-extraction-completed' &&
      completed.validCandidates > 0 &&
      completed.autoIngested > 0 &&
      completed.factVersion !== undefined,
    completed?.type === 'fact-extraction-completed'
      ? `valid=${completed.validCandidates} auto=${completed.autoIngested}`
      : '无 completed',
  );
  if (completed?.type === 'fact-extraction-completed' && completed.factVersion !== undefined) {
    const view = await factStore.getView(asFactVersionId(completed.factVersion));
    check(
      '显式抽取：低风险事实已写入事实库',
      view.entities.some((entity) => entity.canonicalName === '顾长风') &&
        view.plotHooks.some((hook) => hook.description.includes('八音盒')),
      `entities=${view.entities.length} hooks=${view.plotHooks.length}`,
    );
  }

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

async function smokeAutoExtractAfterWriter(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-auto-extract-'));
  const dbPath = join(dir, 'orch-auto-extract.db');
  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const checkpointer = new SqliteCheckpointer(db);
  const factStore = new SqliteFactStore(db);
  const resolver = new FakeModelResolver(
    '顾长风把八音盒交给豹头。',
    '[]',
    `{
      "candidates": [
        {
          "kind": "entity",
          "suggestedAnchor": {"id": "chapter-auto", "kind": "chapter"},
          "confidence": 0.9,
          "payload": {"entityType": "person", "canonicalName": "顾长风", "quote": "顾长风把八音盒交给豹头"}
        },
        {
          "kind": "entity",
          "suggestedAnchor": {"id": "chapter-auto", "kind": "chapter"},
          "confidence": 0.86,
          "payload": {"entityType": "person", "canonicalName": "豹头", "quote": "顾长风把八音盒交给豹头"}
        },
        {
          "kind": "relation",
          "suggestedAnchor": {"id": "chapter-auto", "kind": "chapter"},
          "confidence": 0.78,
          "payload": {"fromName": "顾长风", "toName": "豹头", "kind": "委托", "quote": "顾长风把八音盒交给豹头"}
        }
      ]
    }`,
  ).asResolver();
  const runtime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => checkpointer,
    getFactStore: () => factStore,
  });

  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  await runtime.summon(wc.asWebContents(), {
    runId,
    mode: 'mutate',
    agent: 'writer',
    scope: 'node',
    anchorNodeId: 'chapter-auto',
    instruction: '写一段顾长风交付八音盒的正文',
    autoExtractFacts: true,
  });

  const completed = wc.control.find((event) => event.type === 'fact-extraction-completed');
  check(
    'writer 后置自动抽取：低风险事实自动入库并下发完成事件',
    completed?.type === 'fact-extraction-completed' &&
      completed.autoIngested >= 3 &&
      completed.conflicts === 0,
    completed?.type === 'fact-extraction-completed'
      ? `auto=${completed.autoIngested} conflicts=${completed.conflicts}`
      : '无 completed',
  );
  const latest = await factStore.getLatestVersion();
  if (latest !== null) {
    const view = await factStore.getView(latest);
    check(
      'writer 后置自动抽取：writer 新草稿进入事实库',
      view.entities.some((entity) => entity.canonicalName === '顾长风') &&
        view.entities.some((entity) => entity.canonicalName === '豹头') &&
        view.relations.some((relation) => relation.phases.some((phase) => phase.kind === '委托')),
      `entities=${view.entities.length} relations=${view.relations.length}`,
    );
  }

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

async function smokeBackfillFacts(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-backfill-'));
  const dbPath = join(dir, 'orch-backfill.db');
  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const factStore = new SqliteFactStore(db);
  const resolver = new FakeModelResolver(
    `{
      "candidates": [
        {
          "kind": "entity",
          "suggestedAnchor": {"id": "chapter-backfill", "kind": "chapter"},
          "confidence": 0.9,
          "payload": {"entityType": "person", "canonicalName": "顾长风", "quote": "顾长风在第一章现身"}
        }
      ]
    }`,
    'unused reviewer text',
  ).asResolver();
  const runtime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => undefined,
    getFactStore: () => factStore,
  });

  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  const params: BackfillFactsParams = {
    runId,
    chapters: [
      { location: { id: asNodeId('chapter-backfill-1'), kind: 'chapter' }, text: '顾长风在第一章现身。' },
      { location: { id: asNodeId('chapter-backfill-2'), kind: 'chapter' }, text: '豹头在第二章接应。' },
    ],
  };
  await runtime.backfillFacts(wc.asWebContents(), params);

  const started = wc.control.filter((event) => event.type === 'fact-extraction-started');
  const completed = wc.control.filter((event) => event.type === 'fact-extraction-completed');
  check(
    '补库：按章节列表串行下发进度与完成事件',
    started.length === 2 && completed.length === 2,
    `started=${started.length} completed=${completed.length}`,
  );
  check(
    '补库：进度事件包含 index/total',
    started.every((event, index) =>
      event.type === 'fact-extraction-started' && event.index === index + 1 && event.total === 2,
    ),
  );

  const workflows = new WorkflowRepository(db);
  const workflowIssues = new WorkflowIssueRepository(db);
  const creativeAssets = new CreativeAssetRepository(db);
  const service = new WorkflowApplicationService(workflows, creativeAssets, workflowIssues);
  const workflowId = 'legacy-backfill-workflow';
  const created = await service.command({
    type: 'start-workflow', workflowId, projectId: '津门余味',
    kind: 'legacy-book-revision', objective: '保留亮点，重建人物、故事线与逻辑线',
    authorIntents: [
      { kind: 'preserve', text: '保留顾长风第一次出场' },
      { kind: 'extract', text: '提取顾长风的人物特征' },
      { kind: 'remove', text: '去掉前后矛盾' },
    ],
    requestId: 'legacy-backfill-start', operationId: 'legacy-backfill-start-op',
  });
  if (created === null || created.currentStageId === null) throw new Error('老书事实底稿 workflow fixture 启动失败');
  const importStarted = await service.command({
    type: 'workflow-start-stage', workflowId, stageId: created.currentStageId,
    expectedVersion: created.version, requestId: 'legacy-import-start', operationId: 'legacy-import-start-op',
  });
  if (importStarted === null || importStarted.currentStageId === null) throw new Error('老书导入确认阶段启动失败');
  const importConfirmed = await service.command({
    type: 'workflow-confirm-stage', workflowId, stageId: importStarted.currentStageId,
    expectedVersion: importStarted.version, requestId: 'legacy-import-confirm', operationId: 'legacy-import-confirm-op',
  });
  if (importConfirmed === null || importConfirmed.currentStageId === null) throw new Error('老书导入确认阶段推进失败');
  const factStage = importConfirmed.stages.find((stage) => String(stage['stageId']) === importConfirmed.currentStageId);
  check('老书重建：确认目标后进入全书事实底稿', factStage?.['templateStageId'] === 'fact-backfill' && factStage['status'] === 'ready');

  const workflowRuntime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => undefined,
    getFactStore: () => factStore,
    workflows,
    workflowIssues,
    creativeAssets,
    stageRunEvidence: new SqliteStageRunEvidenceRecorder(db),
  });
  const workflowRunId = randomUUID() as RunId;
  await workflowRuntime.backfillFacts(new FakeWebContents().asWebContents(), {
    ...params,
    runId: workflowRunId,
    workflowRef: { workflowId, stageId: importConfirmed.currentStageId },
  });
  const advanced = await workflows.get(workflowId);
  const currentStage = advanced?.stages.find((stage) => stage.stageId === advanced.currentStageId);
  const stageRuns = await db.all('SELECT status FROM workflow_stage_runs WHERE stage_id=? AND run_id=?', importConfirmed.currentStageId, workflowRunId);
  check('老书重建：事实底稿完成后自动进入全书诊断', currentStage?.templateStageId === 'initial-audit' && currentStage.status === 'ready');
  check(
    '老书重建：整批事实回填只记录一条 stage run',
    stageRuns.length === 1 && String(stageRuns[0]?.['status']) === 'completed',
    `rows=${stageRuns.length} status=${String(stageRuns[0]?.['status'] ?? 'missing')}`,
  );
  if (advanced?.currentStageId === null || advanced?.currentStageId === undefined) throw new Error('老书全书诊断阶段缺失');
  const auditWc = new FakeWebContents();
  const auditRunId = randomUUID() as RunId;
  await workflowRuntime.runGlobalAudit(auditWc.asWebContents(), auditRunId, { workflowId, stageId: advanced.currentStageId });
  const auditCompleted = auditWc.control.find((event) => event.type === 'global-audit-completed');
  const diagnosisAsset = await creativeAssets.get(`${workflowId}:legacy-revision-diagnosis`);
  check(
    '老书重建：全书诊断消费作者意图并返回结构化结果',
    auditCompleted?.type === 'global-audit-completed' && auditCompleted.dashboard.legacyDiagnosis?.characterExtraction.length === 1,
  );
  check(
    '老书重建：诊断结果由 Main 持久化为版本化资产',
    diagnosisAsset?.kind === 'legacy-revision-diagnosis' && diagnosisAsset.status === 'generated',
  );
  if (advanced === null || advanced === undefined || diagnosisAsset === null || diagnosisAsset === undefined) throw new Error('老书诊断 smoke 前置数据缺失');
  const latestBeforeIntentEdit = await workflows.get(workflowId);
  if (latestBeforeIntentEdit === null) throw new Error('老书诊断后 workflow 快照缺失');
  const edited = await service.command({
    type: 'workflow-update-author-intents', workflowId, expectedVersion: latestBeforeIntentEdit.version,
    authorIntents: [{ kind: 'preserve', text: '保留豹头接应' }, { kind: 'extract', text: '提取顾长风的克制' }],
    requestId: 'legacy-backfill-intents-edit', operationId: 'legacy-backfill-intents-edit-op',
  });
  if (edited === null || edited.currentStageId === null) throw new Error('老书作者要求更新失败');
  const secondAuditWc = new FakeWebContents();
  const secondAuditRunId = randomUUID() as RunId;
  await workflowRuntime.runGlobalAudit(secondAuditWc.asWebContents(), secondAuditRunId, { workflowId, stageId: edited.currentStageId });
  const secondDiagnosisAsset = await creativeAssets.get(`${workflowId}:legacy-revision-diagnosis`);
  check(
    '老书重建：修改作者要求后，下一次诊断消费最新版并递增诊断资产版本',
    secondDiagnosisAsset?.version === diagnosisAsset.version + 1
      && typeof secondDiagnosisAsset.content === 'object' && secondDiagnosisAsset.content !== null
      && 'preservation' in secondDiagnosisAsset.content
      && JSON.stringify(secondDiagnosisAsset.content).includes('保留豹头接应'),
  );

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

async function smokeChunkedFactExtraction(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-chunked-'));
  const dbPath = join(dir, 'orch-chunked.db');
  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const factStore = new SqliteFactStore(db);
  let calls = 0;
  class ChunkResolver extends FakeModelResolver {
    override createAdapter(agentId: string, tier: CapabilityTier): ModelAdapter {
      if (agentId !== 'fact-extractor') return super.createAdapter(agentId, tier);
      return {
        stream: async function* () { yield ''; },
        complete: async () => {
          calls += 1;
          const name = calls === 1 ? '顾长风' : '豹头';
          return {
            text: `{"candidates":[{"kind":"entity","suggestedAnchor":{"id":"chapter-chunked","kind":"chapter"},"confidence":0.9,"payload":{"entityType":"person","canonicalName":"${name}","quote":"${name}"}}]}`,
            finishReason: 'stop',
          };
        },
      };
    }
  }
  const resolver = new ChunkResolver('', '').asResolver();
  const runtime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => undefined,
    getFactStore: () => factStore,
  });

  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  await runtime.extractFacts(wc.asWebContents(), runId, {
    location: { id: asNodeId('chapter-chunked'), kind: 'chapter' },
    text: `${'顾长风'.repeat(5000)}\n\n${'豹头'.repeat(5000)}`,
  });

  const completed = wc.control.find((event) => event.type === 'fact-extraction-completed');
  check(
    '长章节：分块抽取后统一入库并汇总诊断',
    completed?.type === 'fact-extraction-completed' && completed.chunks !== undefined && completed.chunks > 1 && calls > 1,
    completed?.type === 'fact-extraction-completed' ? `chunks=${completed.chunks} calls=${calls}` : '无 completed',
  );
  if (completed?.type === 'fact-extraction-completed' && completed.factVersion !== undefined) {
    const view = await factStore.getView(asFactVersionId(completed.factVersion));
    check(
      '长章节：所有分块候选在同一批次写入',
      view.entities.some((entity) => entity.canonicalName === '顾长风') &&
        view.entities.some((entity) => entity.canonicalName === '豹头'),
      `entities=${view.entities.length}`,
    );
  }

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

async function smokeExtractionConflictResume(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-extract-conflict-'));
  const dbPath = join(dir, 'orch-extract-conflict.db');
  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const factStore = new SqliteFactStore(db);
  const confirmed = sampleEntity();
  const version = await factStore.appendVersion();
  await factStore.putEntity(version, {
    ...confirmed,
    attributes: [
      {
        key: 'skill',
        value: '不会听劲',
        status: 'confirmed',
        provenance: confirmed.provenance,
      },
    ],
  }, null);

  const resolver = new FakeModelResolver(
    `{
      "candidates": [
        {
          "kind": "attribute",
          "suggestedAnchor": {"id": "chapter-conflict", "kind": "chapter"},
          "confidence": 0.88,
          "payload": {"entityName": "顾长风", "key": "skill", "value": "听劲", "quote": "碎壶不伤手"}
        }
      ]
    }`,
    'unused reviewer text',
  ).asResolver();
  const runtime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => undefined,
    getFactStore: () => factStore,
  });

  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  await runtime.extractFacts(wc.asWebContents(), runId, {
    location: { id: asNodeId('chapter-conflict'), kind: 'chapter' },
    text: '顾长风碎壶不伤手，显出听劲。',
  });
  const completed = wc.control.find((event) => event.type === 'fact-extraction-completed');
  const interrupt = collectInterrupt(wc);
  check(
    '抽取冲突：不自动覆盖 confirmed，转 interrupt-raised',
    completed?.type === 'fact-extraction-completed' &&
      completed.conflicts === 1 &&
      interrupt?.type === 'interrupt-raised',
    completed?.type === 'fact-extraction-completed' ? `conflicts=${completed.conflicts}` : '无 completed',
  );

  const wc2 = new FakeWebContents();
  await runtime.resume(wc2.asWebContents(), runId, { kind: 'correct', optionId: 'accept-new' });
  const accepted = wc2.control.find((event) => event.type === 'fact-extraction-completed');
  check(
    '抽取冲突：resume accept-new 后写入新事实',
    accepted?.type === 'fact-extraction-completed' && accepted.autoIngested === 1,
    accepted?.type === 'fact-extraction-completed' ? `auto=${accepted.autoIngested}` : '无 completed',
  );
  const latest = await factStore.getLatestVersion();
  if (latest !== null) {
    const view = await factStore.getView(latest);
    const gu = view.entities.find((entity) => entity.canonicalName === '顾长风');
    check(
      '抽取冲突：作者接受后事实库属性更新',
      gu?.attributes.some((attr) => attr.key === 'skill' && attr.value === '听劲') === true,
      gu !== undefined ? JSON.stringify(gu.attributes.map((attr) => `${attr.key}=${attr.value}`)) : '无顾长风',
    );
  }

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

function smokeReviewerJsonDefence(): void {
  const brokenFinal = `[
    {
      "type": "other",
      "severity": "warning",
      "anchors": [{"id":"chapter-4","kind":"chapter"}],
      "description": "白灰画圈缺少来源交代。",
      "suggestedFix": "补一句白灰来源。",
      "evidence": "他用白灰画了大大小小无数个圈",
      "requiresHumanDecision": false
    },
    {
      "description": "儿童画已经揣进怀里，后堂开包时又出现在皮包里，物品状态重复。",
      "suggestedFix": "删除后堂包内儿童画，改为确认怀中画还在。",
      "evidence": {"quote":"除了这些，还有一张用蜡笔画的儿童画"},
      "requiresHumanDecision": true,
      "options": [{"id":"remove-duplicate","label":"删除后堂重复儿童画"}]
    },
    {
      "description": "这条故意截断，不应污染前两条",
      "suggestedFix": "删除后面那个站起身"`;
  const reasoning = '1. 状态矛盾：儿童画位置重复。2. 命名冲突：豹头突然称顾长风为九爷。';
  const parsed = parseReviewerIssuesWithDiagnostics(brokenFinal, reasoning);
  check(
    'reviewer JSON 防守：半截 final 抢救完整 issue',
    parsed.issues.length === 2 && parsed.diagnostics.source === 'final-object-salvage',
    `count=${parsed.issues.length} source=${parsed.diagnostics.source}`,
  );
  check(
    'reviewer JSON 防守：不把 suggestedFix 字符串误当问题',
    parsed.issues.every((issue) => !issue.description.includes('站起身')),
  );
  check(
    'reviewer JSON 防守：字段漂移可补齐/规范化',
    parsed.issues.some(
      (issue) =>
        issue.description.includes('儿童画') &&
        issue.type === 'state-contradiction' &&
        issue.severity === 'warning' &&
        issue.requiresHumanDecision === true,
    ),
  );
}

/** I5：全书总检经 InlineAuditRunner 派发——播种 conflicting 实体应产出红牌，并验证中断路径。 */
async function smokeGlobalAudit(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-audit-'));
  const dbPath = join(dir, 'orch-audit.db');
  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const factStore = new SqliteFactStore(db);

  // 播种一个 conflicting 实体（有出处）→ detectConflictingStatuses 应产出 critical 红牌。
  const provenance: Provenance = {
    sources: [
      { location: { id: asNodeId('chapter-4'), kind: 'chapter' }, quote: '顾长风摸壶不伤手', confidence: 0.9 },
    ],
  };
  const version = await factStore.appendVersion();
  await factStore.putEntity(
    version,
    {
      id: asEntityId('ent-conflict'),
      type: 'person',
      canonicalName: '大老王',
      aliasSet: { aliases: ['大老王', '王哥'], status: 'confirmed', provenance },
      attributes: [],
      status: 'conflicting',
      provenance,
    },
    null,
  );

  const runtime = new OrchestrationRuntime({
    getModelResolver: () => undefined,
    getCheckpointer: () => undefined,
    getFactStore: () => factStore,
    getAuditRunner: () => new InlineAuditRunner(),
  });

  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  await runtime.runGlobalAudit(wc.asWebContents(), runId);

  const started = wc.control.find((e) => e.type === 'global-audit-started');
  const completed = wc.control.find((e) => e.type === 'global-audit-completed');
  check(
    '全书总检：下发 started/completed 控制事件',
    started?.type === 'global-audit-started' && completed?.type === 'global-audit-completed',
    `started=${started !== undefined} completed=${completed !== undefined}`,
  );
  if (completed?.type === 'global-audit-completed') {
    const issues = completed.dashboard.issues;
    check(
      '全书总检：conflicting 实体产出红牌且健康分受损',
      issues.some((i) => i.severity === 'critical') && completed.dashboard.healthScore < 100,
      `issues=${issues.length} score=${completed.dashboard.healthScore}`,
    );
  }

  // 中断路径：已 abort 的 runId 应下发 aborted 类别失败。
  const wc2 = new FakeWebContents();
  const runId2 = randomUUID() as RunId;
  const auditPromise = runtime.runGlobalAudit(wc2.asWebContents(), runId2);
  runtime.abort(runId2);
  await auditPromise;
  const failed = wc2.control.find((e) => e.type === 'global-audit-failed');
  check(
    '全书总检：abort 后下发 aborted 失败（或已完成）',
    failed === undefined ||
      (failed.type === 'global-audit-failed' && failed.error.category === 'aborted'),
    failed?.type === 'global-audit-failed' ? `category=${failed.error.category}` : '纯计算极快，已在 abort 前完成',
  );

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

/** 初始空状态播种 checkpoint 用于 restart 场景备用。 */
async function seedCheckpoint(
  checkpointer: SqliteCheckpointer,
  draft: string,
): Promise<string> {
  const cp = await checkpointer.commit('writer', sampleState(draft), null);
  return cp.id as string;
}

/**
 * I6：局部重构 diff/hunk 纯管道——裁片段→InlineDiffRunner 算 diff 拆 hunk→接受部分 hunk→
 * spliceAcceptedHunks 拼回，校验：只改接受区间、拒绝项与片段外正文不动、中断可回。
 * 不依赖 utilityProcess（走 InlineDiffRunner）也不碰磁盘正文（拼回为纯函数）。
 */
async function smokeRefactorDiffSplice(): Promise<void> {
  const nodeText = '顾长风揠住茶壶，手腕一抖，碎壶不伤手。大老王看得目瞪口呆。';
  // 待修片段：取开头一句（[0, 11)）。
  const anchor: FragmentAnchor = { node: { id: asNodeId('chapter-A'), kind: 'chapter' }, from: 0, to: 11 };
  const fragment = carveFragment(nodeText, anchor);
  check('I6 裁出待修片段', fragment !== null, fragment?.text);
  if (fragment === null) return;

  // 改写片段：改动头尾两处（产出多个 hunk）。
  const rewritten = '顾九揠紧铁壶，手腕一抽，碎壶不伤手';
  const runner = new InlineDiffRunner();
  const controller = new AbortController();
  const diff = await runner.run(fragment, rewritten, controller.signal);
  check('I6 diff 产出 hunk', diff.hunks.length > 0, `hunks=${diff.hunks.length}`);

  // hunk 需限于片段范围（偏移落在 [0, fragment.text.length]）。
  const inBounds = diff.hunks.every(
    (h) => h.fragmentFrom >= 0 && h.fragmentTo <= fragment.text.length && h.fragmentFrom <= h.fragmentTo,
  );
  check('I6 hunk 限于片段范围', inBounds);

  // 全接受→拼回 = 改写全文。
  const validity: Record<string, HunkValidity> = {};
  for (const h of diff.hunks) validity[h.id] = 'valid';
  const acceptAll = spliceAcceptedHunks(
    diff,
    diff.hunks.map((h) => ({ hunkId: h.id, decision: 'accept' as const })),
    validity,
  );
  check('I6 全接受拼回=改写全文', acceptAll.ok && acceptAll.fragmentText === rewritten, acceptAll.ok ? acceptAll.fragmentText : acceptAll.reason);

  // 全拒绝→拼回 = 原片段（原文分毫不动）。
  const rejectAll = spliceAcceptedHunks(
    diff,
    diff.hunks.map((h) => ({ hunkId: h.id, decision: 'reject' as const })),
    validity,
  );
  check('I6 全拒绝拼回=原片段', rejectAll.ok && rejectAll.fragmentText === fragment.text);

  // 仅接受首个 hunk：其余区间保持原文。
  const firstHunk = diff.hunks[0];
  if (firstHunk !== undefined) {
    const partial = spliceAcceptedHunks(
      diff,
      [{ hunkId: firstHunk.id, decision: 'accept' }],
      validity,
    );
    const expectedPartial =
      fragment.text.slice(0, firstHunk.fragmentFrom) +
      firstHunk.rewritten +
      fragment.text.slice(firstHunk.fragmentTo);
    check('I6 部分接受仅改接受区间', partial.ok && partial.fragmentText === expectedPartial);
  }

  // 失效 hunk 被接受→不盲拼。
  if (firstHunk !== undefined) {
    const invalid: Record<string, HunkValidity> = { ...validity, [firstHunk.id]: 'invalidated' };
    const blocked = spliceAcceptedHunks(diff, [{ hunkId: firstHunk.id, decision: 'accept' }], invalid);
    check('I6 失效项被接受拒拼回', !blocked.ok && blocked.reason === 'hunk-invalidated');
  }

  // 中断路径：预先 abort → DiffRunner 抛 DiffAbortedError。
  const aborted = new AbortController();
  aborted.abort();
  let abortedThrew = false;
  try {
    await runner.run(fragment, rewritten, aborted.signal);
  } catch {
    abortedThrew = true;
  }
  check('I6 预先中断 diff 抛错', abortedThrew);
}

/**
 * I7：素材语义检索纯管道——InMemoryCorpusStore 落种 + InlineEmbedRunner（不依赖 utilityProcess）
 * 经 runtime.retrieveCorpus 验证：corpus-retrieval-started/completed 下发、命中按分降序、
 * 过滤 + topK 截断生效、embedding 确定性（同输入两次等）、作用域隔离。
 */
async function smokeCorpusRetrieval(): Promise<void> {
  const projectId = 'project-1';
  const makeItem = (
    id: string,
    type: string,
    content: string,
    tags: ReadonlyArray<string>,
    sourceKind?: string,
  ): CorpusItem => ({
    id: asCorpusItemId(id),
    type,
    content,
    tags,
    ...(sourceKind !== undefined
      ? { source: { kind: sourceKind, label: `来源-${sourceKind}` } }
      : {}),
  });

  const items: ReadonlyArray<CorpusItem> = [
    makeItem('c1', 'highlight', '月光下的荒原，风声呜咽，孤影独行。', ['氛围', '荒原'], 'external'),
    makeItem('c2', 'plot-device', '茶馆里递皮包对暗号的桥段。', ['桥段', '谍战'], 'discarded-draft'),
    makeItem('c3', 'style-sample', '短句。铁一样的冷。刀锋般的白。', ['文风'], 'other-work'),
  ];
  const vectors = computeEmbeddings(items.map((it) => it.content));

  const store = new InMemoryCorpusStore();
  items.forEach((item, i) => {
    const vec = vectors[i];
    if (vec !== undefined) store.add({ item, vector: vec, residence: { scope: 'global' } });
  });
  // 一条项目私有条目（用于作用域隔离校验）。
  const privItem = makeItem('c4', 'highlight', '荒原尽头的孤灯。', ['荒原'], 'manual');
  const privVec = computeEmbeddings([privItem.content])[0];
  if (privVec !== undefined) {
    store.add({ item: privItem, vector: privVec, residence: { scope: 'project', projectId: asCorpusProjectId(projectId) } });
  }

  const runtime = new OrchestrationRuntime({
    getModelResolver: () => undefined,
    getCheckpointer: () => undefined,
    getFactStore: () => undefined,
    getEmbedRunner: () => new InlineEmbedRunner(),
    getCorpusStore: () => store,
  });

  // 全局作用域检索「荒原氛围」：应命中 c1（含私有 c4 亦全局可见）。
  const globalScope: CorpusScope = { level: 'global', projectId: null, workId: null };
  const wc = new FakeWebContents();
  await runtime.retrieveCorpus(wc.asWebContents(), randomUUID() as RunId, {
    query: '荒原 月光 孤影 氛围',
    scope: globalScope,
    topK: 2,
  });
  const started = wc.control.find((e) => e.type === 'corpus-retrieval-started');
  const completed = wc.control.find((e) => e.type === 'corpus-retrieval-completed');
  check('I7 检索下发 started', started !== undefined);
  check('I7 检索下发 completed', completed !== undefined);
  if (completed !== undefined && completed.type === 'corpus-retrieval-completed') {
    const hits = completed.hits;
    check('I7 topK 截断至 2', hits.length <= 2, `hits=${hits.length}`);
    const desc = hits.every((h, i) => i === 0 || (hits[i - 1]?.score ?? 0) >= h.score);
    check('I7 命中按分数降序', desc);
    check('I7 荒原查询首命中 c1', hits[0]?.item.id === 'c1', hits[0]?.item.id);
  }

  // 过滤：仅 plot-device 类型 → 只应返回 c2。
  const wcFilter = new FakeWebContents();
  await runtime.retrieveCorpus(wcFilter.asWebContents(), randomUUID() as RunId, {
    query: '桥段 暗号',
    scope: globalScope,
    filter: { types: ['plot-device'] },
  });
  const fc = wcFilter.control.find((e) => e.type === 'corpus-retrieval-completed');
  if (fc !== undefined && fc.type === 'corpus-retrieval-completed') {
    const onlyPlot = fc.hits.every((h) => h.item.type === 'plot-device');
    check('I7 类型过滤仅返回 plot-device', onlyPlot && fc.hits.length === 1, `n=${fc.hits.length}`);
  }

  // 作用域隔离：project 作用域（不同 projectId）→ 私有 c4 不可见，仅全局三条参与。
  const otherProjectScope: CorpusScope = {
    level: 'project',
    projectId: asCorpusProjectId('project-2'),
    workId: null,
  };
  const wcScope = new FakeWebContents();
  await runtime.retrieveCorpus(wcScope.asWebContents(), randomUUID() as RunId, {
    query: '荒原',
    scope: otherProjectScope,
  });
  const sc = wcScope.control.find((e) => e.type === 'corpus-retrieval-completed');
  if (sc !== undefined && sc.type === 'corpus-retrieval-completed') {
    const hasPrivate = sc.hits.some((h) => h.item.id === 'c4');
    check('I7 他项目作用域不见私有条目', !hasPrivate);
  }

  // embedding 确定性：同输入两次相等。
  const e1 = computeEmbeddings(['荒原月光']);
  const e2 = computeEmbeddings(['荒原月光']);
  const equal =
    e1.length === e2.length &&
    (e1[0]?.length ?? -1) === (e2[0]?.length ?? -2) &&
    (e1[0] ?? []).every((v, i) => v === (e2[0]?.[i] ?? NaN));
  check('I7 embedding 确定性', equal);

  // 中断路径：预先 abort 的 runId 无法在此直接注入（retrieveCorpus 内部起 run），
  // 改以 InlineEmbedRunner 预中断校验其抛 EmbedAbortedError 已在单元层覆盖；此处校验失败事件通道。
  const wcFail = new FakeWebContents();
  const failRunId = randomUUID() as RunId;
  const failRuntime = new OrchestrationRuntime({
    getModelResolver: () => undefined,
    getCheckpointer: () => undefined,
    getFactStore: () => undefined,
    getEmbedRunner: () => ({
      run: async () => {
        throw new Error('boom');
      },
    }),
    getCorpusStore: () => store,
  });
  await failRuntime.retrieveCorpus(wcFail.asWebContents(), failRunId, {
    query: 'x',
    scope: globalScope,
  });
  const failed = wcFail.control.find((e) => e.type === 'corpus-retrieval-failed');
  check('I7 计算失败下发 failed 事件', failed !== undefined);
}

function smokeTargetedVerificationRouting(): void {
  check('针对性复检：事实一致性问题路由 fact-checker', targetedVerificationAgentFor('timeline-break') === 'fact-checker');
  check('针对性复检：原创性问题路由 plagiarism-checker', targetedVerificationAgentFor('plagiarism-risk') === 'plagiarism-checker');
  check('针对性复检：行为与未知问题回退 reviewer', targetedVerificationAgentFor('behavior-ooc') === 'reviewer' && targetedVerificationAgentFor('custom-editorial') === 'reviewer');
}

async function smokeWorkflowReviewerIssuePersistence(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-workflow-review-'));
  const opened = await openDatabase(join(dir, 'workflow-review.db'));
  if (!opened.ok) {
    check('workflow reviewer SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const workflows = new WorkflowRepository(db);
    const workflowIssues = new WorkflowIssueRepository(db);
    const service = new WorkflowApplicationService(workflows, new CreativeAssetRepository(db), workflowIssues);
    const workflow = await service.command({
      type: 'start-workflow', workflowId: 'review-workflow', projectId: 'review-project',
      kind: 'new-book-creation', objective: 'review persistence', requestId: 'review-start', operationId: 'review-start-op',
    });
    if (workflow === null || workflow.currentStageId === null) throw new Error('workflow fixture failed');
    const [chapterId] = await readManifestChapterIds();
    if (chapterId === undefined) throw new Error('workflow fixture has no manifest chapter');
    const issueText = JSON.stringify([{
      type: 'behavior-ooc', severity: 'warning', anchors: [{ id: chapterId, kind: 'chapter' }],
      description: '主角在证据段落中的行为与既定性格不一致。', requiresHumanDecision: false,
      evidence: { quote: '他忽然丢下同伴独自离开。' },
    }]);
    const workflowRef = { workflowId: workflow.workflowId, stageId: workflow.currentStageId };
    const originalManuscript = '他忽然丢下同伴独自离开。随后，他回头解释自己的决定。';
    let manuscriptText = originalManuscript;
    const manuscript = {
      readChapterContent: async (nodeId: string) => ({ nodeId, content: manuscriptText }),
      writeBackRefactoredFragment: async (anchor: FragmentAnchor, fragmentText: string) => {
        manuscriptText = manuscriptText.slice(0, anchor.from) + fragmentText + manuscriptText.slice(anchor.to);
        return { ok: true, newContentLength: manuscriptText.length };
      },
    };
    const runtime = (resolver: ModelResolver) => new OrchestrationRuntime({
      getModelResolver: () => resolver,
      getCheckpointer: () => new SqliteCheckpointer(db),
      getFactStore: () => new SqliteFactStore(db),
      workflows,
      workflowIssues,
      stageRunEvidence: new SqliteStageRunEvidenceRecorder(db),
      manuscript,
    });
    const runId = randomUUID() as RunId;
    const wc = new FakeWebContents();
    await runtime(new FakeModelResolver('unused', issueText).asResolver()).summon(wc.asWebContents(), {
      runId, mode: 'diagnose', agent: 'reviewer', initialDraft: '他忽然丢下同伴独自离开。',
      anchorNodeId: chapterId, instruction: '审校这一章', workflowRef,
    });
    const event = wc.control.find((item) => item.type === 'review-completed');
    const dto = event?.type === 'review-completed' ? event.issues[0] : undefined;
    const persisted = dto?.issueId === undefined ? null : await workflowIssues.get(dto.issueId);
    const stageRun = await db.get('SELECT evidence_json FROM workflow_stage_runs WHERE stage_id=? AND run_id=?', workflow.currentStageId, runId);
    const evidence = stageRun === null ? null : JSON.parse(String(stageRun['evidence_json'])) as { completion?: { issueIds?: string[] } };
    check('workflow reviewer 写入稳定 issueId', dto?.issueId !== undefined && persisted?.issueId === dto.issueId);
    check('workflow reviewer DTO 携 lifecycle 状态', dto?.workflowStatus === 'open');
    check('workflow reviewer 使用 manifest 章节锚点', dto?.anchors[0]?.id === chapterId);
    check('stage-run quality evidence 使用真实 issueId', evidence?.completion?.issueIds?.[0] === dto?.issueId);

    if (dto?.issueId === undefined) throw new Error('reviewer did not persist issue');
    await workflowIssues.select(dto.issueId, 'author', 'targeted-fix-pass');
    await workflowIssues.linkCheckpointAndMarkVerifying(dto.issueId, 'checkpoint-targeted-pass');
    const passRunId = randomUUID() as RunId;
    const passWc = new FakeWebContents();
    await runtime(new FakeModelResolver('unused', '[]').asResolver()).runTargetedVerification(
      passWc.asWebContents(), passRunId, { ...workflowRef, issueId: dto.issueId },
    );
    const passEvent = passWc.control.find((item) => item.type === 'targeted-verification-completed');
    const passIssue = await workflowIssues.get(dto.issueId);
    check('targeted verification 通过由 Main 判定', passEvent?.type === 'targeted-verification-completed' && passEvent.passed);
    check('targeted verification 通过后 issue resolved', passIssue?.status === 'resolved');
    check('targeted verification 持久化 verification run', passIssue !== null && passIssue.verificationRunIds.includes(passRunId));

    await workflowIssues.upsertFromAudit(workflow.workflowId, 'final-audit-recurrence', [JSON.parse(issueText)[0] as ConsistencyIssueDto]);
    await workflowIssues.select(dto.issueId, 'author', 'targeted-fix-fail');
    await workflowIssues.linkCheckpointAndMarkVerifying(dto.issueId, 'checkpoint-targeted-fail');
    const failRunId = randomUUID() as RunId;
    const failWc = new FakeWebContents();
    await runtime(new FakeModelResolver('unused', issueText).asResolver()).runTargetedVerification(
      failWc.asWebContents(), failRunId, { ...workflowRef, issueId: dto.issueId },
    );
    const failEvent = failWc.control.find((item) => item.type === 'targeted-verification-completed');
    const failIssue = await workflowIssues.get(dto.issueId);
    check('targeted verification 复发判定失败', failEvent?.type === 'targeted-verification-completed' && !failEvent.passed);
    check('targeted verification 失败后 issue 回 fixing', failIssue?.status === 'fixing');

    const prepareLegacyVerification = async (workflowId: string, refactorRunId?: RunId): Promise<{ workflowRef: { workflowId: string; stageId: string }; issueId: string }> => {
      const legacy = await service.command({
        type: 'start-workflow', workflowId, projectId: `${workflowId}-project`,
        kind: 'legacy-book-revision', objective: 'targeted verification stage',
        requestId: `${workflowId}-start`, operationId: `${workflowId}-start-op`,
      });
      if (legacy === null) throw new Error('legacy workflow fixture failed');
      const [legacyIssue] = await workflowIssues.upsertFromAudit(workflowId, `${workflowId}-audit`, [JSON.parse(issueText)[0] as ConsistencyIssueDto]);
      if (legacyIssue === undefined) throw new Error('legacy issue fixture failed');

      const evidence = new SqliteStageRunEvidenceRecorder(db);
      const advanceStage = async (expectedTemplateStageId: string, actor: 'author' | 'automatic', runLabel: string): Promise<void> => {
        const current = await workflows.get(workflowId);
        if (current === null || current.currentStageId === null) throw new Error(`legacy stage missing: ${expectedTemplateStageId}`);
        const stage = current.stages.find((candidate) => candidate.stageId === current.currentStageId);
        if (stage?.templateStageId !== expectedTemplateStageId) throw new Error(`expected ${expectedTemplateStageId}, got ${stage?.templateStageId} status=${stage?.status} workflowStatus=${current.status}`);
        const run = `${workflowId}:${runLabel}` as RunId;
        const started = await service.command({
          type: 'workflow-start-stage', workflowId, stageId: current.currentStageId,
          expectedVersion: current.version, runId: run, requestId: `${runLabel}-start`, operationId: `${runLabel}-start-op`,
        });
        if (started === null) throw new Error(`failed to start ${expectedTemplateStageId}`);
        await evidence.record({ runId: run, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'started' });
        await evidence.record({
          runId: run, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'completed',
          ...(stage.actor === 'quality-gate' ? { completion: { passed: true, issueIds: [] } } : {}),
        });
        if (actor === 'author') {
          const awaiting = await workflows.get(workflowId);
          if (awaiting === null || awaiting.currentStageId === null) throw new Error(`author stage disappeared: ${expectedTemplateStageId}`);
          const confirmed = await service.command({
            type: 'workflow-confirm-stage', workflowId, stageId: awaiting.currentStageId,
            expectedVersion: awaiting.version, requestId: `${workflowId}-${runLabel}-confirm`, operationId: `${workflowId}-${runLabel}-confirm-op`,
          });
          if (confirmed?.currentStageId === awaiting.currentStageId) throw new Error(`confirmation did not advance ${expectedTemplateStageId}`);
        }
      };

      await advanceStage('import-book', 'author', 'import-book');
      await advanceStage('fact-backfill', 'automatic', 'fact-backfill');
      await advanceStage('initial-audit', 'automatic', 'initial-audit');
      await advanceStage('issue-triage', 'author', 'issue-triage');
      const activeRefactorRunId = refactorRunId ?? `${workflowId}-fix` as RunId;
      await workflowIssues.select(legacyIssue.issueId, 'author', activeRefactorRunId);
      await advanceStage('locate-source', 'automatic', 'locate-source');
      await advanceStage('generate-rewrite', 'author', 'generate-rewrite');
      await advanceStage('hunk-review', 'author', 'hunk-review');
      await advanceStage('apply-checkpoint', 'author', 'apply-checkpoint');
      if (refactorRunId !== undefined) {
        const anchor: FragmentAnchor = { node: { id: asNodeId(chapterId), kind: 'chapter' }, from: 0, to: originalManuscript.length };
        const refactorWc = new FakeWebContents();
        const rewritten = '他没有丢下同伴，而是先安排他们安全撤离。随后，他回头解释自己的决定。';
        const refactorRuntime = runtime(new FakeModelResolver('unused', '[]').asResolver());
        await refactorRuntime.computeRefactorDiff(
          refactorWc.asWebContents(), refactorRunId, anchor, rewritten,
          { workflowId, stageId: (await workflows.get(workflowId))?.currentStageId ?? '', issueId: legacyIssue.issueId },
        );
        const diffEvent = refactorWc.control.find((item) => item.type === 'refactor-diff-computed');
        if (diffEvent?.type !== 'refactor-diff-computed') throw new Error(`legacy refactor diff fixture failed: ${JSON.stringify(refactorWc.control)}`);
        await refactorRuntime.applyHunkDecisions(
          refactorWc.asWebContents(), refactorRunId, anchor, rewritten,
          diffEvent.hunks.map((hunk) => ({ hunkId: hunk.id, decision: 'accept' as const })),
          { workflowId, stageId: diffEvent.workflowRef?.stageId ?? '', issueId: legacyIssue.issueId },
        );
        const applied = refactorWc.control.find((item) => item.type === 'refactor-applied');
        const applyFailed = refactorWc.control.find((item) => item.type === 'refactor-apply-failed');
        check('legacy 完整 E2E 写回隔离正文', manuscriptText === rewritten, applyFailed?.type === 'refactor-apply-failed' ? JSON.stringify(applyFailed) : undefined);
        check('legacy 完整 E2E 产生 refactor-applied', applied?.type === 'refactor-applied');
      }
      const checkpoint = `${workflowId}-checkpoint`;
      const currentIssue = await workflowIssues.get(legacyIssue.issueId);
      if (currentIssue?.status !== 'verifying') await workflowIssues.linkCheckpointAndMarkVerifying(legacyIssue.issueId, checkpoint);
      const targeted = await workflows.get(workflowId);
      if (targeted === null || targeted.currentStageId === null) throw new Error('legacy targeted stage missing');
      return { workflowRef: { workflowId, stageId: targeted.currentStageId }, issueId: legacyIssue.issueId };
    };

    const legacyPassRunId = randomUUID() as RunId;
    const legacyPass = await prepareLegacyVerification('legacy-targeted-pass', legacyPassRunId);
    const legacyPassWc = new FakeWebContents();
    await runtime(new FakeModelResolver('unused', '[]').asResolver()).runTargetedVerification(
      legacyPassWc.asWebContents(), legacyPassRunId, { ...legacyPass.workflowRef, issueId: legacyPass.issueId },
    );
    const legacyPassSnapshot = await workflows.get(legacyPass.workflowRef.workflowId);
    const legacyPassEvent = legacyPassWc.control.find((item) => item.type === 'workflow-snapshot');
    check('legacy targeted verification 通过推进到 close-issue', legacyPassSnapshot?.stages.find((stage) => stage.stageId === legacyPassSnapshot.currentStageId)?.templateStageId === 'close-issue');
    check('legacy targeted verification 通过下发 workflow snapshot', legacyPassEvent?.type === 'workflow-snapshot' && legacyPassEvent.snapshot.currentStageId === legacyPassSnapshot?.currentStageId);

    const legacyFailRunId = randomUUID() as RunId;
    const legacyFail = await prepareLegacyVerification('legacy-targeted-fail');
    const legacyFailWc = new FakeWebContents();
    await runtime(new FakeModelResolver('unused', issueText).asResolver()).runTargetedVerification(
      legacyFailWc.asWebContents(), legacyFailRunId, { ...legacyFail.workflowRef, issueId: legacyFail.issueId },
    );
    const legacyFailSnapshot = await workflows.get(legacyFail.workflowRef.workflowId);
    check('legacy targeted verification 失败回到 generate-rewrite', legacyFailSnapshot?.stages.find((stage) => stage.stageId === legacyFailSnapshot.currentStageId)?.templateStageId === 'generate-rewrite');

    const prepareFinalAudit = async (workflowId: string, auditRunId: RunId): Promise<{ workflowRef: { workflowId: string; stageId: string }; issueId?: string }> => {
      const legacy = await service.command({
        type: 'start-workflow', workflowId, projectId: `${workflowId}-project`,
        kind: 'legacy-book-revision', objective: 'final audit loop',
        requestId: `${workflowId}-start`, operationId: `${workflowId}-start-op`,
      });
      if (legacy === null) throw new Error('final audit workflow fixture failed');
      const evidence = new SqliteStageRunEvidenceRecorder(db);
      for (const [index, stageTemplateId] of ['import-book', 'fact-backfill', 'initial-audit', 'issue-triage', 'locate-source', 'generate-rewrite', 'hunk-review', 'apply-checkpoint'].entries()) {
        const current = await workflows.get(workflowId);
        if (current === null || current.currentStageId === null) throw new Error(`final audit fixture missing stage ${stageTemplateId}`);
        const stage = current.stages.find((candidate) => candidate.stageId === current.currentStageId);
        if (stage?.templateStageId !== stageTemplateId) throw new Error(`final audit fixture expected ${stageTemplateId}, got ${stage?.templateStageId}`);
        const run = `${workflowId}:pre-final:${index}` as RunId;
        const started = await service.command({
          type: 'workflow-start-stage', workflowId, stageId: current.currentStageId,
          expectedVersion: current.version, runId: run,
          requestId: `${workflowId}-pre-final-${index}-start`, operationId: `${workflowId}-pre-final-${index}-start-op`,
        });
        if (started === null) throw new Error(`failed to start ${stageTemplateId}`);
        await evidence.record({ runId: run, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'started' });
        await evidence.record({
          runId: run, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'completed',
          ...(stage.actor === 'quality-gate' ? { completion: { passed: true, issueIds: [] } } : {}),
        });
        if (stage.actor === 'author' || stage.actor === 'expert') {
          const awaiting = await workflows.get(workflowId);
          if (awaiting === null || awaiting.currentStageId === null) throw new Error(`author stage disappeared: ${stageTemplateId}`);
          await service.command({
            type: 'workflow-confirm-stage', workflowId, stageId: awaiting.currentStageId,
            expectedVersion: awaiting.version, requestId: `${workflowId}-pre-final-${index}-confirm`, operationId: `${workflowId}-pre-final-${index}-confirm-op`,
          });
        }
      }
      let current = await workflows.get(workflowId);
      if (current === null || current.currentStageId === null) throw new Error('targeted verification stage missing');
      const targetedStageId = current.currentStageId;
      const targetedStage = current.stages.find((stage) => stage.stageId === targetedStageId);
      if (targetedStage?.templateStageId !== 'targeted-verification') throw new Error(`expected targeted-verification, got ${targetedStage?.templateStageId}`);
      const targetedRun = `${workflowId}:pre-final-targeted` as RunId;
      await evidence.record({ runId: targetedRun, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'started' });
      await evidence.record({ runId: targetedRun, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'completed', completion: { passed: true, issueIds: [] } });
      current = await workflows.get(workflowId);
      if (current === null || current.currentStageId === null) throw new Error('close issue stage missing');
      const closeStageId = current.currentStageId;
      const closeStage = current.stages.find((stage) => stage.stageId === closeStageId);
      if (closeStage?.templateStageId !== 'close-issue') throw new Error(`expected close-issue, got ${closeStage?.templateStageId}`);
      const closeRun = `${workflowId}:pre-final-close` as RunId;
      await evidence.record({ runId: closeRun, workflowRef: { workflowId, stageId: closeStageId }, status: 'started' });
      await evidence.record({ runId: closeRun, workflowRef: { workflowId, stageId: closeStageId }, status: 'completed' });
      current = await workflows.get(workflowId);
      if (current === null || current.currentStageId === null) throw new Error('final audit stage missing');
      const finalStage = current.stages.find((stage) => stage.stageId === current.currentStageId);
      if (finalStage?.templateStageId !== 'final-audit') throw new Error(`expected final-audit, got ${finalStage?.templateStageId}`);
      const started = await service.command({
        type: 'workflow-start-stage', workflowId, stageId: current.currentStageId,
        expectedVersion: current.version, runId: auditRunId,
        requestId: `${workflowId}-final-start`, operationId: `${workflowId}-final-start-op`,
      });
      if (started === null) throw new Error('failed to start final audit');
      await evidence.record({ runId: auditRunId, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'started' });
      return { workflowRef: { workflowId, stageId: current.currentStageId } };
    };
    const auditResult = (issues: ReadonlyArray<ConsistencyIssue>): AuditRunner => ({
      run: async () => ({
        factVersion: 'fixture-fact-version', generatedAt: Date.now(),
        healthScore: issues.length === 0 ? 100 : 80,
        scoreExplanation: { criticalWeight: 20, warningWeight: 10, infoWeight: 2, criticalCount: 0, warningCount: issues.length, infoCount: 0, penalty: issues.length * 10, formula: 'fixture' }, totalItems: 1,
        issues,
      }),
    });
    await new SqliteFactStore(db).appendVersion();
    const finalPassRunId = randomUUID() as RunId;
    const finalPass = await prepareFinalAudit('legacy-final-pass', finalPassRunId);
    const finalPassWc = new FakeWebContents();
    const finalPassRuntime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => new SqliteCheckpointer(db),
      getFactStore: () => new SqliteFactStore(db),
      getAuditRunner: () => auditResult([]),
      workflows, workflowIssues,
      stageRunEvidence: new SqliteStageRunEvidenceRecorder(db),
    });
    await finalPassRuntime.runGlobalAudit(finalPassWc.asWebContents(), finalPassRunId, finalPass.workflowRef);
    const finalPassSnapshot = await workflows.get(finalPass.workflowRef.workflowId);
    check('final-audit 无问题后工作流完成', finalPassSnapshot?.status === 'completed');

    const finalFinding = {
      ...JSON.parse(issueText)[0] as ConsistencyIssue,
      description: '最终复检重新发现的问题。',
      anchors: [{ id: asNodeId(chapterId), kind: 'chapter' as const }],
    };
    const finalIssueRunId = randomUUID() as RunId;
    const finalIssue = await prepareFinalAudit('legacy-final-issues', finalIssueRunId);
    const finalIssueWc = new FakeWebContents();
    const finalIssueRuntime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => new SqliteCheckpointer(db),
      getFactStore: () => new SqliteFactStore(db),
      getAuditRunner: () => auditResult([finalFinding]),
      workflows, workflowIssues,
      stageRunEvidence: new SqliteStageRunEvidenceRecorder(db),
    });
    await finalIssueRuntime.runGlobalAudit(finalIssueWc.asWebContents(), finalIssueRunId, finalIssue.workflowRef);
    const finalIssueSnapshot = await workflows.get(finalIssue.workflowRef.workflowId);
    const finalIssueRecord = finalIssueWc.control.find((item) => item.type === 'global-audit-completed');
    check('final-audit 发现新问题后回到 issue-triage', finalIssueSnapshot?.stages.find((stage) => stage.stageId === finalIssueSnapshot.currentStageId)?.templateStageId === 'issue-triage');
    check('final-audit 回环持久化新 issue', finalIssueRecord?.type === 'global-audit-completed' && finalIssueRecord.dashboard.issues[0]?.issueId !== undefined);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 视觉设计契约冒烟 (I8 visual-design)：验证 core 侧可测契约——
 * 每个 agent 目录条目都有图标名；主题解析真值表正确；三态循环遍历全部偏好。
 */
function smokeVisualDesignContracts(): void {
  const allHaveIcons = AGENT_CATALOG_ENTRIES.every((entry) => entry.icon.length > 0);
  check('I8 每个 agent 目录条目都有拟人图标名', allHaveIcons, `${AGENT_CATALOG_ENTRIES.length} 个条目`);

  check(
    'I8 resolveTheme 真值表',
    resolveTheme('light', false) === 'light' &&
      resolveTheme('light', true) === 'light' &&
      resolveTheme('dark', false) === 'dark' &&
      resolveTheme('dark', true) === 'dark' &&
      resolveTheme('system', true) === 'dark' &&
      resolveTheme('system', false) === 'light',
  );

  const cycle: ThemePreference[] = ['light'];
  let cur: ThemePreference = 'light';
  for (let i = 0; i < 3; i += 1) {
    cur = cycleThemePreference(cur);
    cycle.push(cur);
  }
  // 期望 light→dark→system→light（回到起点），且覆盖全部三态。
  check(
    'I8 cycleThemePreference 三态循环',
    cycle[1] === 'dark' && cycle[2] === 'system' && cycle[3] === 'light',
    cycle.join('→'),
  );
}

function smokeToolboxCatalogContracts(): void {
  const boardIds = TOOLBOX_BOARD_ITEMS.map((item) => item.id);
  const actionIds = TOOLBOX_ACTION_ITEMS.map((item) => item.id);
  const allIds = [...boardIds, ...actionIds];
  const uniqueIds = new Set(allIds);
  check(
    'I? 工具条目录条目 id 唯一',
    uniqueIds.size === allIds.length,
    `${allIds.length} 个条目`,
  );

  const allWellFormed = [...TOOLBOX_BOARD_ITEMS, ...TOOLBOX_ACTION_ITEMS].every(
    (item) => item.label.length > 0 && item.icon.length > 0,
  );
  check('I? 工具条每个条目都有非空 label 与图标名', allWellFormed);

  check(
    'I? 召唤排复用权威 agent 目录（13 位专家）',
    AGENT_CATALOG_ENTRIES.length === 13,
    `${AGENT_CATALOG_ENTRIES.length} 位`,
  );

  const chineseMention = resolveAgentMention('@人物设计师 请补充人物弱点');
  check(
    'I? @中文专家名解析并剥离路由前缀',
    chineseMention.kind === 'resolved' &&
      chineseMention.entry.agent === 'character-generator' &&
      chineseMention.instruction === '请补充人物弱点',
  );
  const idMention = resolveAgentMention('@fact-checker：核对年龄');
  check(
    'I? @agent-id 解析支持中文标点',
    idMention.kind === 'resolved' &&
      idMention.entry.agent === 'fact-checker' &&
      idMention.instruction === '核对年龄',
  );
  check('I? 未知 @专家不会静默回退', resolveAgentMention('@不存在的专家 请处理').kind === 'unknown');
  check('I? 普通对话不误判为 mention', resolveAgentMention('请继续完善人物').kind === 'none');
}

/**
 * 模型任务会话：验证活动走独立通道、阶段顺序、重试创建新 attempt、workflow-goal 被拒、confirmed 不被自由文本覆盖。
 */
async function smokeModelTaskSession(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-orch-model-task-'));
  const dbPath = join(dir, 'orch-model-task.db');
  const opened = await openDatabase(dbPath);
  if (!opened.ok) {
    check('SQLite 可用', false, `${opened.reason}: ${opened.message}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  const factStore = new SqliteFactStore(db);

  const extractorJson = JSON.stringify({
    candidates: [
      {
        kind: 'entity',
        suggestedAnchor: { id: 'chapter-task', kind: 'chapter' },
        confidence: 0.9,
        payload: {
          entityType: 'person',
          canonicalName: '顾长风',
          aliases: ['顾兄弟'],
          quote: '顾长风走入茶馆',
        },
      },
    ],
  });
  const resolver = new FakeModelResolver('unused writer', '[]', extractorJson).asResolver();
  const runtime = new OrchestrationRuntime({
    getModelResolver: () => resolver,
    getCheckpointer: () => undefined,
    getFactStore: () => factStore,
  });

  const wc = new FakeWebContents();
  const runId = randomUUID() as RunId;
  await runtime.extractFacts(wc.asWebContents(), runId, {
    location: { id: asNodeId('chapter-task'), kind: 'chapter' },
    text: '顾长风走入茶馆，顾兄弟落座。',
  });

  // 1. 模型任务活动走独立通道，不混入 control-event
  check(
    '模型任务：活动走 modelTaskEvent 通道，不混入 control-event',
    wc.modelTask.length > 0 && wc.control.every((e) => !(e as { type?: string }).type?.startsWith('model-task')),
    `modelTask=${wc.modelTask.length} control=${wc.control.length}`,
  );
  check(
    '模型任务：活动不混入专家对话流',
    wc.stream.every((m) => (m as { type?: string }).type !== 'model-task-activity'),
  );

  // 2. 阶段顺序：reading → model → validation → ingest → completed
  const phases = wc.modelTask
    .filter((e): e is Extract<BackendModelTaskEvent, { type: 'model-task-activity' }> => e.type === 'model-task-activity')
    .map((e) => e.activity.phase);
  const readingIdx = phases.indexOf('reading');
  const modelIdx = phases.indexOf('model');
  const validationIdx = phases.indexOf('validation');
  const ingestIdx = phases.indexOf('ingest');
  check(
    '模型任务：阶段顺序 reading → model → validation → ingest',
    readingIdx >= 0 && modelIdx > readingIdx && validationIdx > modelIdx && ingestIdx > validationIdx,
    `phases=${phases.join('→')}`,
  );

  // 3. 完成事件存在
  const completed = wc.modelTask.find((e) => e.type === 'model-task-completed');
  check(
    '模型任务：抽取完成后下发 model-task-completed',
    completed?.type === 'model-task-completed',
  );

  // 4. 活动不含隐藏思维链：metadata 只有展示安全字段
  const hasUnsafeMetadata = wc.modelTask.some((e) => {
    if (e.type !== 'model-task-activity') return false;
    const metadata = e.activity.metadata;
    if (metadata === undefined) return false;
    return 'rawText' in metadata || 'prompt' in metadata || 'reasoning' in metadata;
  });
  check('模型任务：活动 metadata 不含隐藏思维链', !hasUnsafeMetadata);

  // 5. 重试创建新 attempt，旧 attempt 保留
  const firstAttemptId = wc.modelTask[0]?.attemptId;
  check('模型任务：初始 attempt 存在', firstAttemptId !== undefined);
  if (completed?.type === 'model-task-completed' && firstAttemptId !== undefined) {
    const taskId = completed.taskId;
    const wc2 = new FakeWebContents();
    const retried = await runtime.retryModelTask(taskId, firstAttemptId, wc2.asWebContents());
    check('模型任务：重试返回成功', retried);
    const newAttemptEvents = wc2.modelTask;
    const newAttemptId = newAttemptEvents[0]?.attemptId;
    check(
      '模型任务：重试创建新 attemptId',
      newAttemptId !== undefined && newAttemptId !== firstAttemptId,
      `old=${firstAttemptId?.slice(0, 8)} new=${newAttemptId?.slice(0, 8)}`,
    );
    check(
      '模型任务：重试保留相同 taskId',
      newAttemptEvents.length > 0 && newAttemptEvents[0]?.taskId === taskId,
    );
  }

  // 6. workflow-goal 补充被拒绝
  if (completed?.type === 'model-task-completed' && firstAttemptId !== undefined) {
    const wc3 = new FakeWebContents();
    const rejected = await runtime.supplementModelTask(
      completed.taskId,
      firstAttemptId,
      { text: '应该写入长期目标', scope: 'workflow-goal' },
      wc3.asWebContents(),
    );
    check('模型任务：workflow-goal 补充被拒绝', !rejected);
    check('模型任务：workflow-goal 不产生新活动', wc3.modelTask.length === 0);
  }

  // 7. confirmed 事实不被自由文本覆盖：重新抽取同一章节不应改变已确认事实
  const latestBefore = await factStore.getLatestVersion();
  if (latestBefore !== null) {
    const viewBefore = await factStore.getView(latestBefore);
    const guBefore = viewBefore.entities.find((e) => e.canonicalName === '顾长风');
    const wc4 = new FakeWebContents();
    const runId4 = randomUUID() as RunId;
    await runtime.extractFacts(wc4.asWebContents(), runId4, {
      location: { id: asNodeId('chapter-task'), kind: 'chapter' },
      text: '顾长风走入茶馆，顾兄弟落座。',
    });
    const latestAfter = await factStore.getLatestVersion();
    const viewAfter = latestAfter !== null ? await factStore.getView(latestAfter) : viewBefore;
    const guAfter = viewAfter.entities.find((e) => e.canonicalName === '顾长风');
    check(
      '模型任务：重复抽取不覆盖已确认事实',
      guBefore?.id === guAfter?.id,
      `before=${guBefore?.id} after=${guAfter?.id}`,
    );
  }

  await db.close();
  await rm(dir, { recursive: true, force: true });
}

async function main(): Promise<void> {
  console.log('=== orchestration-runtime 冲烟 ===');
  smokeReviewerJsonDefence();
  smokeTargetedVerificationRouting();
  smokeVisualDesignContracts();
  smokeToolboxCatalogContracts();
  await smokeSummonResumeTimeTravel();
  await smokeInstructionConflictOverride();
  await smokeNoFactStoreHappyPath();
  await smokeWorkflowReviewerIssuePersistence();
  await smokeExplicitFactExtraction();
  await smokeAutoExtractAfterWriter();
  await smokeBackfillFacts();
  await smokeChunkedFactExtraction();
  await smokeExtractionConflictResume();
  await smokeModelTaskSession();
  await smokeGlobalAudit();
  await smokeRefactorDiffSplice();
  await smokeCorpusRetrieval();
  // seedCheckpoint 仅保留供后续扩展；当前不单独跑（已被 time-travel 分支覆盖）。
  console.log(`=== 完成：${failures === 0 ? '全部通过' : `${failures} 项失败`} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();

// 仅用于消除未使用导入告警（seedCheckpoint 当前未在 main 调用，但保留供后续）。
void seedCheckpoint;
void asCheckpointId;
