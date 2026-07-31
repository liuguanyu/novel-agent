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
  TaskRunRepository,
  WorkflowIssueRepository,
  WorkflowRepository,
} from './db/index.js';
import { OrchestrationRuntime, targetedVerificationAgentFor, type BackfillFactsParams, type PlaybookRegistration, type PlaybookStepHandler, type SummonParams } from './orchestration/runtime.js';
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
  BackendTaskActivityEvent,
  ConsistencyIssueDto,
  GraphNodeActivatedEvent,
  RunId,
} from '../shared/ipc/index.js';
import { IPC_CHANNELS } from '../shared/ipc/index.js';
import type { CapabilityTier, ModelAdapter, ModelCallInput } from '../core/model/index.js';
import { asEntityId, asCheckpointId, asFactVersionId, type ConsistencyIssue, type Entity, type Provenance } from '../core/story-bible/index.js';
import { asNodeId } from '../core/manuscript/index.js';
import type { NovelState } from '../core/orchestration/index.js';
import { locateSourceEvidence } from '../core/workflow/index.js';
import { NEW_BOOK_CREATION_TEMPLATE } from '../core/workflow/templates.js';
import {
  NEW_BOOK_PLANNING_PLAYBOOKS,
  NEW_BOOK_STAGE_PLAYBOOKS,
  NEW_BOOK_WRITING_PLAYBOOKS,
  NEW_BOOK_WRITING_STAGE_PLAYBOOKS,
  type NewBookPlanningStageId,
  type NewBookWritingStageId,
} from '../core/task-runtime/new-book-playbooks.js';
import {
  buildNewBookWritingRegistrations,
  type NewBookModelResolver,
} from './orchestration/new-book-playbook-executors.js';
import {
  LEGACY_LOCATE_SOURCE_PLAYBOOK,
  NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK,
  TEMPORARY_EDITORIAL_PLAYBOOK,
  TASK_PLAYBOOK_FIXTURES,
  createTaskRunFromPlaybook,
  positionTaskRunAtStep,
  taskRunHasRequiredInputs,
  transitionTaskRun,
  type TaskPlaybook,
  type TaskRun,
} from '../core/task-runtime/index.js';

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
  readonly taskActivity: BackendTaskActivityEvent[] = [];
  send(channel: string, message: unknown): void {
    if (channel === IPC_CHANNELS.dialogueStream) {
      this.stream.push(message as BackendStreamMessage);
    } else if (channel === IPC_CHANNELS.controlEvent) {
      this.control.push(message as BackendControlEvent);
    } else if (channel === IPC_CHANNELS.modelTaskEvent) {
      this.modelTask.push(message as BackendModelTaskEvent);
    } else if (channel === IPC_CHANNELS.taskActivityEvent) {
      this.taskActivity.push(message as BackendTaskActivityEvent);
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

/**
 * 1.6：为旧作定位、新书创作和临时任务建立最小 playbook fixture，
 * 验证底层任务模型不要求项目已有正文。纯函数级别，不触碰 Electron/DB。
 */
function smokeTaskPlaybookFixtures(): void {
  // 三份 fixture 覆盖三种任务族，且 id 唯一。
  const kinds = new Set(TASK_PLAYBOOK_FIXTURES.map((playbook) => playbook.kind));
  check(
    'fixtures 覆盖 legacy-book/new-book/temporary 三族',
    kinds.has('legacy-book') && kinds.has('new-book') && kinds.has('temporary') && kinds.size === 3,
    [...kinds].join(','),
  );
  const ids = new Set(TASK_PLAYBOOK_FIXTURES.map((playbook) => playbook.id));
  check('fixtures id 唯一', ids.size === TASK_PLAYBOOK_FIXTURES.length);

  // 每份 fixture 结构完整：至少一个输入、一个步骤、一个产物；步骤 id 唯一。
  for (const playbook of TASK_PLAYBOOK_FIXTURES) {
    const stepIds = new Set(playbook.steps.map((step) => step.id));
    const structural =
      playbook.inputs.length > 0 &&
      playbook.steps.length > 0 &&
      playbook.outputs.length > 0 &&
      stepIds.size === playbook.steps.length &&
      playbook.version >= 1;
    check(`fixture ${playbook.id} 结构完整`, structural);
  }

  // 新书 fixture：无 project/book/manuscript 也能实例化并走完 queued→completed，含作者决策点。
  const newBookRun = createTaskRunFromPlaybook(NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK, {
    id: 'task-new-book-1',
    executionRunId: 'run-new-book-1',
    inputs: { premise: '一座会呼吸的城市' },
    now: '2026-01-01T00:00:00.000Z',
  });
  check(
    '新书任务无正文即可实例化（project/book/manuscript 均为 null）',
    newBookRun.refs.projectId === null &&
      newBookRun.refs.bookId === null &&
      newBookRun.refs.manuscriptId === null &&
      newBookRun.status === 'queued' &&
      newBookRun.kind === 'new-book',
  );
  check(
    '新书 fixture 必填输入校验（premise 已提供，constraints 可选）',
    taskRunHasRequiredInputs(NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK, newBookRun),
  );
  const newBookCompleted = driveThroughAuthorDecision(NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK, newBookRun);
  check(
    '新书任务经作者决策收敛到 completed 且复用同一 run id',
    newBookCompleted.status === 'completed' &&
      newBookCompleted.id === newBookRun.id &&
      newBookCompleted.timestamps.awaitingAuthorAt !== null &&
      newBookCompleted.timestamps.startedAt !== null &&
      newBookCompleted.timestamps.endedAt !== null,
  );

  // 临时任务 fixture：无任何领域引用即可运行到 completed。
  const temporaryRun = createTaskRunFromPlaybook(TEMPORARY_EDITORIAL_PLAYBOOK, {
    id: 'task-temp-1',
    executionRunId: 'run-temp-1',
    inputs: { text: '一段独立文本', editorialBrief: '润色语气' },
    now: '2026-01-01T00:00:00.000Z',
  });
  check(
    '临时任务无 workflow/issue 引用即可运行',
    temporaryRun.refs.workflowId === null &&
      temporaryRun.refs.issueId === null &&
      temporaryRun.kind === 'temporary',
  );
  const temporaryStarted = positionTaskRunAtStep(
    transitionTaskRun(temporaryRun, { status: 'running', occurredAt: '2026-01-01T00:00:01.000Z' }),
    TEMPORARY_EDITORIAL_PLAYBOOK,
    'review-text',
    '2026-01-01T00:00:01.000Z',
  );
  const temporaryCompleted = transitionTaskRun(temporaryStarted, {
    status: 'completed',
    occurredAt: '2026-01-01T00:00:02.000Z',
  });
  check(
    '临时任务单步收敛到 completed',
    temporaryStarted.currentStepId === 'review-text' &&
      temporaryStarted.currentStepIndex === 0 &&
      temporaryCompleted.status === 'completed',
  );

  // 旧作定位 fixture：仍要求章节锚点（既有正文场景），与新书/临时形成对照。
  const legacyRun = createTaskRunFromPlaybook(LEGACY_LOCATE_SOURCE_PLAYBOOK, {
    id: 'task-legacy-1',
    executionRunId: 'run-legacy-1',
    inputs: { issue: { id: 'iss-1' }, evidence: { quote: '引文' }, chapterAnchor: 'chapter-A' },
    refs: { projectId: 'proj-1', bookId: 'book-1', issueId: 'iss-1' },
    now: '2026-01-01T00:00:00.000Z',
  });
  check(
    '旧作定位 fixture 必填输入齐备时通过校验',
    legacyRun.kind === 'legacy-book' &&
      taskRunHasRequiredInputs(LEGACY_LOCATE_SOURCE_PLAYBOOK, legacyRun),
  );
  const legacyMissing = createTaskRunFromPlaybook(LEGACY_LOCATE_SOURCE_PLAYBOOK, {
    id: 'task-legacy-2',
    executionRunId: 'run-legacy-2',
    inputs: { issue: { id: 'iss-1' } },
    now: '2026-01-01T00:00:00.000Z',
  });
  check(
    '旧作定位 fixture 缺失章节锚点时校验失败',
    !taskRunHasRequiredInputs(LEGACY_LOCATE_SOURCE_PLAYBOOK, legacyMissing),
  );

  // 未知步骤 id 不改变 run（工厂纯函数不臆造进度）。
  const untouched = positionTaskRunAtStep(temporaryRun, TEMPORARY_EDITORIAL_PLAYBOOK, 'no-such-step', 'x');
  check('positionTaskRunAtStep 遇未知步骤原样返回', untouched.currentStepId === null);
}

/** 驱动含作者决策点的 playbook 从 queued 经 awaiting-author 收敛到 completed。 */
function driveThroughAuthorDecision(playbook: TaskPlaybook, run: TaskRun): TaskRun {
  const decisionStep = playbook.steps.find((step) => step.requiresAuthorDecision);
  let current = transitionTaskRun(run, { status: 'running', occurredAt: '2026-01-01T00:00:01.000Z' });
  if (decisionStep !== undefined) {
    current = positionTaskRunAtStep(current, playbook, decisionStep.id, '2026-01-01T00:00:01.000Z');
    current = transitionTaskRun(current, {
      status: 'awaiting-author',
      occurredAt: '2026-01-01T00:00:02.000Z',
    });
    current = transitionTaskRun(current, { status: 'running', occurredAt: '2026-01-01T00:00:03.000Z' });
  }
  return transitionTaskRun(current, { status: 'completed', occurredAt: '2026-01-01T00:00:04.000Z' });
}

// Phase 5.1：新书规划 playbook 与新书创作模板对齐、结构完整、可无正文实例化并经作者决策收敛。
function smokeNewBookPlanningPlaybooks(): void {
  // 全部为 new-book 族，id 唯一。
  const kinds = new Set(NEW_BOOK_PLANNING_PLAYBOOKS.map((playbook) => playbook.kind));
  check(
    '新书规划 playbook 均为 new-book 族',
    kinds.size === 1 && kinds.has('new-book'),
    [...kinds].join(','),
  );
  const ids = new Set(NEW_BOOK_PLANNING_PLAYBOOKS.map((playbook) => playbook.id));
  check('新书规划 playbook id 唯一', ids.size === NEW_BOOK_PLANNING_PLAYBOOKS.length);

  // stage→playbook 映射覆盖模板的全部规划阶段（confirm 类，非自动/自动写作后的阶段）。
  const planningStageIds: ReadonlyArray<NewBookPlanningStageId> = [
    'concept',
    'worldbuilding',
    'character-design',
    'book-outline',
    'chapter-plan',
    'scene-outline',
  ];
  const templateStageIds = new Set(NEW_BOOK_CREATION_TEMPLATE.stages.map((stage) => stage.id));
  const everyStageInTemplate = planningStageIds.every((id) => templateStageIds.has(id));
  const everyStageMapped = planningStageIds.every(
    (id) => NEW_BOOK_STAGE_PLAYBOOKS[id] !== undefined,
  );
  check(
    '新书规划阶段全部存在于 NEW_BOOK_CREATION_TEMPLATE 且有对应 playbook',
    everyStageInTemplate && everyStageMapped,
  );

  // 每个规划 playbook 结构完整，且至少含一个作者决策点（§17：作者是决策者）。
  for (const stageId of planningStageIds) {
    const playbook = NEW_BOOK_STAGE_PLAYBOOKS[stageId];
    const stepIds = new Set(playbook.steps.map((step) => step.id));
    const hasAuthorDecision = playbook.steps.some((step) => step.requiresAuthorDecision);
    const structural =
      playbook.inputs.length > 0 &&
      playbook.steps.length > 0 &&
      playbook.outputs.length > 0 &&
      stepIds.size === playbook.steps.length &&
      playbook.inputs.some((input) => input.required) &&
      hasAuthorDecision &&
      playbook.version >= 1;
    check(`新书规划 playbook ${playbook.id} 结构完整且含作者决策点`, structural);
  }

  // 立意 playbook：无 project/book/manuscript 即可实例化并经作者决策收敛到 completed。
  const conceptPlaybook = NEW_BOOK_STAGE_PLAYBOOKS.concept;
  const conceptRun = createTaskRunFromPlaybook(conceptPlaybook, {
    id: 'task-new-book-concept-1',
    executionRunId: 'run-new-book-concept-1',
    inputs: { premise: '一座会呼吸的城市' },
    now: '2026-01-01T00:00:00.000Z',
  });
  check(
    '新书立意任务无正文即可实例化（project/book/manuscript 均为 null）',
    conceptRun.refs.projectId === null &&
      conceptRun.refs.bookId === null &&
      conceptRun.refs.manuscriptId === null &&
      conceptRun.status === 'queued' &&
      conceptRun.kind === 'new-book',
  );
  check(
    '新书立意必填输入校验（premise 已提供，preferences 可选）',
    taskRunHasRequiredInputs(conceptPlaybook, conceptRun),
  );
  const conceptCompleted = driveThroughAuthorDecision(conceptPlaybook, conceptRun);
  check(
    '新书立意任务经作者决策收敛到 completed 且复用同一 run id',
    conceptCompleted.status === 'completed' &&
      conceptCompleted.id === conceptRun.id &&
      conceptCompleted.timestamps.awaitingAuthorAt !== null &&
      conceptCompleted.timestamps.endedAt !== null,
  );

  // 世界观 playbook：缺失必填 concept 时校验失败（阶段间产物依赖成立）。
  const worldbuildingPlaybook = NEW_BOOK_STAGE_PLAYBOOKS.worldbuilding;
  const worldbuildingMissing = createTaskRunFromPlaybook(worldbuildingPlaybook, {
    id: 'task-new-book-world-1',
    executionRunId: 'run-new-book-world-1',
    inputs: {},
    now: '2026-01-01T00:00:00.000Z',
  });
  check(
    '新书世界观缺失 concept 时校验失败',
    !taskRunHasRequiredInputs(worldbuildingPlaybook, worldbuildingMissing),
  );
}

async function smokeLocateSourceTask(): Promise<void> {
  const quote = '他忽然丢下同伴独自离开。';
  const exact = locateSourceEvidence(`开场。${quote}随后继续。`, { quote });
  check('locate-source 纯函数唯一精确命中', exact.status === 'located' && exact.matchMethod === 'exact');
  const contextual = locateSourceEvidence(
    `${quote}${'城门已经关闭，巡逻队沿着长街反复搜查。'.repeat(8)}${quote}夜色笼罩街道。`,
    { quote, after: '夜色笼罩街道。' },
  );
  check('locate-source 纯函数使用上下文消歧', contextual.status === 'located' && contextual.matchMethod === 'context');
  const ambiguous = locateSourceEvidence(`${quote}甲。${quote}乙。`, { quote });
  check('locate-source 纯函数多候选不猜测', ambiguous.status === 'ambiguous' && ambiguous.candidates.length === 2);
  check('locate-source 纯函数零命中明确失败', locateSourceEvidence('正文已经变化。', { quote }).status === 'not-found');
  // 4.2 近似匹配：精确失败时对相近改写做近似回退，结果一律 awaiting-author 不自动落定。
  const approximate = locateSourceEvidence('开场。他忽然丢下同伴独自离去。随后继续。', { quote });
  check('4.2 近似匹配：精确失败时回退近似并进入多候选',
    approximate.status === 'ambiguous' && approximate.matchMethod === 'approximate' && approximate.candidates.length >= 1);
  check('4.2 近似匹配：不误命中无关正文',
    locateSourceEvidence('城中商贾云集，街市喧嚣不止，与此毫无关联。', { quote }).status === 'not-found');

  const dir = await mkdtemp(join(tmpdir(), 'na-locate-source-'));
  const opened = await openDatabase(join(dir, 'locate-source.db'));
  if (!opened.ok) {
    check('locate-source SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const workflows = new WorkflowRepository(db);
    const workflowIssues = new WorkflowIssueRepository(db);
    const service = new WorkflowApplicationService(workflows, new CreativeAssetRepository(db), workflowIssues);
    const evidence = new SqliteStageRunEvidenceRecorder(db);
    const taskRuns = new TaskRunRepository(db);
    const chapterId = asNodeId('locate-chapter');

    const prepare = async (workflowId: string, content: string, readDelayMs = 0) => {
      const started = await service.command({
        type: 'start-workflow', workflowId, projectId: `${workflowId}-project`, kind: 'legacy-book-revision',
        objective: '定位诊断问题对应的原文', requestId: `${workflowId}-start`, operationId: `${workflowId}-start-op`,
      });
      if (started === null) throw new Error('locate-source workflow fixture failed');
      const [issue] = await workflowIssues.upsertFromAudit(workflowId, `${workflowId}-audit`, [{
        type: 'behavior-ooc', severity: 'warning', anchors: [{ id: chapterId, kind: 'chapter' }],
        description: '主角在证据段落中的行为与既定性格不一致。', requiresHumanDecision: false,
        evidence: { quote },
      }]);
      if (issue === undefined) throw new Error('locate-source issue fixture failed');

      const advance = async (templateStageId: string, author: boolean): Promise<void> => {
        const current = await workflows.get(workflowId);
        if (current === null || current.currentStageId === null) throw new Error(`missing ${templateStageId}`);
        const stage = current.stages.find((candidate) => candidate.stageId === current.currentStageId);
        if (stage?.templateStageId !== templateStageId) throw new Error(`expected ${templateStageId}, got ${stage?.templateStageId}`);
        const stageRunId = `${workflowId}:${templateStageId}` as RunId;
        await service.command({
          type: 'workflow-start-stage', workflowId, stageId: current.currentStageId,
          expectedVersion: current.version, runId: stageRunId,
          requestId: `${stageRunId}-start`, operationId: `${stageRunId}-start-op`,
        });
        await evidence.record({ runId: stageRunId, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'started' });
        await evidence.record({
          runId: stageRunId, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'completed',
          ...(stage?.actor === 'quality-gate' ? { completion: { passed: true, issueIds: [] } } : {}),
        });
        if (!author) return;
        const awaiting = await workflows.get(workflowId);
        if (awaiting === null || awaiting.currentStageId === null) throw new Error(`author stage ${templateStageId} disappeared`);
        await service.command({
          type: 'workflow-confirm-stage', workflowId, stageId: awaiting.currentStageId,
          expectedVersion: awaiting.version, requestId: `${stageRunId}-confirm`, operationId: `${stageRunId}-confirm-op`,
        });
      };

      await advance('import-book', true);
      await advance('fact-backfill', false);
      await advance('initial-audit', false);
      const triage = await workflows.get(workflowId);
      if (triage === null || triage.currentStageId === null) throw new Error('issue triage missing');
      const selection = await service.command({
        type: 'workflow-select-issue', workflowId, stageId: triage.currentStageId, issueId: issue.issueId,
        workflowRef: { workflowId, stageId: triage.currentStageId, issueId: issue.issueId },
        expectedVersion: triage.version, runId: `${workflowId}:selection`,
        requestId: `${workflowId}-select`, operationId: `${workflowId}-select-op`,
      });
      check(`${workflowId} 持久化当前问题`, selection?.selectedIssueId === issue.issueId);
      await advance('issue-triage', true);
      const locate = await workflows.get(workflowId);
      if (locate === null || locate.currentStageId === null) throw new Error('locate-source stage missing');
      check(`${workflowId} 阶段推进后保留当前问题`, locate.selectedIssueId === issue.issueId);
      const runtime = new OrchestrationRuntime({
        getModelResolver: () => undefined,
        getCheckpointer: () => undefined,
        getFactStore: () => undefined,
        workflows,
        workflowIssues,
        stageRunEvidence: evidence,
        taskRuns,
        manuscript: {
          readChapterContent: async (nodeId: string) => {
            if (readDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, readDelayMs));
            return { nodeId, content };
          },
          writeBackRefactoredFragment: async () => ({ ok: false, reason: 'io-error' as const }),
        },
      });
      return { runtime, issueId: issue.issueId, stageId: locate.currentStageId };
    };

    const success = await prepare('locate-success', `开场。${quote}随后，他回头解释自己的决定。`);
    const successWc = new FakeWebContents();
    await success.runtime.locateSource(successWc.asWebContents(), randomUUID() as RunId, {
      workflowId: 'locate-success', stageId: success.stageId, issueId: success.issueId,
    });
    const uiEvent = successWc.taskActivity.find((event) => event.type === 'task-activity' && event.phase === 'ui-effect');
    const completed = successWc.taskActivity.find((event) => event.type === 'task-run-completed');
    const successWorkflow = await workflows.get('locate-success');
    check('locate-source 成功发布切章与高亮 UI Effect', uiEvent?.type === 'task-activity' && uiEvent.uiEffects?.some((effect) => effect.kind === 'select-chapter') === true && uiEvent.uiEffects.some((effect) => effect.kind === 'highlight-quote'));
    check('locate-source 成功发布完成事件和定位产物', completed?.type === 'task-run-completed' && completed.artifactRefs?.some((artifact) => artifact.kind === 'source-location') === true);
    check('locate-source 成功后推进局部改写', successWorkflow?.stages.find((stage) => stage.stageId === successWorkflow.currentStageId)?.templateStageId === 'generate-rewrite');
    check('locate-source 任务事件不混入对话流', successWc.stream.length === 0 && successWc.modelTask.length === 0);
    if (uiEvent?.type !== 'task-activity') throw new Error('locate-source ui effect activity missing');
    const selectEffect = uiEvent.uiEffects?.find((effect) => effect.kind === 'select-chapter');
    const highlightEffect = uiEvent.uiEffects?.find((effect) => effect.kind === 'highlight-quote');
    if (selectEffect === undefined || highlightEffect === undefined) throw new Error('locate-source effect ids missing');
    const appliedOperation = `task-ui-effect:${uiEvent.taskRunId}:${selectEffect.effectId}`;
    await success.runtime.reportTaskUiEffectResult(successWc.asWebContents(), appliedOperation, {
      taskRunId: uiEvent.taskRunId, activityId: uiEvent.activityId, effectId: selectEffect.effectId,
      effectKind: selectEffect.kind, status: 'applied', message: '已切换到定位结果所在章节',
    });
    await success.runtime.reportTaskUiEffectResult(successWc.asWebContents(), appliedOperation, {
      taskRunId: uiEvent.taskRunId, activityId: uiEvent.activityId, effectId: selectEffect.effectId,
      effectKind: selectEffect.kind, status: 'applied', message: '已切换到定位结果所在章节',
    });
    await success.runtime.reportTaskUiEffectResult(successWc.asWebContents(), `task-ui-effect:${uiEvent.taskRunId}:${highlightEffect.effectId}`, {
      taskRunId: uiEvent.taskRunId, activityId: uiEvent.activityId, effectId: highlightEffect.effectId,
      effectKind: highlightEffect.kind, status: 'failed', message: '目标章节已打开，但诊断引文未能在当前正文中高亮',
    });
    const effectResults = await taskRuns.listEvents(uiEvent.taskRunId);
    check('UI Effect 成功与失败结果进入持久活动', effectResults.some((event) => event.type === 'task-activity' && event.title === '工作区已更新') && effectResults.some((event) => event.type === 'task-activity' && event.title === '工作区更新未完成'));
    check('UI Effect 重复回执幂等', effectResults.filter((event) => event.type === 'task-activity' && event.title === '工作区已更新').length === 1);
    let forgedEffectRejected = false;
    try {
      await success.runtime.reportTaskUiEffectResult(successWc.asWebContents(), 'task-ui-effect:forged', {
        taskRunId: uiEvent.taskRunId, activityId: uiEvent.activityId, effectId: 'forged-effect',
        effectKind: 'highlight-quote', status: 'applied', message: '伪造结果',
      });
    } catch {
      forgedEffectRejected = true;
    }
    check('UI Effect 回执拒绝伪造 effectId', forgedEffectRejected);

    const heartbeatCase = await prepare('locate-heartbeat', `${quote}，随后他继续解释。`, 2_300);
    const heartbeatWc = new FakeWebContents();
    const heartbeatPromise = heartbeatCase.runtime.locateSource(heartbeatWc.asWebContents(), randomUUID() as RunId, {
      workflowId: 'locate-heartbeat', stageId: heartbeatCase.stageId, issueId: heartbeatCase.issueId,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    check('heartbeat 两秒阈值前不提前发送', !heartbeatWc.taskActivity.some((event) => event.type === 'task-activity' && event.phase === 'heartbeat'));
    await new Promise<void>((resolve) => setTimeout(resolve, 2_100));
    const heartbeatEvent = heartbeatWc.taskActivity.find((event) => event.type === 'task-activity' && event.phase === 'heartbeat');
    check('heartbeat 超过两秒后基于真实步骤发送', heartbeatEvent?.type === 'task-activity' && heartbeatEvent.status === 'running' && heartbeatEvent.message.includes('读取目标章节并验证') && (heartbeatEvent.feedback?.includes('已声明诊断问题') ?? false));
    await heartbeatPromise;
    const heartbeatCountAtCompletion = heartbeatWc.taskActivity.filter((event) => event.type === 'task-activity' && event.phase === 'heartbeat').length;
    await new Promise<void>((resolve) => setTimeout(resolve, 700));
    check('任务完成后停止 heartbeat', heartbeatWc.taskActivity.filter((event) => event.type === 'task-activity' && event.phase === 'heartbeat').length === heartbeatCountAtCompletion);

    const ambiguousCase = await prepare('locate-ambiguous', `${quote}甲。${quote}乙。`);
    const ambiguousWc = new FakeWebContents();
    await ambiguousCase.runtime.locateSource(ambiguousWc.asWebContents(), randomUUID() as RunId, {
      workflowId: 'locate-ambiguous', stageId: ambiguousCase.stageId, issueId: ambiguousCase.issueId,
    });
    const waiting = ambiguousWc.taskActivity.find((event) => event.type === 'task-activity' && event.status === 'awaiting-author');
    const ambiguousWorkflow = await workflows.get('locate-ambiguous');
    check('locate-source 多候选等待作者且不完成', waiting?.type === 'task-activity' && !ambiguousWc.taskActivity.some((event) => event.type === 'task-run-completed'));
    check('locate-source 多候选不推进阶段', ambiguousWorkflow?.currentStageId === ambiguousCase.stageId);
    if (waiting?.type !== 'task-activity') throw new Error('awaiting author activity missing');
    const persistedWaiting = await taskRuns.get(waiting.taskRunId);
    const persistedCandidates = await taskRuns.listPendingCandidates(waiting.taskRunId);
    const persistedEvents = await taskRuns.listEvents(waiting.taskRunId);
    check('locate-source 等待态与候选持久化', persistedWaiting?.status === 'awaiting-author' && persistedCandidates.length === 2);
    check('locate-source 完整活动可从任务仓储恢复', persistedEvents.some((event) => event.type === 'task-activity' && event.status === 'awaiting-author'));
    const taskCenter = await ambiguousCase.runtime.getTaskCenter({ projectId: 'locate-ambiguous-project' });
    check(
      '任务中心重连查询恢复等待任务与作者可见候选',
      taskCenter.runs.some((run) => run.taskRunId === waiting.taskRunId && run.status === 'awaiting-author') &&
        taskCenter.events.some((event) => event.type === 'task-activity' && event.taskRunId === waiting.taskRunId && event.authorCandidates?.length === 2),
    );
    const selectedCandidate = persistedCandidates[1];
    if (selectedCandidate === undefined) throw new Error('second source candidate missing');
    const resumedRuntime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => undefined,
      getFactStore: () => undefined,
      workflows,
      workflowIssues,
      stageRunEvidence: evidence,
      taskRuns,
      manuscript: {
        readChapterContent: async (nodeId: string) => ({ nodeId, content: `${quote}甲。${quote}乙。` }),
        writeBackRefactoredFragment: async () => ({ ok: false, reason: 'io-error' as const }),
      },
    });
    const resumedWc = new FakeWebContents();
    const chooseOperationId = `choose-source-location:${waiting.taskRunId}:${selectedCandidate.candidateId}`;
    await resumedRuntime.chooseSourceLocation(resumedWc.asWebContents(), waiting.taskRunId, selectedCandidate.candidateId, chooseOperationId);
    await resumedRuntime.chooseSourceLocation(resumedWc.asWebContents(), waiting.taskRunId, selectedCandidate.candidateId, chooseOperationId);
    const resumedTask = await taskRuns.get(waiting.taskRunId);
    const resumedWorkflow = await workflows.get('locate-ambiguous');
    const resumedUi = resumedWc.taskActivity.find((event) => event.type === 'task-activity' && event.phase === 'ui-effect');
    check('locate-source 重连后作者选择完成任务', resumedTask?.status === 'completed' && resumedTask.authorDecisions.length === 1);
    check('locate-source 重复作者操作幂等', resumedTask?.authorDecisions.length === 1 && resumedWc.taskActivity.filter((event) => event.type === 'task-run-completed').length === 1);
    check('locate-source 作者选择发布滚动与高亮', resumedUi?.type === 'task-activity' && resumedUi.uiEffects?.some((effect) => effect.kind === 'scroll-to-evidence') === true && resumedUi.uiEffects.some((effect) => effect.kind === 'highlight-quote'));
    check('locate-source 作者选择后推进局部改写', resumedWorkflow?.stages.find((stage) => stage.stageId === resumedWorkflow.currentStageId)?.templateStageId === 'generate-rewrite');

    const missing = await prepare('locate-missing', '正文已经变化。');
    const missingWc = new FakeWebContents();
    await missing.runtime.locateSource(missingWc.asWebContents(), randomUUID() as RunId, {
      workflowId: 'locate-missing', stageId: missing.stageId, issueId: missing.issueId,
    });
    const failed = missingWc.taskActivity.find((event) => event.type === 'task-run-failed');
    const missingWorkflow = await workflows.get('locate-missing');
    const failedTask = failed?.type === 'task-run-failed' ? await taskRuns.get(failed.taskRunId) : null;
    const failedEvents = failed?.type === 'task-run-failed' ? await taskRuns.listEvents(failed.taskRunId) : [];
    check('locate-source 零命中发布可恢复失败', failed?.type === 'task-run-failed' && failed.error.category === 'validation' && (failed.error.recovery?.length ?? 0) > 0);
    check('locate-source 失败状态与原因持久化', failedTask?.status === 'failed' && failedTask.failure?.code === 'source-location-failed' && failedEvents.some((event) => event.type === 'task-run-failed' && event.error.recovery !== undefined));
    check('locate-source 零命中不推进阶段', missingWorkflow?.currentStageId === missing.stageId);

    // 暂停/恢复：运行中在安全边界收敛为 paused，恢复复用同一 taskRunId 完成。
    const pauseCase = await prepare('locate-pause', `开场。${quote}随后他回头解释。`, 400);
    const pauseWc = new FakeWebContents();
    const pauseRunId = randomUUID() as RunId;
    const pausePromise = pauseCase.runtime.locateSource(pauseWc.asWebContents(), pauseRunId, {
      workflowId: 'locate-pause', stageId: pauseCase.stageId, issueId: pauseCase.issueId,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const runningInput = pauseWc.taskActivity.find((event) => event.type === 'task-activity' && event.phase === 'input');
    if (runningInput?.type !== 'task-activity') throw new Error('locate-pause input activity missing');
    const pauseTaskRunId = runningInput.taskRunId;
    await pauseCase.runtime.controlTaskRun(pauseWc.asWebContents(), pauseTaskRunId, 'pause', `control:${pauseTaskRunId}:pause:1`);
    await pausePromise;
    const pausedTask = await taskRuns.get(pauseTaskRunId);
    const pausedWorkflow = await workflows.get('locate-pause');
    check('locate-source 运行中暂停在安全边界收敛为 paused', pausedTask?.status === 'paused');
    check('locate-source 暂停不产生 UI Effect 与完成事件', !pauseWc.taskActivity.some((event) => event.type === 'task-run-completed') && !pauseWc.taskActivity.some((event) => event.type === 'task-activity' && event.phase === 'ui-effect'));
    check('locate-source 暂停不推进阶段', pausedWorkflow?.currentStageId === pauseCase.stageId);
    // 重复同一 pause operationId 幂等（awaiting/paused 已收敛）。
    await pauseCase.runtime.controlTaskRun(pauseWc.asWebContents(), pauseTaskRunId, 'pause', `control:${pauseTaskRunId}:pause:1`);
    check('locate-source 已暂停重复暂停幂等', (await taskRuns.get(pauseTaskRunId))?.status === 'paused');
    // 恢复：复用同一 taskRunId，从持久输入重新执行至完成。
    const resumeWc = new FakeWebContents();
    await pauseCase.runtime.controlTaskRun(resumeWc.asWebContents(), pauseTaskRunId, 'resume', `control:${pauseTaskRunId}:resume:1`);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    const resumedPauseTask = await taskRuns.get(pauseTaskRunId);
    const resumedPauseWorkflow = await workflows.get('locate-pause');
    const resumedTaskRunIds = new Set((await taskRuns.listRecent({ limit: 50, projectId: 'locate-pause-project' })).map((run) => run.taskRunId));
    check('locate-source 恢复复用同一 taskRunId 完成', resumedPauseTask?.status === 'completed' && resumedPauseTask.id === pauseTaskRunId);
    check('locate-source 恢复不新建第二条 TaskRun', resumedTaskRunIds.size === 1);
    check('locate-source 恢复后推进局部改写', resumedPauseWorkflow?.stages.find((stage) => stage.stageId === resumedPauseWorkflow.currentStageId)?.templateStageId === 'generate-rewrite');
    check('locate-source 恢复发布真实 UI Effect', resumeWc.taskActivity.some((event) => event.type === 'task-activity' && event.phase === 'ui-effect'));

    // 取消：等待作者态下立即持久化为 cancelled。
    const cancelCase = await prepare('locate-cancel', `${quote}甲。${quote}乙。`);
    const cancelWc = new FakeWebContents();
    await cancelCase.runtime.locateSource(cancelWc.asWebContents(), randomUUID() as RunId, {
      workflowId: 'locate-cancel', stageId: cancelCase.stageId, issueId: cancelCase.issueId,
    });
    const cancelWaiting = cancelWc.taskActivity.find((event) => event.type === 'task-activity' && event.status === 'awaiting-author');
    if (cancelWaiting?.type !== 'task-activity') throw new Error('locate-cancel awaiting activity missing');
    await cancelCase.runtime.controlTaskRun(cancelWc.asWebContents(), cancelWaiting.taskRunId, 'cancel', `control:${cancelWaiting.taskRunId}:cancel:1`);
    const cancelledTask = await taskRuns.get(cancelWaiting.taskRunId);
    const cancelledWorkflow = await workflows.get('locate-cancel');
    check('locate-source 等待作者态可取消', cancelledTask?.status === 'cancelled');
    check('locate-source 取消不推进阶段且不完成', cancelledWorkflow?.currentStageId === cancelCase.stageId && !cancelWc.taskActivity.some((event) => event.type === 'task-run-completed'));
    // 重复取消幂等（已终态）。
    await cancelCase.runtime.controlTaskRun(cancelWc.asWebContents(), cancelWaiting.taskRunId, 'cancel', `control:${cancelWaiting.taskRunId}:cancel:2`);
    check('locate-source 已取消重复取消幂等', (await taskRuns.get(cancelWaiting.taskRunId))?.status === 'cancelled');
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 通用 playbook 执行引擎冲烟（task 2.1）：同一 Task Runtime 驱动 temporary/new-book，
 * 不依赖 project/book/manuscript。注入 fake handlers（与 fake ModelResolver 同构），
 * 验证状态收敛、作者决策、暂停/恢复、取消、幂等与必填校验。
 */
async function smokeGenericPlaybookTask(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-generic-playbook-'));
  const opened = await openDatabase(join(dir, 'generic-playbook.db'));
  if (!opened.ok) {
    check('generic-playbook SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const taskRuns = new TaskRunRepository(db);
    const makeRuntime = (): OrchestrationRuntime => new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => undefined,
      getFactStore: () => undefined,
      taskRuns,
    });

    // fake handler：不接真实模型，只产出可审计产物与作者可读候选。
    const temporaryRegistration: PlaybookRegistration = {
      playbook: TEMPORARY_EDITORIAL_PLAYBOOK,
      title: '临时编辑任务',
      completedSummary: '已完成独立文本的编辑审阅',
      handlers: {
        'review-text': {
          run: async (ctx) => ({
            message: '已根据编辑目标审阅文本',
            outputSummary: '产出编辑意见',
            artifacts: [{
              outputKey: 'editorialNotes',
              value: { brief: ctx.inputs['editorialBrief'] },
              ref: { kind: 'draft', label: '编辑意见', ref: `editorial:${ctx.run.id}` },
            }],
          }),
        },
      },
    };

    // temporary 单步 auto：queued→running→completed，无 workflow/issue 引用，产物持久化。
    const tempWc = new FakeWebContents();
    const tempRuntime = makeRuntime();
    tempRuntime.registerPlaybook(temporaryRegistration);
    const tempId = randomUUID();
    await tempRuntime.runPlaybookTask(tempWc.asWebContents(), {
      registration: temporaryRegistration,
      taskRunId: tempId,
      inputs: { text: '一段独立文本', editorialBrief: '润色语气' },
    });
    const tempRun = await taskRuns.get(tempId);
    check('临时任务无领域引用运行到 completed',
      tempRun?.status === 'completed' && tempRun.refs.workflowId === null && tempRun.refs.issueId === null && tempRun.refs.projectId === null);
    check('临时任务产物持久化', tempRun?.artifacts.length === 1 && tempRun.artifacts[0]?.outputKey === 'editorialNotes');
    check('临时任务下发完成事件', tempWc.taskActivity.some((event) => event.type === 'task-run-completed'));
    check('临时任务 kind 为 temporary-task', tempWc.taskActivity.every((event) => event.kind === 'temporary-task'));

    // 新书任务：经作者决策步骤 run→awaiting-author→submit→completed，复用同一 taskRunId。
    const newBookRegistration: PlaybookRegistration = {
      playbook: NEW_BOOK_CHARACTER_DESIGN_PLAYBOOK,
      title: '新书人物设计',
      completedSummary: '已产出经作者确认的人物档案',
      handlers: {
        'draft-cast': {
          run: async () => ({
            message: '已起草互补的人物角色',
            artifacts: [{ outputKey: 'draftCast', value: ['protagonist', 'foil'], ref: { kind: 'draft', label: '人物草稿', ref: 'cast-draft' } }],
          }),
        },
        'author-review': {
          requiresAuthor: true,
          prompt: async () => ({ message: '请选择并确认人物阵容', nextAction: '在任务卡提交选择' }),
          apply: async (_ctx, decision) => ({
            message: '已收到作者选择',
            artifacts: [{ outputKey: 'authorChoice', value: decision, ref: { kind: 'draft', label: '作者选择', ref: 'author-choice' } }],
          }),
        },
        'finalize-profiles': {
          run: async () => ({
            message: '已产出最终人物档案',
            artifacts: [{ outputKey: 'characterProfiles', value: [{ name: 'A' }], ref: { kind: 'draft', label: '人物档案', ref: 'profiles' } }],
          }),
        },
      },
    };

    const nbWc = new FakeWebContents();
    const nbRuntime = makeRuntime();
    nbRuntime.registerPlaybook(newBookRegistration);
    const nbId = randomUUID();
    await nbRuntime.runPlaybookTask(nbWc.asWebContents(), {
      registration: newBookRegistration,
      taskRunId: nbId,
      inputs: { premise: '一个关于背叛的故事' },
    });
    const awaitingRun = await taskRuns.get(nbId);
    check('新书任务在作者决策步收敛 awaiting-author',
      awaitingRun?.status === 'awaiting-author' && awaitingRun.currentStepId === 'author-review');
    check('新书任务首步产物持久化', awaitingRun?.artifacts.some((artifact) => artifact.outputKey === 'draftCast') === true);
    check('新书任务下发等待作者活动', nbWc.taskActivity.some((event) => event.type === 'task-activity' && event.status === 'awaiting-author'));
    check('新书任务 kind 为 new-book-planning', nbWc.taskActivity.every((event) => event.kind === 'new-book-planning'));

    await nbRuntime.submitPlaybookAuthorDecision(nbWc.asWebContents(), nbId, 'author-review', { chosen: 'protagonist' }, `decision:${nbId}:1`);
    const nbCompleted = await taskRuns.get(nbId);
    check('新书任务经作者决策收敛 completed 且复用同一 taskRunId',
      nbCompleted?.id === nbId && nbCompleted.status === 'completed');
    check('新书任务作者决策持久化',
      nbCompleted?.authorDecisions.length === 1 && nbCompleted.authorDecisions[0]?.stepId === 'author-review');
    check('新书任务三步产物均持久化', nbCompleted?.artifacts.length === 3);
    // 重复同一 author-decision operationId 幂等。
    await nbRuntime.submitPlaybookAuthorDecision(nbWc.asWebContents(), nbId, 'author-review', { chosen: 'protagonist' }, `decision:${nbId}:1`);
    check('新书任务重复决策 operationId 幂等',
      (await taskRuns.get(nbId))?.authorDecisions.length === 1);

    // 暂停（运行中安全边界收敛 paused）→恢复（从 currentStepIndex 续跑至 completed，复用同一 taskRunId）。
    let releasePause: (() => void) | undefined;
    const pauseGate = new Promise<void>((resolve) => { releasePause = resolve; });
    const pauseRegistration: PlaybookRegistration = {
      playbook: TEMPORARY_EDITORIAL_PLAYBOOK,
      title: '可暂停临时任务',
      completedSummary: '恢复后已完成',
      handlers: {
        'review-text': {
          run: async () => {
            await pauseGate; // 制造一个可中断的安全边界窗口。
            return { message: '审阅完成', artifacts: [{ outputKey: 'editorialNotes', value: 'ok', ref: { kind: 'draft', label: '意见', ref: 'note' } }] };
          },
        },
      },
    };
    const pauseWc = new FakeWebContents();
    const pauseRuntime = makeRuntime();
    pauseRuntime.registerPlaybook(pauseRegistration);
    const pauseId = randomUUID();
    const pausePromise = pauseRuntime.runPlaybookTask(pauseWc.asWebContents(), {
      registration: pauseRegistration, taskRunId: pauseId, inputs: { text: 't', editorialBrief: 'b' },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    await pauseRuntime.controlTaskRun(pauseWc.asWebContents(), pauseId, 'pause', `control:${pauseId}:pause:1`);
    releasePause?.();
    await pausePromise;
    const pausedRun = await taskRuns.get(pauseId);
    check('通用任务运行中暂停收敛 paused', pausedRun?.status === 'paused');
    check('通用任务暂停不产生产物', pausedRun?.artifacts.length === 0);
    // 恢复：复用同一 taskRunId，重新执行至 completed（handler 已不再阻塞）。
    const resumeWc = new FakeWebContents();
    await pauseRuntime.controlTaskRun(resumeWc.asWebContents(), pauseId, 'resume', `control:${pauseId}:resume:1`);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const resumedRun = await taskRuns.get(pauseId);
    check('通用任务从暂停点恢复至 completed 且复用同一 taskRunId',
      resumedRun?.id === pauseId && resumedRun.status === 'completed' && resumedRun.artifacts.length === 1);

    // awaiting-author 态 cancel → cancelled。
    const cancelWc = new FakeWebContents();
    const cancelRuntime = makeRuntime();
    cancelRuntime.registerPlaybook(newBookRegistration);
    const cancelId = randomUUID();
    await cancelRuntime.runPlaybookTask(cancelWc.asWebContents(), {
      registration: newBookRegistration, taskRunId: cancelId, inputs: { premise: 'p' },
    });
    check('cancel 前任务处于 awaiting-author', (await taskRuns.get(cancelId))?.status === 'awaiting-author');
    await cancelRuntime.controlTaskRun(cancelWc.asWebContents(), cancelId, 'cancel', `control:${cancelId}:cancel:1`);
    check('通用任务 awaiting-author 取消收敛 cancelled', (await taskRuns.get(cancelId))?.status === 'cancelled');
    await cancelRuntime.controlTaskRun(cancelWc.asWebContents(), cancelId, 'cancel', `control:${cancelId}:cancel:2`);
    check('通用任务重复取消幂等', (await taskRuns.get(cancelId))?.status === 'cancelled');

    // 缺必填输入 → failed。
    const missingWc = new FakeWebContents();
    const missingRuntime = makeRuntime();
    missingRuntime.registerPlaybook(temporaryRegistration);
    const missingId = randomUUID();
    await missingRuntime.runPlaybookTask(missingWc.asWebContents(), {
      registration: temporaryRegistration, taskRunId: missingId, inputs: { text: '只有文本缺编辑目标' },
    });
    check('缺必填输入下发可读失败事件',
      missingWc.taskActivity.some((event) => event.type === 'task-run-failed' && event.error.message.includes('Editorial brief')));
    check('缺必填输入不创建持久运行', (await taskRuns.get(missingId)) === null);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 5.2 新书写作/审校循环生产执行器冲烟：
 * 用 fake NewBookModelResolver 注入模型能力，经工厂构建真实四份注册项，
 * 驱动「章节初稿生成」全生命周期（run→awaiting-author→submit→completed），
 * 并校验其余三份（作者修订/连贯性检查/事实底稿更新）结构对齐、可实例化。
 * 守卫红线：产物为作者可见结构化结果、作者决策可追踪、真实事件有序。
 */
async function smokeNewBookWritingPlaybooks(): Promise<void> {
  // stage 映射覆盖模板中分场大纲之后的四个写作/审校 stage。
  const writingStageIds: ReadonlyArray<NewBookWritingStageId> = [
    'draft-writing',
    'author-review',
    'automatic-review',
    'fact-extraction',
  ];
  const templateStageIds = new Set(NEW_BOOK_CREATION_TEMPLATE.stages.map((stage) => stage.id));
  check(
    '新书写作 stage 映射全部存在于模板',
    writingStageIds.every((id) => id in NEW_BOOK_WRITING_STAGE_PLAYBOOKS && templateStageIds.has(id)),
  );
  check(
    '新书写作 playbook 均为 new-book 族且 id 唯一',
    NEW_BOOK_WRITING_PLAYBOOKS.every((playbook) => playbook.kind === 'new-book') &&
      new Set(NEW_BOOK_WRITING_PLAYBOOKS.map((playbook) => playbook.id)).size === NEW_BOOK_WRITING_PLAYBOOKS.length,
  );

  const dir = await mkdtemp(join(tmpdir(), 'na-new-book-writing-'));
  const opened = await openDatabase(join(dir, 'new-book-writing.db'));
  if (!opened.ok) {
    check('new-book-writing SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const taskRuns = new TaskRunRepository(db);
    // fake 模型：不接真实 provider，逐 agent/tier 回可核对的确定性文本。
    const seen: Array<{ agentId: string; tier: CapabilityTier }> = [];
    const fakeResolver: NewBookModelResolver = {
      createAdapter: (agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'> => {
        seen.push({ agentId, tier });
        return {
          complete: async () => ({ text: `【${agentId}/${tier} 生成结果】`, finishReason: 'stop' as const }),
        };
      },
    };
    const registrations = buildNewBookWritingRegistrations(fakeResolver);
    check('工厂产出四份写作循环注册项', registrations.length === 4);
    const draftRegistration = registrations.find((item) => item.playbook.id === 'new-book.draft-writing');
    if (draftRegistration === undefined) throw new Error('缺少章节初稿生成注册项');

    const runtime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => undefined,
      getFactStore: () => undefined,
      taskRuns,
    });
    for (const registration of registrations) runtime.registerPlaybook(registration);

    // 章节初稿生成：compose-draft(auto)→author-accept-draft(author) 全生命周期。
    const wc = new FakeWebContents();
    const runId = randomUUID();
    await runtime.runPlaybookTask(wc.asWebContents(), {
      registration: draftRegistration,
      taskRunId: runId,
      inputs: { sceneOutline: [{ beat: '开场冲突' }] },
    });
    const awaiting = await taskRuns.get(runId);
    check('初稿生成收敛 awaiting-author 且停在作者确认步',
      awaiting?.status === 'awaiting-author' && awaiting.currentStepId === 'author-accept-draft');
    check('初稿生成首步经真实模型产出可追踪产物',
      awaiting?.artifacts.some((artifact) => artifact.outputKey === 'chapterDraft') === true);
    check('初稿生成调用 writer/prose 档',
      seen.some((call) => call.agentId === 'writer' && call.tier === 'prose'));
    check('初稿生成 kind 为 new-book-planning',
      wc.taskActivity.every((event) => event.kind === 'new-book-planning'));
    // 真实事件有序：input 先于 awaiting-author。
    const inputIdx = wc.taskActivity.findIndex((event) => event.type === 'task-activity' && event.phase === 'input');
    const awaitingIdx = wc.taskActivity.findIndex((event) => event.type === 'task-activity' && event.status === 'awaiting-author');
    check('初稿生成事件有序：输入先于等待作者', inputIdx !== -1 && awaitingIdx !== -1 && inputIdx < awaitingIdx);

    await runtime.submitPlaybookAuthorDecision(wc.asWebContents(), runId, 'author-accept-draft', { accepted: true }, `decision:${runId}:1`);
    const completed = await taskRuns.get(runId);
    check('初稿生成经作者确认收敛 completed 且复用同一 taskRunId',
      completed?.id === runId && completed.status === 'completed');
    check('初稿生成作者决策可追踪',
      completed?.authorDecisions.length === 1 && completed.authorDecisions[0]?.stepId === 'author-accept-draft');
    check('初稿生成下发完成事件', wc.taskActivity.some((event) => event.type === 'task-run-completed'));

    // 作者修订：三步含 apply-revisions 依赖前一步作者决策，验证决策可被后续步骤消费。
    const revisionRegistration = registrations.find((item) => item.playbook.id === 'new-book.author-revision');
    if (revisionRegistration === undefined) throw new Error('缺少作者修订注册项');
    const revWc = new FakeWebContents();
    const revId = randomUUID();
    await runtime.runPlaybookTask(revWc.asWebContents(), {
      registration: revisionRegistration,
      taskRunId: revId,
      inputs: { chapterDraft: { text: '初稿正文' } },
    });
    check('作者修订收敛 awaiting-author 停在作者取舍步',
      (await taskRuns.get(revId))?.currentStepId === 'author-approve-revisions');
    await runtime.submitPlaybookAuthorDecision(revWc.asWebContents(), revId, 'author-approve-revisions', { accept: ['r1'] }, `decision:${revId}:1`);
    const revDone = await taskRuns.get(revId);
    check('作者修订经决策后 apply-revisions 产出修订稿并 completed',
      revDone?.status === 'completed' && revDone.artifacts.some((artifact) => artifact.outputKey === 'revisedDraft'));
    check('作者修订调用 editor 档', seen.some((call) => call.agentId === 'editor'));
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 5.4 [Integration Test] 新书主路径端到端 + 新书/旧作切换共用契约：
 *
 * A) 无旧正文的新书主路径：在同一 OrchestrationRuntime + 同一 TaskRunRepository 上，
 *    顺序驱动「立意→世界观→人物设计→全书大纲→章节规划→分场大纲」六个规划任务，
 *    再驱动「章节初稿生成→作者修订」写作循环，逐阶段把上一任务产物作为下一任务输入
 *    （分场大纲 sceneOutline 喂给初稿生成），验证：
 *      - 全程无 project/book/manuscript 引用（不依赖既有正文）；
 *      - 每个任务经作者决策收敛 completed、复用同一 taskRunId、产物与决策持久化；
 *      - 写作循环用的是与生产同源的真实执行器注册（buildNewBookWritingRegistrations）。
 * B) 新书/旧作切换共用 Task Runtime 与 IPC 契约：同一 runtime/taskRuns 注册新书写作
 *    playbook 与旧作 locate-source playbook，各跑一条 run，验证两者：
 *      - 落到同一 TaskRunRepository（共用运行态存储）；
 *      - 走同一 taskActivityEvent IPC 通道、同一事件结构（BackendTaskActivityEvent）；
 *      - 仅 kind 字段按任务族区分（new-book-planning vs locate-source）。
 * 红线：活动不得泄露隐藏思维链（prompt/reasoning 字段）。
 */
async function smokeNewBookMainPathEndToEnd(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-new-book-e2e-'));
  const opened = await openDatabase(join(dir, 'new-book-e2e.db'));
  if (!opened.ok) {
    check('new-book E2E SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const taskRuns = new TaskRunRepository(db);
    // fake 模型：写作执行器经注入 resolver 取能力，回确定性文本。
    const fakeResolver: NewBookModelResolver = {
      createAdapter: (agentId: string, tier: CapabilityTier): Pick<ModelAdapter, 'complete'> => ({
        complete: async () => ({ text: `【${agentId}/${tier}】`, finishReason: 'stop' as const }),
      }),
    };
    // 单一 runtime + 单一 taskRuns：证明整条主路径共用同一 Task Runtime。
    const runtime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => undefined,
      getFactStore: () => undefined,
      taskRuns,
    });

    // 为规划 playbook 构造 fake 生产注册：每步产出其声明的全部输出产物（作者可见结构化结果），
    // 作者决策步经 apply 收敛。写作 playbook 用与生产同源的真实注册。
    const buildPlanningRegistration = (playbook: TaskPlaybook): PlaybookRegistration => {
      const outputArtifacts = playbook.outputs.map((output) => ({
        outputKey: output.key,
        value: { producedBy: playbook.id, key: output.key },
        ref: { kind: 'draft' as const, label: output.label, ref: `${playbook.id}:${output.key}` },
      }));
      const lastStepId = playbook.steps[playbook.steps.length - 1]?.id;
      const handlers: Record<string, PlaybookStepHandler> = {};
      for (const step of playbook.steps) {
        // 只在最后一步挂产物，确保产物出现在任务收敛前的终态步骤。
        const artifacts = step.id === lastStepId ? outputArtifacts : [];
        if (step.requiresAuthorDecision) {
          handlers[step.id] = {
            requiresAuthor: true,
            prompt: async () => ({ message: `请确认「${playbook.title}」结果`, nextAction: '在任务卡提交确认' }),
            apply: async () => ({ message: '已收到作者确认', artifacts }),
          };
        } else {
          handlers[step.id] = {
            run: async () => ({ message: `已产出「${step.title}」`, artifacts }),
          };
        }
      }
      return { playbook, title: playbook.title, completedSummary: `已完成「${playbook.title}」`, handlers };
    };

    const writingRegistrations = buildNewBookWritingRegistrations(fakeResolver);
    const draftRegistration = writingRegistrations.find((item) => item.playbook.id === 'new-book.draft-writing');
    const revisionRegistration = writingRegistrations.find((item) => item.playbook.id === 'new-book.author-revision');
    if (draftRegistration === undefined || revisionRegistration === undefined) throw new Error('缺少写作循环注册项');

    // 从产物列表取某 outputKey 的值，作为下一阶段输入（阶段间产物依赖）。
    const artifactValue = (run: TaskRun | null, outputKey: string): unknown =>
      run?.artifacts.find((artifact) => artifact.outputKey === outputKey)?.value;

    // 驱动单个 playbook 到 completed：run→(若 awaiting-author 则逐步 submit)→completed，全程共用 wc。
    const drive = async (
      registration: PlaybookRegistration,
      inputs: Readonly<Record<string, unknown>>,
    ): Promise<TaskRun> => {
      // 作者决策提交需从 #playbooks 查找注册，故驱动前先注册。
      runtime.registerPlaybook(registration);
      const wc = new FakeWebContents();
      const runId = randomUUID();
      await runtime.runPlaybookTask(wc.asWebContents(), { registration, taskRunId: runId, inputs });
      // 循环消化所有作者决策步（规划/写作可能有多个）。
      let guard = 0;
      for (;;) {
        const current = await taskRuns.get(runId);
        if (current === null) throw new Error(`任务 ${registration.playbook.id} 未持久化`);
        if (current.status !== 'awaiting-author') break;
        const stepId = current.currentStepId;
        if (stepId === null) throw new Error('awaiting-author 缺 currentStepId');
        await runtime.submitPlaybookAuthorDecision(wc.asWebContents(), runId, stepId, { accepted: true }, `decision:${runId}:${guard}`);
        guard += 1;
        if (guard > 6) throw new Error('作者决策步过多，疑似未收敛');
      }
      const done = await taskRuns.get(runId);
      if (done === null) throw new Error('任务终态未持久化');
      // 主路径红线：不依赖既有正文——无 project/book/manuscript 引用。
      check(`E2E 主路径「${registration.playbook.title}」无旧正文引用（project/book/manuscript 均 null）`,
        done.refs.projectId === null && done.refs.bookId === null && done.refs.manuscriptId === null);
      check(`E2E 主路径「${registration.playbook.title}」经作者决策收敛 completed 且复用同一 taskRunId`,
        done.id === runId && done.status === 'completed' && done.authorDecisions.length >= 1);
      // 红线：活动不得携带隐藏思维链。
      const leaksCot = wc.taskActivity.some((event) =>
        Object.prototype.hasOwnProperty.call(event, 'prompt') ||
        Object.prototype.hasOwnProperty.call(event, 'reasoning'));
      check(`E2E 主路径「${registration.playbook.title}」活动不泄露隐藏思维链`, !leaksCot);
      check(`E2E 主路径「${registration.playbook.title}」kind 为 new-book-planning`,
        wc.taskActivity.every((event) => event.kind === 'new-book-planning'));
      return done;
    };

    // —— A. 规划链：逐阶段把上一任务产物喂给下一任务的必填输入 ——
    const conceptRun = await drive(buildPlanningRegistration(NEW_BOOK_STAGE_PLAYBOOKS.concept), { premise: '一座会呼吸的城市' });
    const concept = artifactValue(conceptRun, 'concept');
    const worldRun = await drive(buildPlanningRegistration(NEW_BOOK_STAGE_PLAYBOOKS.worldbuilding), { concept });
    const worldSetting = artifactValue(worldRun, 'worldSetting');
    const castRun = await drive(buildPlanningRegistration(NEW_BOOK_STAGE_PLAYBOOKS['character-design']), { concept, worldSetting });
    const characterProfiles = artifactValue(castRun, 'characterProfiles');
    const outlineRun = await drive(buildPlanningRegistration(NEW_BOOK_STAGE_PLAYBOOKS['book-outline']), { concept, characterProfiles, worldSetting });
    const bookOutline = artifactValue(outlineRun, 'bookOutline');
    const chapterPlanRun = await drive(buildPlanningRegistration(NEW_BOOK_STAGE_PLAYBOOKS['chapter-plan']), { bookOutline });
    const chapterPlan = artifactValue(chapterPlanRun, 'chapterPlan');
    const sceneRun = await drive(buildPlanningRegistration(NEW_BOOK_STAGE_PLAYBOOKS['scene-outline']), { chapterPlan, characterProfiles });
    const sceneOutline = artifactValue(sceneRun, 'sceneOutline');
    check('E2E 主路径规划链阶段间产物依赖成立（各阶段产出非空并向后传递）',
      concept !== undefined && worldSetting !== undefined && characterProfiles !== undefined &&
        bookOutline !== undefined && chapterPlan !== undefined && sceneOutline !== undefined);

    // —— A. 写作循环：真实执行器注册，初稿生成消费分场大纲，作者修订消费初稿 ——
    const draftRun = await drive(draftRegistration, { sceneOutline, characterProfiles, worldSetting });
    const chapterDraft = artifactValue(draftRun, 'chapterDraft');
    check('E2E 主路径章节初稿生成消费分场大纲并产出章节初稿',
      chapterDraft !== undefined && draftRun.artifacts.some((artifact) => artifact.outputKey === 'chapterDraft'));
    const revisionRun = await drive(revisionRegistration, { chapterDraft });
    check('E2E 主路径作者修订消费初稿并产出修订稿',
      revisionRun.artifacts.some((artifact) => artifact.outputKey === 'revisedDraft'));

    // 整条主路径共用同一 TaskRunRepository：八条 run 均可从同一仓储取回，taskRunId 互异。
    const allRunIds = [conceptRun, worldRun, castRun, outlineRun, chapterPlanRun, sceneRun, draftRun, revisionRun].map((run) => run.id);
    check('E2E 主路径八阶段共用同一 Task Runtime 存储且 taskRunId 互异',
      new Set(allRunIds).size === 8 && (await Promise.all(allRunIds.map((id) => taskRuns.get(id)))).every((run) => run?.status === 'completed'));

    // —— B. 新书/旧作切换共用 Task Runtime 与 IPC 契约 ——
    // 旧作 locate-source fixture 用 fake handler（此处只验证 kind/通道契约，不接真实定位）。
    const legacyRegistration: PlaybookRegistration = {
      playbook: LEGACY_LOCATE_SOURCE_PLAYBOOK,
      title: '定位诊断问题对应的原文',
      completedSummary: '已确认原文位置',
      handlers: {
        'read-chapter': { run: async () => ({ message: '已读取目标章节', artifacts: [] }) },
        'match-evidence': { run: async () => ({ message: '已匹配诊断证据', artifacts: [] }) },
        'confirm-location': {
          requiresAuthor: true,
          prompt: async () => ({ message: '请确认原文位置', nextAction: '在任务卡选择候选' }),
          apply: async () => ({ message: '已确认原文位置', artifacts: [{ outputKey: 'sourceLocation', value: { chapter: 'c1' }, ref: { kind: 'source-location' as const, label: '原文定位', ref: 'loc:1' } }] }),
        },
      },
    };
    runtime.registerPlaybook(draftRegistration);
    runtime.registerPlaybook(legacyRegistration);

    const nbWc = new FakeWebContents();
    const nbId = randomUUID();
    await runtime.runPlaybookTask(nbWc.asWebContents(), { registration: draftRegistration, taskRunId: nbId, inputs: { sceneOutline } });
    await runtime.submitPlaybookAuthorDecision(nbWc.asWebContents(), nbId, 'author-accept-draft', { accepted: true }, `switch:nb:${nbId}`);

    const lgWc = new FakeWebContents();
    const lgId = randomUUID();
    await runtime.runPlaybookTask(lgWc.asWebContents(), {
      registration: legacyRegistration, taskRunId: lgId,
      inputs: { issue: { id: 'i1' }, evidence: { quote: 'q' }, chapterAnchor: 'c1' },
    });
    await runtime.submitPlaybookAuthorDecision(lgWc.asWebContents(), lgId, 'confirm-location', { candidate: 0 }, `switch:lg:${lgId}`);

    const nbRun = await taskRuns.get(nbId);
    const lgRun = await taskRuns.get(lgId);
    check('B 新书/旧作两条 run 落到同一 TaskRunRepository 并均 completed',
      nbRun?.status === 'completed' && lgRun?.status === 'completed' && nbRun.id !== lgRun.id);
    // 两者走同一 taskActivityEvent 通道、同一事件结构；仅 kind 按任务族区分。
    check('B 新书任务经 taskActivityEvent 通道且 kind=new-book-planning',
      nbWc.taskActivity.length > 0 && nbWc.taskActivity.every((event) => event.kind === 'new-book-planning') &&
        nbWc.stream.length === 0 && nbWc.modelTask.length === 0);
    check('B 旧作任务经同一 taskActivityEvent 通道且 kind=locate-source',
      lgWc.taskActivity.length > 0 && lgWc.taskActivity.every((event) => event.kind === 'locate-source') &&
        lgWc.stream.length === 0 && lgWc.modelTask.length === 0);
    check('B 两任务事件共用同一结构（均含 taskRunId 且下发完成事件）',
      nbWc.taskActivity.some((event) => event.type === 'task-run-completed' && event.taskRunId === nbId) &&
        lgWc.taskActivity.some((event) => event.type === 'task-run-completed' && event.taskRunId === lgId));
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 5.5 [Regression] 新任务经 playbook 扩展、旧 standalone 召唤与已有运行路径不回归：
 *
 * 1) 扩展机制：一份运行时新建、从未内置于 Core 的 playbook，仅经 runtime.registerPlaybook 即
 *    可经通用引擎 run→awaiting-author→submit→completed，无需修改 runtime 代码；
 *    并验证多份注册互不干扰、未注册的 playbookId 不可提交决策。
 * 2) 旧路径不回归：在同一个已注册了多份 playbook 的 runtime 上，旧 standalone summon
 *    happy path 仍产出流式分片与 graph 事件、不误挂起、收 stream-end；
 *    且严格通道隔离：summon 走 dialogueStream/controlEvent，playbook 任务走 taskActivityEvent，
 *    互不串道。
 */
async function smokePlaybookExtensionNoRegression(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-regression-'));
  const opened = await openDatabase(join(dir, 'regression.db'));
  if (!opened.ok) {
    check('regression SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const taskRuns = new TaskRunRepository(db);
    const checkpointer = new SqliteCheckpointer(db);
    // summon 用真实 LangGraph + fake 模型；playbook 任务用同一 runtime。
    const summonResolver = new FakeModelResolver('regression happy path 正文', '[]').asResolver();
    const runtime = new OrchestrationRuntime({
      getModelResolver: () => summonResolver,
      getCheckpointer: () => checkpointer,
      getFactStore: () => undefined, // 无事实库 → 降级不召回（与 happy path 基线一致）
      taskRuns,
    });

    // —— 1. 扩展机制：运行时新建的 playbook（非 Core 内置）仅经注册即可跑 ——
    const adHocPlaybook: TaskPlaybook = {
      id: 'regression.ad-hoc-note',
      version: 1,
      kind: 'temporary',
      title: '临时纪要',
      description: '一份运行时声明的新任务，用于验证扩展点无需改 runtime 代码。',
      inputs: [{ key: 'topic', label: '主题', valueType: 'string', required: true, description: '纪要主题。' }],
      steps: [
        { id: 'draft-note', title: '起草纪要', description: '产出纪要草稿。', requiresAuthorDecision: false },
        { id: 'author-confirm-note', title: '作者确认纪要', description: '由作者确认。', requiresAuthorDecision: true },
      ],
      outputs: [{ key: 'note', label: '纪要', valueType: 'object', description: '经作者确认的纪要。' }],
    };
    const adHocRegistration: PlaybookRegistration = {
      playbook: adHocPlaybook,
      title: '临时纪要',
      completedSummary: '已完成临时纪要',
      handlers: {
        'draft-note': { run: async (ctx) => ({ message: '已起草纪要', artifacts: [{ outputKey: 'draftNote', value: { topic: ctx.inputs['topic'] }, ref: { kind: 'draft', label: '纪要草稿', ref: `note:${ctx.run.id}` } }] }) },
        'author-confirm-note': {
          requiresAuthor: true,
          prompt: async () => ({ message: '请确认纪要', nextAction: '在任务卡确认' }),
          apply: async () => ({ message: '已确认纪要', artifacts: [{ outputKey: 'note', value: { confirmed: true }, ref: { kind: 'draft', label: '纪要', ref: 'note:final' } }] }),
        },
      },
    };
    // 另注册一份写作注册（既有任务族）以验证多份注册共存。
    const fakeResolver: NewBookModelResolver = {
      createAdapter: (): Pick<ModelAdapter, 'complete'> => ({ complete: async () => ({ text: '初稿', finishReason: 'stop' as const }) }),
    };
    const draftRegistration = buildNewBookWritingRegistrations(fakeResolver).find((item) => item.playbook.id === 'new-book.draft-writing');
    if (draftRegistration === undefined) throw new Error('缺少初稿生成注册项');
    runtime.registerPlaybook(adHocRegistration);
    runtime.registerPlaybook(draftRegistration);

    const adHocWc = new FakeWebContents();
    const adHocId = randomUUID();
    await runtime.runPlaybookTask(adHocWc.asWebContents(), { registration: adHocRegistration, taskRunId: adHocId, inputs: { topic: '回归验证' } });
    check('回归 扩展：运行时新建 playbook 仅经注册即进入 awaiting-author',
      (await taskRuns.get(adHocId))?.status === 'awaiting-author');
    await runtime.submitPlaybookAuthorDecision(adHocWc.asWebContents(), adHocId, 'author-confirm-note', { accepted: true }, `regression:adhoc:${adHocId}`);
    const adHocDone = await taskRuns.get(adHocId);
    check('回归 扩展：新建 playbook 经通用引擎收敛 completed（无需改 runtime 代码）',
      adHocDone?.status === 'completed' && adHocDone.kind === 'temporary' && adHocDone.artifacts.some((artifact) => artifact.outputKey === 'note'));

    // 多份注册互不干扰：写作注册在同一 runtime 仍可独立跑。
    const draftWc = new FakeWebContents();
    const draftId = randomUUID();
    await runtime.runPlaybookTask(draftWc.asWebContents(), { registration: draftRegistration, taskRunId: draftId, inputs: { sceneOutline: [{ beat: 'x' }] } });
    check('回归 扩展：多份注册共存，写作任务仍可独立进入 awaiting-author',
      (await taskRuns.get(draftId))?.status === 'awaiting-author' && (await taskRuns.get(draftId))?.kind === 'new-book');

    // 向已注册任务提交不存在的步骤被拒绝：下发可读失败活动且不改任务状态（健壮性/隔离）。
    await runtime.submitPlaybookAuthorDecision(draftWc.asWebContents(), draftId, 'no-such-step', {}, `regression:badstep:${draftId}`);
    check('回归 扩展：向已注册任务提交不存在步骤被拒绝且不改状态',
      draftWc.taskActivity.some((event) => event.type === 'task-activity' && event.phase === 'failed') &&
        (await taskRuns.get(draftId))?.status === 'awaiting-author');

    // —— 2. 旧 standalone summon happy path 在已注册 playbook 的 runtime 上不回归 ——
    const summonWc = new FakeWebContents();
    const summonRunId = randomUUID() as RunId;
    await runtime.summon(summonWc.asWebContents(), {
      runId: summonRunId, mode: 'mutate', agent: 'writer', scope: 'project', instruction: '写一段',
    });
    check('回归 旧路径：summon happy path 在含 playbook 的 runtime 上仍产出流式分片',
      collectDialogue(summonWc).length > 0);
    check('回归 旧路径：summon 收 stream-end 且不误挂起',
      summonWc.stream.some((message) => message.type === 'stream-end') && collectInterrupt(summonWc) === undefined);
    check('回归 旧路径：summon 仍下发 graph-node-activated 活图事件',
      collectGraphEvents(summonWc).length > 0);
    // 严格通道隔离：summon 不混入 taskActivityEvent；playbook 任务不混入 dialogueStream。
    check('回归 通道隔离：summon 不产生任务活动事件', summonWc.taskActivity.length === 0);
    check('回归 通道隔离：playbook 任务不混入对话/模型任务通道',
      adHocWc.stream.length === 0 && adHocWc.modelTask.length === 0 && draftWc.stream.length === 0 && draftWc.modelTask.length === 0);

    // summon 与 playbook 任务共存于同一 runtime：两者均成功且互不干扰。
    check('回归 共存：summon 与 playbook 任务在同一 runtime 上都正常完成/挂起',
      collectInterrupt(summonWc) === undefined && adHocDone?.status === 'completed');
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 4.4 [Integration Test] locate-source 端到端验收：
 * 单条 issue 贯穿「选择问题 → 创建任务 → 展示输入 → 读取证据 → 查找/匹配正文 →
 * 真实活动 → UI Effect → 作者确认 → 进入局部改写」的有序旅程。
 * 与既有零散断言不同，本用例在同一 workflow 实例上按序验证整条链路，并守卫
 * 红线：活动不得泄露整章正文或隐藏思维链，活动必须来自真实 Task Runtime 持久化。
 */
async function smokeLocateSourceEndToEnd(): Promise<void> {
  const quote = '他忽然丢下同伴独自离开。';
  // 刻意构造多候选正文：迫使流程进入等待作者，验证 awaiting-author → 作者确认尾段。
  const chapterContent = `第一幕。${quote}随后众人追问。第二幕。${quote}此后再无人提起。`;
  const dir = await mkdtemp(join(tmpdir(), 'na-locate-e2e-'));
  const opened = await openDatabase(join(dir, 'locate-e2e.db'));
  if (!opened.ok) {
    check('locate-source E2E SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const workflows = new WorkflowRepository(db);
    const workflowIssues = new WorkflowIssueRepository(db);
    const service = new WorkflowApplicationService(workflows, new CreativeAssetRepository(db), workflowIssues);
    const evidence = new SqliteStageRunEvidenceRecorder(db);
    const taskRuns = new TaskRunRepository(db);
    const chapterId = asNodeId('e2e-chapter');
    const workflowId = 'locate-e2e';

    // 准备工作流并推进到 issue-triage，暴露待选问题。
    const started = await service.command({
      type: 'start-workflow', workflowId, projectId: `${workflowId}-project`, kind: 'legacy-book-revision',
      objective: '定位诊断问题对应的原文', requestId: `${workflowId}-start`, operationId: `${workflowId}-start-op`,
    });
    if (started === null) throw new Error('E2E workflow fixture failed');
    const [issue] = await workflowIssues.upsertFromAudit(workflowId, `${workflowId}-audit`, [{
      type: 'behavior-ooc', severity: 'warning', anchors: [{ id: chapterId, kind: 'chapter' }],
      description: '主角在证据段落中的行为与既定性格不一致。', requiresHumanDecision: false,
      evidence: { quote },
    }]);
    if (issue === undefined) throw new Error('E2E issue fixture failed');

    const advance = async (templateStageId: string, author: boolean): Promise<void> => {
      const current = await workflows.get(workflowId);
      if (current === null || current.currentStageId === null) throw new Error(`missing ${templateStageId}`);
      const stage = current.stages.find((candidate) => candidate.stageId === current.currentStageId);
      if (stage?.templateStageId !== templateStageId) throw new Error(`expected ${templateStageId}, got ${stage?.templateStageId}`);
      const stageRunId = `${workflowId}:${templateStageId}` as RunId;
      await service.command({
        type: 'workflow-start-stage', workflowId, stageId: current.currentStageId,
        expectedVersion: current.version, runId: stageRunId,
        requestId: `${stageRunId}-start`, operationId: `${stageRunId}-start-op`,
      });
      await evidence.record({ runId: stageRunId, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'started' });
      await evidence.record({
        runId: stageRunId, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'completed',
        ...(stage?.actor === 'quality-gate' ? { completion: { passed: true, issueIds: [] } } : {}),
      });
      if (!author) return;
      const awaiting = await workflows.get(workflowId);
      if (awaiting === null || awaiting.currentStageId === null) throw new Error(`author stage ${templateStageId} disappeared`);
      await service.command({
        type: 'workflow-confirm-stage', workflowId, stageId: awaiting.currentStageId,
        expectedVersion: awaiting.version, requestId: `${stageRunId}-confirm`, operationId: `${stageRunId}-confirm-op`,
      });
    };

    await advance('import-book', true);
    await advance('fact-backfill', false);
    await advance('initial-audit', false);
    const triage = await workflows.get(workflowId);
    if (triage === null || triage.currentStageId === null) throw new Error('E2E issue triage missing');

    // 步骤①：选择问题 → 持久化当前问题引用。
    const selection = await service.command({
      type: 'workflow-select-issue', workflowId, stageId: triage.currentStageId, issueId: issue.issueId,
      workflowRef: { workflowId, stageId: triage.currentStageId, issueId: issue.issueId },
      expectedVersion: triage.version, runId: `${workflowId}:selection`,
      requestId: `${workflowId}-select`, operationId: `${workflowId}-select-op`,
    });
    check('E2E ① 选择问题持久化当前问题', selection?.selectedIssueId === issue.issueId);
    await advance('issue-triage', true);
    const locate = await workflows.get(workflowId);
    if (locate === null || locate.currentStageId === null) throw new Error('E2E locate-source stage missing');
    check('E2E 阶段推进后保留当前问题', locate.selectedIssueId === issue.issueId);

    const runtime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => undefined,
      getFactStore: () => undefined,
      workflows, workflowIssues, stageRunEvidence: evidence, taskRuns,
      manuscript: {
        readChapterContent: async (nodeId: string) => ({ nodeId, content: chapterContent }),
        writeBackRefactoredFragment: async () => ({ ok: false, reason: 'io-error' as const }),
      },
    });

    // 步骤②③④：创建任务 → 展示输入 → 读取证据 → 查找/匹配 → 真实活动（多候选等待作者）。
    const wc = new FakeWebContents();
    await runtime.locateSource(wc.asWebContents(), randomUUID() as RunId, {
      workflowId, stageId: locate.currentStageId, issueId: issue.issueId,
    });
    const activities = wc.taskActivity.filter((event): event is Extract<BackendTaskActivityEvent, { type: 'task-activity' }> => event.type === 'task-activity');
    const inputActivity = activities.find((event) => event.phase === 'input');
    const retrievalActivity = activities.find((event) => event.phase === 'retrieval');
    const waitingActivity = activities.find((event) => event.status === 'awaiting-author');
    if (inputActivity === undefined || waitingActivity === undefined) throw new Error('E2E input/awaiting activity missing');
    const taskRunId = inputActivity.taskRunId;

    check('E2E ② 创建任务并展示作者可读输入',
      inputActivity.inputSummary !== undefined && inputActivity.inputSummary.length > 0 &&
        inputActivity.evidenceRefs?.some((ref) => ref.kind === 'issue') === true &&
        inputActivity.evidenceRefs.some((ref) => ref.kind === 'chapter') &&
        inputActivity.evidenceRefs.some((ref) => ref.kind === 'quote'));
    check('E2E ③ 读取证据产生真实读取活动',
      retrievalActivity?.phase === 'retrieval' && retrievalActivity.message.includes('匹配'));
    // 红线：活动不得把整章正文或隐藏思维链下发到消息流。
    const leaksProse = activities.some((event) =>
      event.message.includes(chapterContent) ||
      (event.inputSummary?.includes(chapterContent) ?? false) ||
      (event.outputSummary?.includes(chapterContent) ?? false) ||
      Object.prototype.hasOwnProperty.call(event, 'prompt') ||
      Object.prototype.hasOwnProperty.call(event, 'reasoning'));
    check('E2E 活动不泄露整章正文/隐藏思维链', !leaksProse);

    // 断言真实持久化：等待态与候选来自 Task Runtime 仓储，而非伪造。
    const persistedWaiting = await taskRuns.get(taskRunId);
    const persistedCandidates = await taskRuns.listPendingCandidates(taskRunId);
    check('E2E ④ 查找/匹配后进入等待作者（真实候选持久化）',
      persistedWaiting?.status === 'awaiting-author' && persistedCandidates.length === 2 &&
        waitingActivity.authorCandidates?.length === 2);
    check('E2E 等待态未推进阶段、未完成',
      (await workflows.get(workflowId))?.currentStageId === locate.currentStageId &&
        !wc.taskActivity.some((event) => event.type === 'task-run-completed'));

    // 步骤⑤⑥⑦：作者确认候选 → UI Effect → 完成 → 进入局部改写。
    const chosen = persistedCandidates[0];
    if (chosen === undefined) throw new Error('E2E candidate missing');
    const confirmWc = new FakeWebContents();
    await runtime.chooseSourceLocation(confirmWc.asWebContents(), taskRunId, chosen.candidateId, `choose:${taskRunId}:${chosen.candidateId}`);
    const confirmActivities = confirmWc.taskActivity.filter((event): event is Extract<BackendTaskActivityEvent, { type: 'task-activity' }> => event.type === 'task-activity');
    const validationActivity = confirmActivities.find((event) => event.phase === 'validation');
    const uiEffectActivity = confirmActivities.find((event) => event.phase === 'ui-effect');
    const completedEvent = confirmWc.taskActivity.find((event) => event.type === 'task-run-completed');
    const finalTask = await taskRuns.get(taskRunId);
    const finalWorkflow = await workflows.get(workflowId);

    check('E2E ⑤ 作者确认后收敛 completed 且决策持久化',
      finalTask?.status === 'completed' && finalTask.id === taskRunId && finalTask.authorDecisions.length === 1);
    check('E2E 作者确认经过校验阶段（真实活动）', validationActivity?.phase === 'validation');
    check('E2E ⑥ 完成发布切章/滚动/高亮 UI Effect',
      uiEffectActivity?.uiEffects?.some((effect) => effect.kind === 'select-chapter') === true &&
        uiEffectActivity.uiEffects.some((effect) => effect.kind === 'scroll-to-evidence') &&
        uiEffectActivity.uiEffects.some((effect) => effect.kind === 'highlight-quote'));
    check('E2E 完成事件携带定位产物',
      completedEvent?.type === 'task-run-completed' && completedEvent.artifactRefs?.some((artifact) => artifact.kind === 'source-location') === true);
    check('E2E ⑦ 作者确认后进入局部改写阶段',
      finalWorkflow?.stages.find((stage) => stage.stageId === finalWorkflow.currentStageId)?.templateStageId === 'generate-rewrite');

    // 有序旅程：input < retrieval < awaiting-author < validation < ui-effect < completed，全部来自真实持久活动。
    const persistedEvents = await taskRuns.listEvents(taskRunId);
    const phaseOrder = persistedEvents
      .filter((event): event is Extract<BackendTaskActivityEvent, { type: 'task-activity' }> => event.type === 'task-activity')
      .map((event) => event.phase);
    const indexOf = (phase: string): number => phaseOrder.indexOf(phase as (typeof phaseOrder)[number]);
    const orderedChain =
      indexOf('input') >= 0 &&
      indexOf('input') < indexOf('retrieval') &&
      indexOf('retrieval') < indexOf('awaiting-author') &&
      indexOf('awaiting-author') < indexOf('validation') &&
      indexOf('validation') < indexOf('ui-effect');
    const completedInStore = persistedEvents.some((event) => event.type === 'task-run-completed');
    check('E2E 有序活动链路来自真实 Task Runtime 持久化',
      orderedChain && completedInStore, phaseOrder.join('→'));
    check('E2E 任务事件不混入专家对话流/模型任务通道',
      wc.stream.length === 0 && wc.modelTask.length === 0 && confirmWc.stream.length === 0 && confirmWc.modelTask.length === 0);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 4.6 [Integration Test] 局部改写循环边界：
 * 以真实 manuscript I/O + 真实 SqliteCheckpointer 驱动 computeRefactorDiff → applyHunkDecisions，
 * 覆盖（a）无锚点/越界锚点校验失败且正文不动、（b）预览后引用变化导致 apply 因基线变动失败、
 * （c）正文写入必须逐 hunk（仅接受区间写回、章节其余原样、产出可回滚 checkpoint）、
 * （d）写回 IO 失败下发可恢复失败、IO 恢复后同 run 重试成功写回。
 * 红线：绝不整章覆盖；失败路径不改动磁盘正文、不产出 refactor-applied。
 */
async function smokeRefactorLoopBoundaries(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-refactor-loop-'));
  const opened = await openDatabase(join(dir, 'refactor-loop.db'));
  if (!opened.ok) {
    check('refactor loop SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const nodeId = 'refactor-loop-chapter';
    const original = '顾长风揠住茶壶，手腕一抖，碎壶不伤手。大老王看得目瞪口呆。';
    let chapterText = original;
    let ioFails = false;
    const manuscript = {
      readChapterContent: async (id: string) => ({ nodeId: id, content: chapterText }),
      writeBackRefactoredFragment: async (anchor: FragmentAnchor, fragmentText: string) => {
        if (ioFails) return { ok: false, reason: 'io-error' as const };
        // 仅替换锚点区间，绝不整章覆盖。
        chapterText = chapterText.slice(0, anchor.from) + fragmentText + chapterText.slice(anchor.to);
        return { ok: true, newContentLength: chapterText.length };
      },
    };
    const runtime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => new SqliteCheckpointer(db),
      getFactStore: () => undefined,
      manuscript,
    });
    const rewritten = '顾九揠紧铁壶，手腕一抽，碎壶不伤手';
    const anchor: FragmentAnchor = { node: { id: asNodeId(nodeId), kind: 'chapter' }, from: 0, to: 11 };

    // (a) 越界锚点：compute 与 apply 均校验失败，磁盘正文不动。
    const oobAnchor: FragmentAnchor = { node: { id: asNodeId(nodeId), kind: 'chapter' }, from: 0, to: 9999 };
    const oobDiffWc = new FakeWebContents();
    await runtime.computeRefactorDiff(oobDiffWc.asWebContents(), randomUUID() as RunId, oobAnchor, rewritten);
    const oobDiffFailed = oobDiffWc.control.find((item) => item.type === 'refactor-diff-failed');
    check('4.6 越界锚点：computeRefactorDiff 校验失败',
      oobDiffFailed?.type === 'refactor-diff-failed' && oobDiffFailed.error.category === 'validation');
    const oobApplyWc = new FakeWebContents();
    await runtime.applyHunkDecisions(oobApplyWc.asWebContents(), randomUUID() as RunId, oobAnchor, rewritten, []);
    const oobApplyFailed = oobApplyWc.control.find((item) => item.type === 'refactor-apply-failed');
    check('4.6 越界锚点：applyHunkDecisions 校验失败且正文不动',
      oobApplyFailed?.type === 'refactor-apply-failed' && oobApplyFailed.error.category === 'validation' && chapterText === original);

    // (b) 引用变化：预览后正文在锚点区间内被外部改动 → apply 因基线 hash 变动失败，正文不动、无 refactor-applied。
    const refRunId = randomUUID() as RunId;
    const refDiffWc = new FakeWebContents();
    await runtime.computeRefactorDiff(refDiffWc.asWebContents(), refRunId, anchor, rewritten);
    const refDiff = refDiffWc.control.find((item) => item.type === 'refactor-diff-computed');
    check('4.6 引用变化：预览成功产出 diff',
      refDiff?.type === 'refactor-diff-computed' && refDiff.hunks.length > 0);
    chapterText = '顾七风揠住茶壶，手腕一抖，碎壶不伤手。大老王看得目瞪口呆。'; // 锚点区间内改动，等长
    const refBefore = chapterText;
    const refApplyWc = new FakeWebContents();
    if (refDiff?.type === 'refactor-diff-computed') {
      await runtime.applyHunkDecisions(
        refApplyWc.asWebContents(), refRunId, anchor, rewritten,
        refDiff.hunks.map((h) => ({ hunkId: h.id, decision: 'accept' as const })),
      );
    }
    const refApplyFailed = refApplyWc.control.find((item) => item.type === 'refactor-apply-failed');
    check('4.6 引用变化：apply 因基线变动失败，正文不动且无 refactor-applied',
      refApplyFailed?.type === 'refactor-apply-failed' && chapterText === refBefore &&
        !refApplyWc.control.some((item) => item.type === 'refactor-applied'));

    // (c) 逐 hunk：仅接受首个 hunk → 仅接受区间写回，章节其余原样，产出可回滚 checkpoint。
    chapterText = original;
    const partialRunId = randomUUID() as RunId;
    const partialDiffWc = new FakeWebContents();
    await runtime.computeRefactorDiff(partialDiffWc.asWebContents(), partialRunId, anchor, rewritten);
    const partialDiff = partialDiffWc.control.find((item) => item.type === 'refactor-diff-computed');
    if (partialDiff?.type !== 'refactor-diff-computed') throw new Error('4.6 partial diff missing');
    check('4.6 逐 hunk：diff 拆出多个可独立裁决 hunk', partialDiff.hunks.length >= 2, `hunks=${partialDiff.hunks.length}`);
    const firstHunk = partialDiff.hunks[0];
    if (firstHunk === undefined) throw new Error('4.6 partial first hunk missing');
    const partialApplyWc = new FakeWebContents();
    await runtime.applyHunkDecisions(
      partialApplyWc.asWebContents(), partialRunId, anchor, rewritten,
      [{ hunkId: firstHunk.id, decision: 'accept' as const }],
    );
    const partialApplied = partialApplyWc.control.find((item) => item.type === 'refactor-applied');
    const frag = carveFragment(original, anchor);
    if (frag === null) throw new Error('4.6 fragment carve failed');
    const expectedFragment = frag.text.slice(0, firstHunk.fragmentFrom) + firstHunk.rewritten + frag.text.slice(firstHunk.fragmentTo);
    const expectedChapter = expectedFragment + original.slice(anchor.to);
    check('4.6 逐 hunk：仅接受区间写回，章节其余原样',
      partialApplied?.type === 'refactor-applied' && chapterText === expectedChapter && chapterText !== (rewritten + original.slice(anchor.to)));
    check('4.6 逐 hunk：变更落定为可回滚 checkpoint 且仅记录接受项',
      partialApplied?.type === 'refactor-applied' && partialApplied.checkpointId !== undefined &&
        partialApplied.acceptedHunkIds.length === 1 && partialApplied.acceptedHunkIds[0] === firstHunk.id);

    // (d) 失败恢复：写回 IO 失败 → 可恢复失败、正文不动；IO 恢复后同 run 重试成功写回。
    chapterText = original;
    const recoverRunId = randomUUID() as RunId;
    const recoverDiffWc = new FakeWebContents();
    await runtime.computeRefactorDiff(recoverDiffWc.asWebContents(), recoverRunId, anchor, rewritten);
    const recoverDiff = recoverDiffWc.control.find((item) => item.type === 'refactor-diff-computed');
    if (recoverDiff?.type !== 'refactor-diff-computed') throw new Error('4.6 recover diff missing');
    const allDecisions = recoverDiff.hunks.map((h) => ({ hunkId: h.id, decision: 'accept' as const }));
    ioFails = true;
    const ioFailWc = new FakeWebContents();
    await runtime.applyHunkDecisions(ioFailWc.asWebContents(), recoverRunId, anchor, rewritten, allDecisions);
    const ioFailed = ioFailWc.control.find((item) => item.type === 'refactor-apply-failed');
    check('4.6 失败恢复：写回 IO 失败下发 io 类失败且正文不动',
      ioFailed?.type === 'refactor-apply-failed' && ioFailed.error.category === 'io' && chapterText === original);
    ioFails = false;
    const retryWc = new FakeWebContents();
    await runtime.applyHunkDecisions(retryWc.asWebContents(), recoverRunId, anchor, rewritten, allDecisions);
    const retryApplied = retryWc.control.find((item) => item.type === 'refactor-applied');
    check('4.6 失败恢复：IO 恢复后同 run 重试成功写回',
      retryApplied?.type === 'refactor-applied' && chapterText === (rewritten + original.slice(anchor.to)));
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 4.6 [Integration Test] 候选过多边界：
 * 诊断引文在正文中出现 N（=4）处且无上下文可消歧时，真实 Task Runtime locateSource
 * 必须收敛 awaiting-author 并把全部 N 个候选持久化，绝不自动猜测选择、不推进阶段、不完成。
 * 纯函数 locateSourceEvidence 亦复核“候选数不设默认上限、逐一保留”。
 */
async function smokeLocateCandidateOverflow(): Promise<void> {
  const quote = '他忽然丢下同伴独自离开。';
  // 四处相同引文、彼此上下文相似 → 无法消歧 → 全部成为候选。
  const chapterContent = `一幕。${quote}追问。二幕。${quote}沉默。三幕。${quote}离场。四幕。${quote}散去。`;
  // 纯函数层复核：不设默认上限，四处全部保留。
  const pure = locateSourceEvidence(chapterContent, { quote });
  check('4.6 候选过多：纯定位器保留全部候选不猜测',
    pure.status === 'ambiguous' && pure.candidates.length === 4);

  const dir = await mkdtemp(join(tmpdir(), 'na-locate-overflow-'));
  const opened = await openDatabase(join(dir, 'locate-overflow.db'));
  if (!opened.ok) {
    check('locate overflow SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const workflows = new WorkflowRepository(db);
    const workflowIssues = new WorkflowIssueRepository(db);
    const service = new WorkflowApplicationService(workflows, new CreativeAssetRepository(db), workflowIssues);
    const evidence = new SqliteStageRunEvidenceRecorder(db);
    const taskRuns = new TaskRunRepository(db);
    const chapterId = asNodeId('overflow-chapter');
    const workflowId = 'locate-overflow';

    const started = await service.command({
      type: 'start-workflow', workflowId, projectId: `${workflowId}-project`, kind: 'legacy-book-revision',
      objective: '候选过多边界', requestId: `${workflowId}-start`, operationId: `${workflowId}-start-op`,
    });
    if (started === null) throw new Error('overflow workflow fixture failed');
    const [issue] = await workflowIssues.upsertFromAudit(workflowId, `${workflowId}-audit`, [{
      type: 'behavior-ooc', severity: 'warning', anchors: [{ id: chapterId, kind: 'chapter' }],
      description: '主角行为与既定性格不一致。', requiresHumanDecision: false, evidence: { quote },
    }]);
    if (issue === undefined) throw new Error('overflow issue fixture failed');

    const advance = async (templateStageId: string, author: boolean): Promise<void> => {
      const current = await workflows.get(workflowId);
      if (current === null || current.currentStageId === null) throw new Error(`missing ${templateStageId}`);
      const stage = current.stages.find((candidate) => candidate.stageId === current.currentStageId);
      if (stage?.templateStageId !== templateStageId) throw new Error(`expected ${templateStageId}, got ${stage?.templateStageId}`);
      const stageRunId = `${workflowId}:${templateStageId}` as RunId;
      await service.command({
        type: 'workflow-start-stage', workflowId, stageId: current.currentStageId,
        expectedVersion: current.version, runId: stageRunId,
        requestId: `${stageRunId}-start`, operationId: `${stageRunId}-start-op`,
      });
      await evidence.record({ runId: stageRunId, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'started' });
      await evidence.record({
        runId: stageRunId, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'completed',
        ...(stage?.actor === 'quality-gate' ? { completion: { passed: true, issueIds: [] } } : {}),
      });
      if (!author) return;
      const awaiting = await workflows.get(workflowId);
      if (awaiting === null || awaiting.currentStageId === null) throw new Error(`author stage ${templateStageId} disappeared`);
      await service.command({
        type: 'workflow-confirm-stage', workflowId, stageId: awaiting.currentStageId,
        expectedVersion: awaiting.version, requestId: `${stageRunId}-confirm`, operationId: `${stageRunId}-confirm-op`,
      });
    };
    await advance('import-book', true);
    await advance('fact-backfill', false);
    await advance('initial-audit', false);
    const triage = await workflows.get(workflowId);
    if (triage === null || triage.currentStageId === null) throw new Error('overflow issue triage missing');
    await service.command({
      type: 'workflow-select-issue', workflowId, stageId: triage.currentStageId, issueId: issue.issueId,
      workflowRef: { workflowId, stageId: triage.currentStageId, issueId: issue.issueId },
      expectedVersion: triage.version, runId: `${workflowId}:selection`,
      requestId: `${workflowId}-select`, operationId: `${workflowId}-select-op`,
    });
    await advance('issue-triage', true);
    const locate = await workflows.get(workflowId);
    if (locate === null || locate.currentStageId === null) throw new Error('overflow locate-source stage missing');

    const runtime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => undefined,
      getFactStore: () => undefined,
      workflows, workflowIssues, stageRunEvidence: evidence, taskRuns,
      manuscript: {
        readChapterContent: async (id: string) => ({ nodeId: id, content: chapterContent }),
        writeBackRefactoredFragment: async () => ({ ok: false, reason: 'io-error' as const }),
      },
    });
    const wc = new FakeWebContents();
    await runtime.locateSource(wc.asWebContents(), randomUUID() as RunId, {
      workflowId, stageId: locate.currentStageId, issueId: issue.issueId,
    });
    const waitingActivity = wc.taskActivity.find(
      (event): event is Extract<BackendTaskActivityEvent, { type: 'task-activity' }> =>
        event.type === 'task-activity' && event.status === 'awaiting-author',
    );
    if (waitingActivity === undefined) throw new Error('overflow awaiting activity missing');
    const persistedRun = await taskRuns.get(waitingActivity.taskRunId);
    const persistedCandidates = await taskRuns.listPendingCandidates(waitingActivity.taskRunId);
    check('4.6 候选过多：真实 runtime 收敛 awaiting-author 且四候选全部持久化',
      persistedRun?.status === 'awaiting-author' && persistedCandidates.length === 4 &&
        waitingActivity.authorCandidates?.length === 4);
    check('4.6 候选过多：不自动选择、不推进阶段、不完成',
      (await workflows.get(workflowId))?.currentStageId === locate.currentStageId &&
        !wc.taskActivity.some((event) => event.type === 'task-run-completed'));
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 4.1 相关人物或事实底稿：locate-source 输入活动须从事实库召回证据/描述中提及的已知实体，
 * 作为「相关人物或事实底稿」输入（evidenceRefs kind='fact'），且底稿引用不泄露整章正文。
 */
async function smokeLocateSourceFactBacking(): Promise<void> {
  const quote = '他忽然丢下同伴独自离开。';
  // 多候选正文：两次 run 均停在 awaiting-author、不推进阶段，便于复用同一 locate-source 阶段。
  const chapterContent = `第一幕。${quote}随后众人追问。第二幕。${quote}此后再无人提起。`;
  const dir = await mkdtemp(join(tmpdir(), 'na-locate-backing-'));
  const opened = await openDatabase(join(dir, 'locate-backing.db'));
  if (!opened.ok) {
    check('locate backing SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const workflows = new WorkflowRepository(db);
    const workflowIssues = new WorkflowIssueRepository(db);
    const service = new WorkflowApplicationService(workflows, new CreativeAssetRepository(db), workflowIssues);
    const evidence = new SqliteStageRunEvidenceRecorder(db);
    const taskRuns = new TaskRunRepository(db);
    const factStore = new SqliteFactStore(db);
    const chapterId = asNodeId('backing-chapter');
    const workflowId = 'locate-backing';

    // 播种事实：顾长风为已知人物；诊断描述提及其名，应被召回为底稿。
    const version = await factStore.appendVersion();
    await factStore.putEntity(version, sampleEntity(), null);

    const started = await service.command({
      type: 'start-workflow', workflowId, projectId: `${workflowId}-project`, kind: 'legacy-book-revision',
      objective: '相关人物底稿', requestId: `${workflowId}-start`, operationId: `${workflowId}-start-op`,
    });
    if (started === null) throw new Error('backing workflow fixture failed');
    const [issue] = await workflowIssues.upsertFromAudit(workflowId, `${workflowId}-audit`, [{
      type: 'behavior-ooc', severity: 'warning', anchors: [{ id: chapterId, kind: 'chapter' }],
      description: '顾长风在此处的行为与既定性格不一致。', requiresHumanDecision: false, evidence: { quote },
    }]);
    if (issue === undefined) throw new Error('backing issue fixture failed');

    const advance = async (templateStageId: string, author: boolean): Promise<void> => {
      const current = await workflows.get(workflowId);
      if (current === null || current.currentStageId === null) throw new Error(`missing ${templateStageId}`);
      const stage = current.stages.find((candidate) => candidate.stageId === current.currentStageId);
      if (stage?.templateStageId !== templateStageId) throw new Error(`expected ${templateStageId}, got ${stage?.templateStageId}`);
      const stageRunId = `${workflowId}:${templateStageId}` as RunId;
      await service.command({
        type: 'workflow-start-stage', workflowId, stageId: current.currentStageId,
        expectedVersion: current.version, runId: stageRunId,
        requestId: `${stageRunId}-start`, operationId: `${stageRunId}-start-op`,
      });
      await evidence.record({ runId: stageRunId, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'started' });
      await evidence.record({
        runId: stageRunId, workflowRef: { workflowId, stageId: current.currentStageId }, status: 'completed',
        ...(stage?.actor === 'quality-gate' ? { completion: { passed: true, issueIds: [] } } : {}),
      });
      if (!author) return;
      const awaiting = await workflows.get(workflowId);
      if (awaiting === null || awaiting.currentStageId === null) throw new Error(`author stage ${templateStageId} disappeared`);
      await service.command({
        type: 'workflow-confirm-stage', workflowId, stageId: awaiting.currentStageId,
        expectedVersion: awaiting.version, requestId: `${stageRunId}-confirm`, operationId: `${stageRunId}-confirm-op`,
      });
    };
    await advance('import-book', true);
    await advance('fact-backfill', false);
    await advance('initial-audit', false);
    const triage = await workflows.get(workflowId);
    if (triage === null || triage.currentStageId === null) throw new Error('backing issue triage missing');
    await service.command({
      type: 'workflow-select-issue', workflowId, stageId: triage.currentStageId, issueId: issue.issueId,
      workflowRef: { workflowId, stageId: triage.currentStageId, issueId: issue.issueId },
      expectedVersion: triage.version, runId: `${workflowId}:selection`,
      requestId: `${workflowId}-select`, operationId: `${workflowId}-select-op`,
    });
    await advance('issue-triage', true);
    const locate = await workflows.get(workflowId);
    if (locate === null || locate.currentStageId === null) throw new Error('backing locate-source stage missing');

    const runtime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => undefined,
      getFactStore: () => factStore,
      workflows, workflowIssues, stageRunEvidence: evidence, taskRuns,
      manuscript: {
        readChapterContent: async (id: string) => ({ nodeId: id, content: chapterContent }),
        writeBackRefactoredFragment: async () => ({ ok: false, reason: 'io-error' as const }),
      },
    });
    const wc = new FakeWebContents();
    await runtime.locateSource(wc.asWebContents(), randomUUID() as RunId, {
      workflowId, stageId: locate.currentStageId, issueId: issue.issueId,
    });
    const inputActivity = wc.taskActivity.find(
      (event): event is Extract<BackendTaskActivityEvent, { type: 'task-activity' }> =>
        event.type === 'task-activity' && event.phase === 'input',
    );
    if (inputActivity === undefined) throw new Error('backing input activity missing');
    const factRefs = inputActivity.evidenceRefs?.filter((ref) => ref.kind === 'fact') ?? [];
    check('4.1 相关人物或事实底稿：召回证据/描述中提及的已知实体作为底稿输入',
      factRefs.length === 1 && factRefs[0]?.ref === 'ent-gu-changfeng' &&
        factRefs[0]?.label.includes('顾长风') &&
        (inputActivity.inputSummary?.includes('相关人物或事实底稿') ?? false));
    // 红线：底稿引用只带实体 id 与名，绝不把整章正文塞进消息流。
    check('4.1 底稿引用不泄露整章正文',
      !(inputActivity.inputSummary?.includes(chapterContent) ?? false) &&
        !factRefs.some((ref) => ref.ref.includes(chapterContent) || ref.label.includes(chapterContent)));

    // 无事实库时降级为不召回，仍照常展示基础输入（不因缺库报错）。
    const noStoreRuntime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => undefined,
      getFactStore: () => undefined,
      workflows, workflowIssues, stageRunEvidence: evidence, taskRuns,
      manuscript: {
        readChapterContent: async (id: string) => ({ nodeId: id, content: chapterContent }),
        writeBackRefactoredFragment: async () => ({ ok: false, reason: 'io-error' as const }),
      },
    });
    const wc2 = new FakeWebContents();
    await noStoreRuntime.locateSource(wc2.asWebContents(), randomUUID() as RunId, {
      workflowId, stageId: locate.currentStageId, issueId: issue.issueId,
    });
    const inputActivity2 = wc2.taskActivity.find(
      (event): event is Extract<BackendTaskActivityEvent, { type: 'task-activity' }> =>
        event.type === 'task-activity' && event.phase === 'input',
    );
    check('4.1 无事实库时降级不召回且不报错',
      inputActivity2 !== undefined &&
        (inputActivity2.evidenceRefs?.filter((ref) => ref.kind === 'fact').length ?? 0) === 0 &&
        inputActivity2.evidenceRefs?.some((ref) => ref.kind === 'issue') === true);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 3.4 冲烟：作者补充约束成为任务新输入并进入活动流。
 * 覆盖：① 下发 phase:'input' 且 title==='作者补充约束'、inputSummary 含约束文本；
 * ② inputs.authorSupplements 追加该项（只追加、不改既有输入）；③ 同 operationId 幂等；④ 终态拒绝。
 */
async function smokeSupplementTaskInput(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'na-supplement-'));
  const opened = await openDatabase(join(dir, 'supplement.db'));
  if (!opened.ok) {
    check('supplement SQLite 可用', false, opened.message);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  const db = opened.db;
  try {
    const taskRuns = new TaskRunRepository(db);
    const runtime = new OrchestrationRuntime({
      getModelResolver: () => undefined,
      getCheckpointer: () => undefined,
      getFactStore: () => undefined,
      taskRuns,
    });

    // 非终态（queued）任务：可接受补充。
    const run = createTaskRunFromPlaybook(TEMPORARY_EDITORIAL_PLAYBOOK, {
      id: 'task-supplement-1',
      executionRunId: 'run-supplement-1',
      inputs: { text: '一段独立文本', editorialBrief: '润色语气' },
      now: '2026-01-01T00:00:00.000Z',
    });
    await taskRuns.create(run);

    const wc = new FakeWebContents();
    const constraint = '主角这一段要保持克制，不要煽情';
    const opId = `supplement:${run.id}:1`;
    await runtime.supplementTaskInput(wc.asWebContents(), run.id, constraint, opId);

    const inputEvent = wc.taskActivity.find(
      (event): event is Extract<BackendTaskActivityEvent, { type: 'task-activity' }> =>
        event.type === 'task-activity' && event.phase === 'input',
    );
    check('3.4 补充约束下发 input 活动',
      inputEvent !== undefined &&
        inputEvent.title === '作者补充约束' &&
        inputEvent.inputSummary === constraint &&
        inputEvent.kind === 'temporary-task');

    const afterFirst = await taskRuns.get(run.id);
    const supplementsAfterFirst = Array.isArray(afterFirst?.inputs['authorSupplements'])
      ? (afterFirst?.inputs['authorSupplements'] as ReadonlyArray<unknown>)
      : [];
    const firstSupplement = supplementsAfterFirst[0] as { text?: string } | undefined;
    check('3.4 补充约束追加到 authorSupplements 且不改既有输入',
      supplementsAfterFirst.length === 1 &&
        firstSupplement?.text === constraint &&
        afterFirst?.inputs['text'] === '一段独立文本' &&
        afterFirst?.inputs['editorialBrief'] === '润色语气');

    // 重复同一 operationId：幂等（不重复下发、不重复追加）。
    const wc2 = new FakeWebContents();
    await runtime.supplementTaskInput(wc2.asWebContents(), run.id, constraint, opId);
    const afterDup = await taskRuns.get(run.id);
    const supplementsAfterDup = Array.isArray(afterDup?.inputs['authorSupplements'])
      ? (afterDup?.inputs['authorSupplements'] as ReadonlyArray<unknown>)
      : [];
    check('3.4 同 operationId 重复补充幂等',
      supplementsAfterDup.length === 1 &&
        !wc2.taskActivity.some((event) => event.type === 'task-activity' && event.phase === 'input'));

    // 不同 operationId：可再次追加（只追加、历史保留）。
    const wc3 = new FakeWebContents();
    await runtime.supplementTaskInput(wc3.asWebContents(), run.id, '另一条：保持第三人称叙述', `supplement:${run.id}:2`);
    const afterSecond = await taskRuns.get(run.id);
    const supplementsAfterSecond = Array.isArray(afterSecond?.inputs['authorSupplements'])
      ? (afterSecond?.inputs['authorSupplements'] as ReadonlyArray<unknown>)
      : [];
    check('3.4 不同 operationId 可多次追加且保留历史', supplementsAfterSecond.length === 2);

    // 终态任务（completed）：拒绝补充。
    const completedRun: TaskRun = { ...run, id: 'task-supplement-done', status: 'completed' };
    await taskRuns.create(completedRun);
    let rejected = false;
    try {
      await runtime.supplementTaskInput(new FakeWebContents().asWebContents(), completedRun.id, constraint, `supplement:${completedRun.id}:1`);
    } catch {
      rejected = true;
    }
    check('3.4 终态任务拒绝补充', rejected);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log('=== orchestration-runtime 冲烟 ===');
  smokeReviewerJsonDefence();
  smokeTargetedVerificationRouting();
  smokeVisualDesignContracts();
  smokeToolboxCatalogContracts();
  smokeTaskPlaybookFixtures();
  smokeNewBookPlanningPlaybooks();
  await smokeSummonResumeTimeTravel();
  await smokeInstructionConflictOverride();
  await smokeNoFactStoreHappyPath();
  await smokeWorkflowReviewerIssuePersistence();
  await smokeLocateSourceTask();
  await smokeLocateSourceEndToEnd();
  await smokeLocateSourceFactBacking();
  await smokeRefactorLoopBoundaries();
  await smokeLocateCandidateOverflow();
  await smokeGenericPlaybookTask();
  await smokeSupplementTaskInput();
  await smokeNewBookWritingPlaybooks();
  await smokeNewBookMainPathEndToEnd();
  await smokePlaybookExtensionNoRegression();
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
