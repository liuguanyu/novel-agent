/**
 * LangGraph 有状态编排图 (orchestration-runtime tasks 2.1–2.7, 4.1, 4.4)
 *
 * spec: orchestration-graph / orchestration-runtime——单一有状态 StateGraph：
 *  supervisor 入口按 currentAction 数据驱动路由 → writer/reviewer 专家节点 → 写-审-改条件循环；
 *  reviewer 产出 ConsistencyIssue[]，需人工裁决时经 awaitDecision 节点条件性 interrupt() 挂起；
 *  作者 approve/reject/modify/correct 决策以 Command({resume}) 从挂起点续跑，MUST NOT 重跑已完成节点。
 *
 * Checkpointer 采用 design D3.5 方案 A「两个时间尺度」：
 *  - 运行态（挂起/续跑机械）：LangGraph MemorySaver（内存、零 native），interrupt/resume 靠它。
 *  - 里程碑态（作者可见 time-travel、fact-version 锚）：经注入的 recordMilestone 提交进 I2 SqliteCheckpointer。
 * 节点边界完成时才 recordMilestone；中途 abort 抛错在提交前，故 MUST NOT 落里程碑（干净态由此自然保证）。
 *
 * 职责边界（agent-node-contract / design D2）：节点只「组 prompt→调模型→解析校验→写状态」，
 * 不直接发 IPC/持久化/碰 UI——流式回推与里程碑提交经 config.configurable 注入的抽象回调完成，
 * 由 Main 运行层实现那些回调（图不知道 IPC 消息形状，也不 import electron/db）。
 */

import {
  Annotation,
  Command,
  END,
  interrupt,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { CapabilityTier, ChatMessage } from '../../core/model/index.js';
import type { ConsistencyIssue } from '../../core/story-bible/index.js';
import type { NovelState } from '../../core/orchestration/index.js';
import {
  appendDialogue,
  overwriteActiveBugs,
  routeByAction,
  shouldStopReviewLoop,
  type DialogueMessage,
  type NodeName,
} from '../../core/orchestration/index.js';
import type { ResumeDecision } from '../../shared/ipc/index.js';
import { NovelStateAnnotation, toNovelState } from './state-bridge.js';
import { parseReviewerIssuesWithDiagnostics, validateConsistencyIssues } from './consistency-schema.js';
import { renderAssembledContext, type AssembledContext } from './context-assembler.js';
import {
  getWriterPrompt,
  getReviewerPrompt,
  getFactCheckerPrompt,
  getSceneGeneratorPrompt,
  getPlagiarismCheckerPrompt,
  getEditorPrompt,
  getStyleEditorPrompt,
  getArchitectPrompt,
  getCharacterGeneratorPrompt,
  getWorldbuildingPrompt,
  getConceptGeneratorPrompt,
  getSceneOutlinerPrompt,
  getResearcherPrompt,
} from './prompt-registry.js';

/** writer 输出预算。 */
const DEFAULT_MAX_TOKENS = 2048;
/** reviewer 会先烧 reasoning token，再输出结构化 JSON；预算太小会出现“thinking 找到问题但 final=[]/截断”。 */
const REVIEWER_MAX_TOKENS = 4096;
/** 写-审-改循环最大轮次，防死循环（对齐 graph-topology ReviewLoopControl）。 */
const MAX_REVIEW_ITERATIONS = 3;

/** 图当前落地的专家节点集合；supervisor 路由到集合外动作时安全收敛 END（task 2.6 可扩展）。 */
const BUILT_NODES: ReadonlySet<NodeName> = new Set<NodeName>([
  'writer',
  'reviewer',
  'fact-checker',
  'scene-generator',
  'plagiarism-checker',
  'editor',
  'style-editor',
  'architect',
  'character-generator',
  'worldbuilding',
  'concept-generator',
  'scene-outliner',
  'researcher',
]);

/**
 * 图状态 = core NovelState 全字段（经 state-bridge 桥接）+ 一个图内部的 reviewIteration 计数。
 * reviewIteration 是编排循环的图内私有控制量（防死循环），不属于作者可见的 NovelState 里程碑，
 * 故不进 state-bridge 的 NovelState 镜像、不落 SqliteCheckpointer 快照——只随 MemorySaver 运行态存在。
 */
const GraphAnnotation = Annotation.Root({
  ...NovelStateAnnotation.spec,
  reviewIteration: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  // 事实库硬检查（章号纠偏 / 指令冲突）只解读作者的**原始请求**，语义上每次运行只需一次。
  // 若每轮审校都重跑，会在作者选 correct（清 activeBugs 回 writer→reviewer）后再次产出同一纠偏问题，
  // 使 awaitDecision 无限循环、逼作者反复回答同一问话。故用图内私有 flag 保证只查一次（与 reviewIteration 同性质）。
  factsChecked: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
});

type GraphState = typeof GraphAnnotation.State;
/** 节点部分更新：core 字段更新 + 可选 reviewIteration。禁 any。 */
type GraphUpdate = Partial<NovelState> & { reviewIteration?: number; factsChecked?: boolean };

/**
 * 一次运行注入图的抽象依赖（经 config.configurable 传入，per-run 不同）。
 * 图/节点只依赖这些抽象回调，不 import electron/db/ipc——满足进程与职责边界。
 */
export interface GraphRunDeps {
  /** 创建模型适配器（按 agent+档位解析），reasoning 旁路经 onReasoning 注入。 */
  readonly createAdapter: (
    agentId: string,
    tier: CapabilityTier,
    options: { onReasoning?: (delta: string) => void },
  ) => {
    stream(input: {
      messages: readonly ChatMessage[];
      options?: { signal?: AbortSignal; maxTokens?: number };
    }): AsyncIterable<string>;
  };
  /** 对话流式分片回推（writer/reviewer 产出经此回推 Renderer；图不碰 IPC 形状）。 */
  readonly emitDialogue: (delta: string) => void;
  /** reasoning 旁路分片回推（可折叠展示）。 */
  readonly emitReasoning: (delta: string) => void;
  /** 运行时本地日志（调试 parser/model 输出用；图不直接碰 fs/console）。 */
  readonly log?: (message: string) => void;
  /** 本次运行的中断信号（abort 拉手刹）。 */
  readonly signal: AbortSignal;
  /** writer 产出新草稿后的可选后置步骤（如自动事实抽取）；由运行层决定是否接线。 */
  readonly afterWriterDraft?: (state: NovelState) => Promise<void>;
  /**
   * 按 agent + 当前状态装配上下文（正文范围 + 事实结构化召回引用 + 近期对话）。
   * 由 Main 运行层绑定事实库实现（图不 import db）；未接事实库时返回 null（happy path 仍可跑）。
   * 统一组装器依各 agent 声明的策略执行，节点只声明自己是谁、不硬编码组装分支（task 6.3）。
   */
  readonly assembleContext?: (
    agentId: string,
    state: NovelState,
  ) => Promise<AssembledContext | null>;
  /**
   * 基于事实库的连续性核对（章号纠偏 + 指令冲突硬阻断），产出需裁决的 ConsistencyIssue[]。
   * 由 Main 运行层绑定事实库实现；未接事实库时返回空。reviewer 节点把其与模型审校结果合并（section 7）。
   */
  readonly checkFacts?: (
    agentId: string,
    state: NovelState,
  ) => Promise<ReadonlyArray<ConsistencyIssue>>;
  /**
   * 节点边界里程碑提交（→ I2 SqliteCheckpointer）。
   * 由 Main 运行层实现：内部维护 parent 链，提交后更新「上一个 checkpoint」游标。
   * 中途 abort 时节点在此调用前已抛错，故不会落里程碑（干净态保证）。
   */
  readonly recordMilestone: (atNode: string, state: NovelState) => Promise<void>;
  /** Workflow-aware resume route; absent preserves standalone writer behavior. */
  readonly continuationTarget?: () => string | undefined;
}

/** configurable 载荷：thread_id（LangGraph 运行态 checkpoint 键）+ 本运行依赖。 */
interface GraphConfigurable extends Record<string, unknown> {
  thread_id?: string;
  deps?: GraphRunDeps;
}

type GraphConfig = LangGraphRunnableConfig<GraphConfigurable>;

/** 从 config 取回本次运行依赖；缺失即编排装配错误（非作者可恢复），直接抛。 */
function depsFrom(config: GraphConfig): GraphRunDeps {
  const deps = config.configurable?.deps;
  if (deps === undefined) {
    throw new Error('编排图缺少注入依赖（configurable.deps）：装配错误');
  }
  return deps;
}

/** 把 core 部分更新按 reducer 语义合并进当前态，得到该节点边界的完整 NovelState 快照（供里程碑提交）。 */
function mergeState(prev: GraphState, update: Partial<NovelState>): NovelState {
  const base = toNovelState(prev);
  return {
    currentChapterId: update.currentChapterId ?? base.currentChapterId,
    currentDraft: update.currentDraft ?? base.currentDraft,
    chatHistory:
      update.chatHistory !== undefined
        ? appendDialogue(base.chatHistory, update.chatHistory)
        : base.chatHistory,
    activeBugs:
      update.activeBugs !== undefined
        ? overwriteActiveBugs(base.activeBugs, update.activeBugs)
        : base.activeBugs,
    currentAction: update.currentAction ?? base.currentAction,
    agentStatus: update.agentStatus ?? base.agentStatus,
    contextRefs: update.contextRefs ?? base.contextRefs,
  };
}

/** 把 core DialogueMessage[] 投影为模型 ChatMessage[]（丢弃 author 元信息）。 */
function toChatMessages(history: ReadonlyArray<DialogueMessage>): ChatMessage[] {
  return history.map((m) => ({ role: m.role, content: m.content }));
}

/** 组装 writer 提示：系统词 + 事实召回块（可选）+ 对话历史（含作者指令）+ 现有草稿。纯组装，无 I/O。 */
function buildWriterMessages(state: GraphState, contextBlock: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: getWriterPrompt().template }];
  if (contextBlock.length > 0) {
    messages.push({ role: 'system', content: contextBlock });
  }
  if (state.currentDraft.length > 0) {
    messages.push({ role: 'assistant', content: `【现有草稿】\n${state.currentDraft}` });
  }
  messages.push(...toChatMessages(state.chatHistory));
  return messages;
}

/** 组装 reviewer 提示：系统词 + 事实召回块（可选）+ 对话历史 + 待审草稿。 */
function buildReviewerMessages(state: GraphState, contextBlock: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: getReviewerPrompt().template }];
  if (contextBlock.length > 0) {
    messages.push({ role: 'system', content: contextBlock });
  }
  messages.push(...toChatMessages(state.chatHistory));
  if (state.currentDraft.length > 0) {
    messages.push({ role: 'user', content: `【待审正文】\n${state.currentDraft}` });
  }
  return messages;
}

/** 组装 fact-checker 提示：系统词用专用事实核查官词（外置注册表），其余与 reviewer 同构。 */
function buildFactCheckerMessages(state: GraphState, contextBlock: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: getFactCheckerPrompt().template }];
  if (contextBlock.length > 0) {
    messages.push({ role: 'system', content: contextBlock });
  }
  messages.push(...toChatMessages(state.chatHistory));
  if (state.currentDraft.length > 0) {
    messages.push({ role: 'user', content: `【待核查正文】\n${state.currentDraft}` });
  }
  return messages;
}

/** 组装 scene-generator 提示：与 writer 同构，用分场景写手系统词。 */
function buildSceneGeneratorMessages(state: GraphState, contextBlock: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: getSceneGeneratorPrompt().template }];
  if (contextBlock.length > 0) {
    messages.push({ role: 'system', content: contextBlock });
  }
  if (state.currentDraft.length > 0) {
    messages.push({ role: 'assistant', content: `【现有草稿】\n${state.currentDraft}` });
  }
  messages.push(...toChatMessages(state.chatHistory));
  return messages;
}

/** 组装 plagiarism-checker 提示：与 fact-checker 同构，用原创性核查官系统词。 */
function buildPlagiarismCheckerMessages(state: GraphState, contextBlock: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: getPlagiarismCheckerPrompt().template }];
  if (contextBlock.length > 0) {
    messages.push({ role: 'system', content: contextBlock });
  }
  messages.push(...toChatMessages(state.chatHistory));
  return messages;
}

/**
 * 组装重构类（editor / style-editor）提示：系统词 + 上下文块 + 近期对话（含 reviewer 反馈）+ 待修片段。
 * 重构类只见「待修片段」（此处以 currentDraft 承载作者交来的片段），产出对该片段的改写建议。
 */
function buildRefactorMessages(
  systemPrompt: string,
  state: GraphState,
  contextBlock: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  if (contextBlock.length > 0) {
    messages.push({ role: 'system', content: contextBlock });
  }
  messages.push(...toChatMessages(state.chatHistory));
  if (state.currentDraft.length > 0) {
    messages.push({ role: 'user', content: `【待修片段】\n${state.currentDraft}` });
  }
  return messages;
}

/**
 * 策划类节点（architect/character-generator/worldbuilding）的消息装配。
 * 系统提示 + 上下文块 + 近期对话 + 可选现有草稿（供在既有策划基础上迸发/细化）。
 */
function buildPlanningMessages(
  systemPrompt: string,
  state: GraphState,
  contextBlock: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  if (contextBlock.length > 0) {
    messages.push({ role: 'system', content: contextBlock });
  }
  if (state.currentDraft.length > 0) {
    messages.push({ role: 'assistant', content: `【现有策划】\n${state.currentDraft}` });
  }
  messages.push(...toChatMessages(state.chatHistory));
  return messages;
}

/**
 * 按 agent 声明装配上下文并渲染为提示块（section 6）。
 * deps.assembleContext 未注入（无事实库）时返回空块与空 contextRefs，happy path 不受影响。
 */
async function assembleContextBlock(
  agentId: string,
  state: GraphState,
  deps: GraphRunDeps,
): Promise<{ block: string; contextRefs?: NovelState['contextRefs'] }> {
  if (deps.assembleContext === undefined) return { block: '' };
  const assembled = await deps.assembleContext(agentId, toNovelState(state));
  if (assembled === null) return { block: '' };
  return { block: renderAssembledContext(assembled), contextRefs: assembled.contextRefs };
}

/** 消费一个适配器流并累积全文，逐片经 emit 回推。 */
async function streamToText(
  iterable: AsyncIterable<string>,
  emit: (delta: string) => void,
): Promise<string> {
  let full = '';
  for await (const delta of iterable) {
    full += delta;
    emit(delta);
  }
  return full;
}

/** 把结构化审校结果渲染为作者可读的对话摘要；原始 JSON 只作内部解析，不直接打印给作者。 */
function normalizeModelIssueAnchors(
  issues: ReadonlyArray<ConsistencyIssue>,
  state: GraphState,
): ReadonlyArray<ConsistencyIssue> {
  const current = state.currentChapterId;
  if (current === null) return issues;
  return issues.map((issue) => ({
    ...issue,
    // 模型常会编出 chapter-4/ch4/unknown 这类“看起来对”的 id；后续修改必须用 manifest 稳定 id。
    // 当前 reviewer 输入来自选中章节时，以运行态 currentChapterId 作为 canonical chapter anchor。
    anchors: issue.anchors.map((anchor) =>
      anchor.kind === 'chapter' ? current : anchor,
    ),
  }));
}

function renderReviewDialogue(issues: ReadonlyArray<ConsistencyIssue>): string {
  if (issues.length === 0) {
    return '审校完成：未发现明确的连续性问题。';
  }
  const severityLabel: Record<'critical' | 'warning' | 'info', string> = {
    critical: '严重',
    warning: '警告',
    info: '提示',
  };
  const lines = issues.map((issue, idx) => {
    const anchors = issue.anchors
      .map((a) => `${a.kind}:${a.id as string}`)
      .filter((anchor) => anchor !== 'chapter:unknown')
      .join('、');
    const anchorLine = anchors.length > 0 ? `\n   锚点：${anchors}` : '';
    const evidence = issue.evidence?.quote !== undefined ? `\n   原文：${issue.evidence.quote}` : '';
    const decision = issue.requiresHumanDecision ? '（需要你裁决）' : '';
    const fix = issue.suggestedFix !== undefined ? `\n   建议：${issue.suggestedFix}` : '';
    return `${idx + 1}. [${severityLabel[issue.severity]}] ${issue.description}${decision}${anchorLine}${evidence}${fix}`;
  });
  return `审校完成：发现 ${issues.length} 个问题。\n${lines.join('\n')}`;
}

/**
 * 审校对话流摘要（短行）：结构化详情交右侧卡片承载（review-completed 事件），
 * 对话气泡只回推一行摘要以免长文本转储。完整文本仍进 chatHistory（供后续轮模型上下文）。
 */
function renderReviewSummary(issues: ReadonlyArray<ConsistencyIssue>): string {
  if (issues.length === 0) {
    return '审校完成：未发现明确的连续性问题。';
  }
  return `审校完成：发现 ${issues.length} 个问题（详见右侧审校卡片，点击可定位原文）。`;
}

/**
 * writer 节点：组 prompt→调 prose 档模型→流式回推→写 currentDraft（task 2.3）。
 * 产出一条 assistant 对话消息累加进 chatHistory，并把 reviewIteration +1（循环计数）。
 * 先按 writer 策略装配上下文（事实召回 + 近期对话），把召回块注入 prompt（section 6）。
 */
async function writerNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  const deps = depsFrom(config);
  const { block, contextRefs } = await assembleContextBlock('writer', state, deps);
  const adapter = deps.createAdapter('writer', 'prose' satisfies CapabilityTier, {
    onReasoning: deps.emitReasoning,
  });
  const iterable = adapter.stream({
    messages: buildWriterMessages(state, block),
    options: { signal: deps.signal, maxTokens: DEFAULT_MAX_TOKENS },
  });
  const draft = await streamToText(iterable, deps.emitDialogue);

  const coreUpdate: Partial<NovelState> = {
    currentDraft: draft,
    chatHistory: [{ role: 'assistant', content: draft, author: 'writer' }],
    agentStatus: 'idle',
    currentAction: 'review',
    ...(contextRefs !== undefined ? { contextRefs } : {}),
  };
  const nextState = mergeState(state, coreUpdate);
  await deps.recordMilestone('writer', nextState);
  await deps.afterWriterDraft?.(nextState);
  return { ...coreUpdate, reviewIteration: state.reviewIteration + 1 };
}

/**
 * reviewer 节点：审校产 ConsistencyIssue[] 写 activeBugs（task 2.4）。
 * 模型自由文本经 consistency-schema 校验点转强类型，禁未校验 any 穿透。
 * 先按 reviewer 策略装配上下文（section 6）；再叠加事实库硬检查（章号纠偏 / 指令冲突，section 7）——
 * 硬检查基于结构化事实（确定性）比模型自由文本更可靠，二者合并进 activeBugs。
 * 本节点**不** interrupt——把「是否需人工」的挂起决策留给轻量 awaitDecision 节点，
 * 使 resume 时只重跑那个便宜节点、不重跑本节点的模型调用（task 4.4「不重跑」）。
 */
async function reviewerNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  const deps = depsFrom(config);
  const { block, contextRefs } = await assembleContextBlock('reviewer', state, deps);
  const reasoningParts: string[] = [];
  const adapter = deps.createAdapter('reviewer', 'reasoning' satisfies CapabilityTier, {
    onReasoning: (delta: string) => {
      reasoningParts.push(delta);
      deps.emitReasoning(delta);
    },
  });
  const iterable = adapter.stream({
    messages: buildReviewerMessages(state, block),
    options: { signal: deps.signal, maxTokens: REVIEWER_MAX_TOKENS },
  });
  // reviewer 模型输出 JSON 作为机器可读中间结果进入状态，不直接流给作者；否则 UI 会打印裸 JSON。
  const text = await streamToText(iterable, () => undefined);
  const reasoningText = reasoningParts.join('');
  deps.log?.(
    `[reviewer] finalChars=${text.length} reasoningChars=${reasoningText.length} finalPreview=${JSON.stringify(
      text.slice(0, 200),
    )} reasoningPreview=${JSON.stringify(reasoningText.slice(0, 300))}`,
  );
  // 部分推理模型会把真正的问题列在 reasoning_content，final 却因预算/格式漂移给 []。
  // final 严格 JSON 优先；无有效问题时再解析 reasoning 兜底，避免误判“未发现问题”。
  const parsedReview = parseReviewerIssuesWithDiagnostics(text, reasoningText);
  const modelIssues = normalizeModelIssueAnchors(parsedReview.issues, state);
  deps.log?.(
    `[reviewer] parsedModelIssues=${modelIssues.length} parseSource=${parsedReview.diagnostics.source} ` +
      `finalObjectCandidates=${parsedReview.diagnostics.finalObjectCandidates} ` +
      `finalIssues=${parsedReview.diagnostics.finalIssues} ` +
      `reasoningIssues=${parsedReview.diagnostics.reasoningIssues}`,
  );

  // section 7：事实库硬检查（章号纠偏 / 指令冲突）产出的需裁决问题，与模型审校合并。
  // 硬检查排前（结构化、确定性），确保 routeAfterReview 能据 requiresHumanDecision 挂起。
  // 仅首轮审校跑（factsChecked=false）：硬检查解读作者的原始请求，属一次性判定。
  // 若每轮重跑，作者选 correct（清 activeBugs 回 writer→reviewer）后会再次产出同一纠偏问题，
  // 使 awaitDecision 无限循环、逼作者反复回答同一问话。故用图内私有 flag 保证只查一次。
  const factIssues =
    !state.factsChecked && deps.checkFacts !== undefined
      ? await deps.checkFacts('reviewer', toNovelState(state))
      : [];
  const issues: ReadonlyArray<ConsistencyIssue> = [...factIssues, ...modelIssues];
  const reviewDialogue = renderReviewDialogue(issues);

  const coreUpdate: Partial<NovelState> = {
    activeBugs: issues,
    chatHistory: [{ role: 'assistant', content: reviewDialogue, author: 'reviewer' }],
    agentStatus: 'idle',
    currentAction: 'idle',
    ...(contextRefs !== undefined ? { contextRefs } : {}),
  };
  deps.emitDialogue(renderReviewSummary(issues));
  await deps.recordMilestone('reviewer', mergeState(state, coreUpdate));
  // 标记事实硬检查已跑过（图内私有 flag），后续审校循环不再重复产同一纠偏/冲突问题。
  return { ...coreUpdate, factsChecked: true };
}

/**
 * fact-checker 节点（I9 阶段 A）：作者按需召唤、对已有正文做事实/逻辑/世界一致性核查的**诊断态**节点。
 * 与 reviewer 同构（同产 ConsistencyIssue[]、同走 consistency-schema 校验、同由 routeAfterReview 路由），
 * 差异：用 fact-checker 提示词与 agent 标识，专于对撞事实库；不在写-审-改环内，只诊断不改写。
 * 同 reviewer：本节点**不** interrupt，把是否需人工的挂起决策留给 awaitDecision（resume 不重贑模型调用）。
 */
async function factCheckerNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  const deps = depsFrom(config);
  const { block, contextRefs } = await assembleContextBlock('fact-checker', state, deps);
  const reasoningParts: string[] = [];
  const adapter = deps.createAdapter('fact-checker', 'reasoning' satisfies CapabilityTier, {
    onReasoning: (delta: string) => {
      reasoningParts.push(delta);
      deps.emitReasoning(delta);
    },
  });
  const iterable = adapter.stream({
    messages: buildFactCheckerMessages(state, block),
    options: { signal: deps.signal, maxTokens: getFactCheckerPrompt().settings.maxTokens ?? REVIEWER_MAX_TOKENS },
  });
  // 同 reviewer：JSON 中间结果不直推给作者（否则 UI 打印裸 JSON）。
  const text = await streamToText(iterable, () => undefined);
  const reasoningText = reasoningParts.join('');
  deps.log?.(
    `[fact-checker] finalChars=${text.length} reasoningChars=${reasoningText.length} finalPreview=${JSON.stringify(
      text.slice(0, 200),
    )}`,
  );
  const parsedReview = parseReviewerIssuesWithDiagnostics(text, reasoningText);
  const modelIssues = normalizeModelIssueAnchors(parsedReview.issues, state);

  // 与 reviewer 一样叠加事实库硬检查（章号纠偏 / 指令冲突），只首轮跑（factsChecked=false）。
  const factIssues =
    !state.factsChecked && deps.checkFacts !== undefined
      ? await deps.checkFacts('fact-checker', toNovelState(state))
      : [];
  const issues: ReadonlyArray<ConsistencyIssue> = [...factIssues, ...modelIssues];
  const reviewDialogue = renderReviewDialogue(issues);

  const coreUpdate: Partial<NovelState> = {
    activeBugs: issues,
    chatHistory: [{ role: 'assistant', content: reviewDialogue, author: 'fact-checker' }],
    agentStatus: 'idle',
    currentAction: 'idle',
    ...(contextRefs !== undefined ? { contextRefs } : {}),
  };
  deps.emitDialogue(renderReviewSummary(issues));
  await deps.recordMilestone('fact-checker', mergeState(state, coreUpdate));
  return { ...coreUpdate, factsChecked: true };
}

/**
 * scene-generator 节点（I9 子阶段 C）：写作类，与 writer 同构。
 * 差异：用 scene-generator 提示词与 agent 标识，面向分场景生成；同样产 currentDraft、转入 review、进写-审-改环。
 */
async function sceneGeneratorNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  const deps = depsFrom(config);
  const { block, contextRefs } = await assembleContextBlock('scene-generator', state, deps);
  const adapter = deps.createAdapter('scene-generator', 'prose' satisfies CapabilityTier, {
    onReasoning: deps.emitReasoning,
  });
  const iterable = adapter.stream({
    messages: buildSceneGeneratorMessages(state, block),
    options: {
      signal: deps.signal,
      maxTokens: getSceneGeneratorPrompt().settings.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
  });
  const draft = await streamToText(iterable, deps.emitDialogue);

  const coreUpdate: Partial<NovelState> = {
    currentDraft: draft,
    chatHistory: [{ role: 'assistant', content: draft, author: 'scene-generator' }],
    agentStatus: 'idle',
    currentAction: 'review',
    ...(contextRefs !== undefined ? { contextRefs } : {}),
  };
  const nextState = mergeState(state, coreUpdate);
  await deps.recordMilestone('scene-generator', nextState);
  await deps.afterWriterDraft?.(nextState);
  return { ...coreUpdate, reviewIteration: state.reviewIteration + 1 };
}

/**
 * plagiarism-checker 节点（I9 子阶段 C）：审校类诊断态，与 fact-checker 同构。
 * 差异：评估原创性/雷同风险，**不**叠事实库硬检查（与事实库无关）；同产 ConsistencyIssue[]、同由 routeAfterReview 路由。
 * 同 reviewer/fact-checker：本节点**不** interrupt，把是否需人工的挂起决策留给 awaitDecision。
 */
async function plagiarismCheckerNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  const deps = depsFrom(config);
  const { block, contextRefs } = await assembleContextBlock('plagiarism-checker', state, deps);
  const reasoningParts: string[] = [];
  const adapter = deps.createAdapter('plagiarism-checker', 'reasoning' satisfies CapabilityTier, {
    onReasoning: (delta: string) => {
      reasoningParts.push(delta);
      deps.emitReasoning(delta);
    },
  });
  const iterable = adapter.stream({
    messages: buildPlagiarismCheckerMessages(state, block),
    options: {
      signal: deps.signal,
      maxTokens: getPlagiarismCheckerPrompt().settings.maxTokens ?? REVIEWER_MAX_TOKENS,
    },
  });
  // 同 reviewer：JSON 中间结果不直推给作者（否则 UI 打印裸 JSON）。
  const text = await streamToText(iterable, () => undefined);
  const reasoningText = reasoningParts.join('');
  deps.log?.(
    `[plagiarism-checker] finalChars=${text.length} reasoningChars=${reasoningText.length}`,
  );
  const parsedReview = parseReviewerIssuesWithDiagnostics(text, reasoningText);
  const issues = normalizeModelIssueAnchors(parsedReview.issues, state);
  const reviewDialogue = renderReviewDialogue(issues);

  const coreUpdate: Partial<NovelState> = {
    activeBugs: issues,
    chatHistory: [{ role: 'assistant', content: reviewDialogue, author: 'plagiarism-checker' }],
    agentStatus: 'idle',
    currentAction: 'idle',
    ...(contextRefs !== undefined ? { contextRefs } : {}),
  };
  deps.emitDialogue(renderReviewSummary(issues));
  await deps.recordMilestone('plagiarism-checker', mergeState(state, coreUpdate));
  // 不叠事实硬检查，但仍置 factsChecked 防循环一致性（与 fact-checker 同语义）。
  return { ...coreUpdate, factsChecked: true };
}

/**
 * editor 节点（I9 子阶段 D）：重构类。组片段上下文 → 调 editor 提示词 → 产出对待修片段的**改写建议**。
 * 核心不变量（hunk-review「绝不整章覆盖」）：本节点 MUST NOT 写回 currentDraft。改写作为对话消息（author=editor）
 * 呈现给作者；真正的“改写→局部 diff→逐 hunk 拼回落库”由 I6 refactor-worker-runtime 提供。完成后直达 END，不进写-审-改环。
 */
async function editorNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  return runRefactorNode('editor', getEditorPrompt(), state, config);
}

/**
 * style-editor 节点（I9 子阶段 D）：重构类，与 editor 同构，差异仅提示词与策略（只打磨文风）。
 * 同样 MUST NOT 写回 currentDraft、不整章覆盖、直达 END。
 */
async function styleEditorNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  return runRefactorNode('style-editor', getStyleEditorPrompt(), state, config);
}

/**
 * 重构类节点共用实现（editor / style-editor）。
 * 组片段级只读上下文 → 流式调模型产出改写建议 → 作为对话呈现；不写 currentDraft（不整章覆盖）、currentAction→idle、直达 END。
 */
async function runRefactorNode(
  agentId: 'editor' | 'style-editor',
  prompt: { template: string; settings: { maxTokens?: number } },
  state: GraphState,
  config: GraphConfig,
): Promise<GraphUpdate> {
  const deps = depsFrom(config);
  const { block, contextRefs } = await assembleContextBlock(agentId, state, deps);
  const adapter = deps.createAdapter(agentId, 'prose' satisfies CapabilityTier, {
    onReasoning: deps.emitReasoning,
  });
  const iterable = adapter.stream({
    messages: buildRefactorMessages(prompt.template, state, block),
    options: {
      signal: deps.signal,
      maxTokens: prompt.settings.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
  });
  const suggestion = await streamToText(iterable, deps.emitDialogue);

  // 重构类核心不变量：MUST NOT 写 currentDraft（避免整章覆盖）。改写仅作为建议进入对话；
  // 真正的 diff/逐 hunk 拼回落库由 I6 通道接入。
  const coreUpdate: Partial<NovelState> = {
    chatHistory: [{ role: 'assistant', content: suggestion, author: agentId }],
    agentStatus: 'idle',
    currentAction: 'idle',
    ...(contextRefs !== undefined ? { contextRefs } : {}),
  };
  await deps.recordMilestone(agentId, mergeState(state, coreUpdate));
  return coreUpdate;
}

/**
 * architect 节点（I9 子阶段 E）：策划类写作节点。
 */
async function architectNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  return runPlanningNode('architect', getArchitectPrompt(), state, config);
}

/**
 * character-generator 节点（I9 子阶段 E）：策划类写作节点。
 */
async function characterGeneratorNode(
  state: GraphState,
  config: GraphConfig,
): Promise<GraphUpdate> {
  return runPlanningNode('character-generator', getCharacterGeneratorPrompt(), state, config);
}

/**
 * worldbuilding 节点（I9 子阶段 E）：策划类写作节点。
 */
async function worldbuildingNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  return runPlanningNode('worldbuilding', getWorldbuildingPrompt(), state, config);
}

/**
 * concept-generator 节点（策划类）：立意策划师。
 */
async function conceptGeneratorNode(
  state: GraphState,
  config: GraphConfig,
): Promise<GraphUpdate> {
  return runPlanningNode('concept-generator', getConceptGeneratorPrompt(), state, config);
}

/**
 * scene-outliner 节点（策划类）：分场大纲师（章内分场，requiresAnchor）。
 */
async function sceneOutlinerNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  return runPlanningNode('scene-outliner', getSceneOutlinerPrompt(), state, config);
}

/**
 * researcher 节点（策划类）：资料研究员。
 */
async function researcherNode(state: GraphState, config: GraphConfig): Promise<GraphUpdate> {
  return runPlanningNode('researcher', getResearcherPrompt(), state, config);
}

/**
 * 策划类节点共用实现（I9 子阶段 E）：architect/character-generator/worldbuilding。
 * 写作类——产中文自然语言策划文本，写入 currentDraft + 作为对话呈现；
 * 调 afterWriterDraft 钩子让策划产物经既有「抽取→ingest→写 story-bible」管线落库
 * （锚点缺失时管线内部早退降级为仅对话）；currentAction→idle + 直达 END
 * （策划产物为蓝图，MUST NOT 进写-审-改环）。
 */
async function runPlanningNode(
  agentId:
    | 'architect'
    | 'character-generator'
    | 'worldbuilding'
    | 'concept-generator'
    | 'scene-outliner'
    | 'researcher',
  prompt: { template: string; settings: { maxTokens?: number } },
  state: GraphState,
  config: GraphConfig,
): Promise<GraphUpdate> {
  const deps = depsFrom(config);
  const { block, contextRefs } = await assembleContextBlock(agentId, state, deps);
  const adapter = deps.createAdapter(agentId, 'prose' satisfies CapabilityTier, {
    onReasoning: deps.emitReasoning,
  });
  const iterable = adapter.stream({
    messages: buildPlanningMessages(prompt.template, state, block),
    options: {
      signal: deps.signal,
      maxTokens: prompt.settings.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
  });
  const draft = await streamToText(iterable, deps.emitDialogue);

  // 策划产物是蓝图：写 currentDraft + 入对话，但 currentAction→idle 直达 END，MUST NOT 进写-审-改环。
  const coreUpdate: Partial<NovelState> = {
    currentDraft: draft,
    chatHistory: [{ role: 'assistant', content: draft, author: agentId }],
    agentStatus: 'idle',
    currentAction: 'idle',
    ...(contextRefs !== undefined ? { contextRefs } : {}),
  };
  // 复用既有抽取入库管线（afterWriterDraft）落地 story-bible；锚点缺失时管线内部早退降级为仅对话。
  const nextState = mergeState(state, coreUpdate);
  await deps.recordMilestone(agentId, nextState);
  await deps.afterWriterDraft?.(nextState);
  return coreUpdate;
}

/** supervisor 入口：数据驱动路由（routeByAction），落地外动作安全收敛 END。 */
function supervisorNode(state: GraphState): Command {
  const target = routeByAction(state.currentAction);
  const goto = target !== END && BUILT_NODES.has(target) ? target : END;
  return new Command({ goto });
}

/**
 * reviewer 之后的条件路由（task 2.5）：
 *  - 有需人工裁决的问题 → awaitDecision（挂起等作者）；
 *  - 有可自动修的问题、已写过（reviewIteration>0，即 mutate 路径）且循环未到上限 → 回 writer 再写；
 *  - 否则 → END（审干净、诊断-only、达上限或人工暂停）。
 */
function routeAfterReview(state: GraphState): 'awaitDecision' | 'writer' | typeof END {
  const needsHuman = state.activeBugs.some((b) => b.requiresHumanDecision);
  if (needsHuman) return 'awaitDecision';
  const core = toNovelState(state);
  const stop = shouldStopReviewLoop(core, {
    iteration: state.reviewIteration,
    maxIterations: MAX_REVIEW_ITERATIONS,
  });
  if (state.activeBugs.length > 0 && state.reviewIteration > 0 && !stop) {
    return 'writer';
  }
  return END;
}

/**
 * awaitDecision 节点（task 4.1, 4.4, 4.5）：轻量、无模型调用。
 * 仅当存在需裁决问题时被路由到达；interrupt() 挂起并把待裁决问题作为强类型 payload 抛出，
 * 作者经 Command({resume}) 送回决策后：
 *  - reject / approve → END（终止 / 认可放行，含冲突「知情放行」）；
 *  - correct          → 清空活跃问题、回 writer 依纠偏裁决续写；
 *  - modify           → 覆写 activeBugs 为作者修订列表后回 writer 再写（不重跑 reviewer）。
 * interrupt 之前无昂贵调用，故 resume 只重跑本便宜节点，满足「不重跑已完成节点」。
 */
function awaitDecisionNode(state: GraphState, config: GraphConfig): Command {
  const pending: ReadonlyArray<ConsistencyIssue> = state.activeBugs.filter(
    (b) => b.requiresHumanDecision,
  );
  // interrupt payload 为强类型 ConsistencyIssue[]（禁 any）；resume 值为 ResumeDecision。
  const decision = interrupt<ReadonlyArray<ConsistencyIssue>, ResumeDecision>(pending);

  switch (decision.kind) {
    case 'reject':
    case 'approve':
      return new Command({ goto: END, update: { agentStatus: 'idle', currentAction: 'idle' } });
    case 'correct':
      return new Command({
        goto: depsFrom(config).continuationTarget?.() ?? 'writer',
        update: { activeBugs: [], agentStatus: 'idle', currentAction: 'write' },
      });
    case 'modify': {
      const validated = validateConsistencyIssues(decision.issues);
      const nextBugs: ReadonlyArray<ConsistencyIssue> = validated.ok ? validated.data : pending;
      return new Command({
        goto: depsFrom(config).continuationTarget?.() ?? 'writer',
        update: { activeBugs: nextBugs, agentStatus: 'idle', currentAction: 'write' },
      });
    }
  }
}

function buildCompiledGraph() {
  const builder = new StateGraph(GraphAnnotation)
    .addNode('supervisor', supervisorNode, {
      ends: ['writer', 'reviewer', 'fact-checker', 'scene-generator', 'plagiarism-checker', 'editor', 'style-editor', 'architect', 'character-generator', 'worldbuilding', 'concept-generator', 'scene-outliner', 'researcher', END],
    })
    .addNode('writer', writerNode)
    .addNode('reviewer', reviewerNode)
    .addNode('fact-checker', factCheckerNode)
    .addNode('scene-generator', sceneGeneratorNode)
    .addNode('plagiarism-checker', plagiarismCheckerNode)
    .addNode('editor', editorNode)
    .addNode('style-editor', styleEditorNode)
    .addNode('architect', architectNode)
    .addNode('character-generator', characterGeneratorNode)
    .addNode('worldbuilding', worldbuildingNode)
    .addNode('concept-generator', conceptGeneratorNode)
    .addNode('scene-outliner', sceneOutlinerNode)
    .addNode('researcher', researcherNode)
    .addNode('awaitDecision', awaitDecisionNode, { ends: ['writer', 'reviewer', 'fact-checker', 'scene-generator', 'plagiarism-checker', 'editor', 'style-editor', 'architect', 'character-generator', 'worldbuilding', 'concept-generator', 'scene-outliner', 'researcher', END] })
    .addEdge(START, 'supervisor')
    .addEdge('writer', 'reviewer')
    .addEdge('scene-generator', 'reviewer')
    .addEdge('editor', END)
    .addEdge('style-editor', END)
    .addEdge('architect', END)
    .addEdge('character-generator', END)
    .addEdge('worldbuilding', END)
    .addEdge('concept-generator', END)
    .addEdge('scene-outliner', END)
    .addEdge('researcher', END)
    .addConditionalEdges('reviewer', routeAfterReview, {
      awaitDecision: 'awaitDecision',
      writer: 'writer',
      [END]: END,
    })
    .addConditionalEdges('fact-checker', routeAfterReview, {
      awaitDecision: 'awaitDecision',
      writer: 'writer',
      [END]: END,
    })
    .addConditionalEdges('plagiarism-checker', routeAfterReview, {
      awaitDecision: 'awaitDecision',
      writer: 'writer',
      [END]: END,
    });

  // 运行态 checkpoint 用 MemorySaver（design D3.5 方案 A）：interrupt/resume 机械需一个 saver，
  // 但纠偏/冲突/问话的语义在节点里、不在 saver 里，故内存 saver 不丢特性。
  return builder.compile({ checkpointer: new MemorySaver() });
}

/** 编译后的编排图类型（供运行层持有、注入 deps 后 invoke/stream）。 */
export type CompiledOrchestrationGraph = ReturnType<typeof buildCompiledGraph>;

/**
 * 构建一张编排图。单一有状态图原则：整个 App/工作区复用同一张编译图 + 其 checkpointer，
 * 召唤只向图注入命令（改 currentAction / 追加对话）改变下一跳，MUST NOT 每次 new。
 */
export function createOrchestrationGraph(): CompiledOrchestrationGraph {
  return buildCompiledGraph();
}

export { GraphAnnotation, MAX_REVIEW_ITERATIONS };
