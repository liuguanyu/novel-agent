/**
 * 右对话轴 (walking-skeleton tasks 6.2, 6.3, 6.4)
 *
 * 按 core/shell/layout.ts 的 DIALOGUE_AXIS_ENTRIES 呈现：对话历史 + 流式回复（reasoning 可折叠、正文只显示 content）
 * + 手刹控件（中断经桥上报，映射 abort 语义）。审批弹窗（task 6.4）留后续波次接强类型 InterruptPayload。
 * Renderer 无业务逻辑：仅渲染与交互。
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { ConsistencyIssueDto } from '../../shared/ipc/index.js';
import type { DialogueTurn, PendingConflict } from '../hooks/useDialogue.js';
import type { ReviewFinding, ActiveFinding } from '../hooks/useReviewFindings.js';
import { FindingsPanel } from './FindingsPanel.js';
import {
  AGENT_CATALOG_ENTRIES,
  AGENT_CATEGORY_LABELS,
  resolveAgentEntry,
  resolveAgentMention,
} from '../../core/shell/agent-catalog.js';
import { resolveAgentIcon } from '../lib/agent-icons.js';

interface DialogueAxisProps {
  turns: ReadonlyArray<DialogueTurn>;
  activeRunId: string | undefined;
  pendingConflict: PendingConflict | undefined;
  /** 按 runId 归档的审校结构化结果（在对应助手 turn 下渲染卡片）。 */
  findingsByRun: ReadonlyMap<string, ReviewFinding>;
  /** 当前选中的审校问题（驱动卡片选中态）。 */
  activeFinding: ActiveFinding | undefined;
  onAsk: (instruction: string) => void;
  /** 当前输入提交后将交给的专家，避免隐式切换路由。 */
  askTargetLabel: string;
  onAbort: (runId: string) => void;
  onApproveConflict: (runId: string) => void;
  onRejectConflict: (runId: string) => void;
  onModifyConflict: (runId: string, issues: ReadonlyArray<ConsistencyIssueDto>) => void;
  /** 选中某条审校问题（触发正文定位高亮）。 */
  onSelectFinding: (runId: string, index: number) => void;
  /** 采纳某条发现：以证据引文预填重构面板并打开。 */
  onAdoptFinding: (issue: ConsistencyIssueDto) => void;
}

function ReasoningBlock({ reasoning }: { reasoning: string }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (reasoning.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2">
      <CollapsibleTrigger className="text-xs text-muted-foreground hover:underline">
        {open ? `▼ 隐藏思考过程（${reasoning.length} 字）` : `▶ 显示思考过程（${reasoning.length} 字）`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs text-muted-foreground">
          {reasoning}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TurnView({
  turn,
  finding,
  activeFinding,
  onSelectFinding,
  onAdoptFinding,
}: {
  turn: DialogueTurn;
  finding: ReviewFinding | undefined;
  activeFinding: ActiveFinding | undefined;
  onSelectFinding: (runId: string, index: number) => void;
  onAdoptFinding: (issue: ConsistencyIssueDto) => void;
}): JSX.Element {
  const isUser = turn.role === 'user';
  // 助手 turn 据权威目录解析发言专家（名 + 类别徐标）；未登记/未知回退通用“助手”。
  const entry = isUser || turn.agent === undefined ? undefined : resolveAgentEntry(turn.agent);
  const speakerLabel = isUser ? '作者' : (entry?.label ?? '助手');
  const SpeakerIcon = entry === undefined ? undefined : resolveAgentIcon(entry.icon);
  const activeIndex =
    activeFinding !== undefined && activeFinding.runId === turn.runId
      ? activeFinding.index
      : undefined;
  return (
    <div className={`mb-4 ${isUser ? 'text-right' : 'text-left'}`}>
      <div
        className={`mb-1 flex items-center gap-1.5 text-xs text-muted-foreground ${
          isUser ? 'justify-end' : 'justify-start'
        }`}
      >
        {SpeakerIcon !== undefined && <SpeakerIcon className="size-3.5 text-primary" aria-hidden />}
        <span>{speakerLabel}</span>
        {entry !== undefined && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {AGENT_CATEGORY_LABELS[entry.category]}
          </span>
        )}
      </div>
      {!isUser && <ReasoningBlock reasoning={turn.reasoning} />}
      <div
        className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
        }`}
      >
        {turn.status === 'error'
          ? `⚠ ${turn.error ?? '出错了'}`
          : turn.content.length > 0
            ? turn.content
            : turn.status === 'streaming'
              ? '…'
              : turn.status === 'aborted'
                ? '（已中断）'
                : ''}
      </div>
      {!isUser && finding !== undefined && (
        <FindingsPanel
          runId={turn.runId}
          issues={finding.issues}
          activeIndex={activeIndex}
          onSelect={(index) => onSelectFinding(turn.runId, index)}
          onAdopt={onAdoptFinding}
        />
      )}
    </div>
  );
}

/** 一条问题的作者裁决草稿：选中的候选方向 + 发给写手的修改要求（可编辑）。 */
interface IssueDecisionDraft {
  readonly instruction: string;
  readonly selectedOptionId: string | undefined;
}

function ConflictIssueCard({
  issue,
  draft,
  onPickOption,
  onChangeInstruction,
}: {
  issue: ConsistencyIssueDto;
  draft: IssueDecisionDraft;
  onPickOption: (optionId: string, label: string) => void;
  onChangeInstruction: (text: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-2 overflow-hidden rounded-md border border-amber-300/70 bg-amber-50/80 p-2.5 text-xs text-amber-950">
      <div className="font-medium break-words">
        {issue.severity} · {issue.type}
      </div>
      <p className="leading-relaxed break-words whitespace-pre-wrap">{issue.description}</p>
      {issue.evidence !== undefined && (
        <blockquote className="border-l-2 border-amber-300 pl-2 break-words text-amber-900">
          {issue.evidence.quote}
        </blockquote>
      )}
      {issue.suggestedFix !== undefined && (
        <p className="break-words text-amber-900">建议：{issue.suggestedFix}</p>
      )}

      {issue.options !== undefined && issue.options.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-amber-900">选一个修改方向：</div>
          <div className="space-y-1">
            {issue.options.map((option) => {
              const selected = draft.selectedOptionId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onPickOption(option.id, option.label)}
                  aria-pressed={selected}
                  className={`flex w-full items-start gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                    selected
                      ? 'border-amber-500 bg-amber-100'
                      : 'border-amber-200 hover:bg-amber-100/60'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border ${
                      selected ? 'border-amber-600' : 'border-amber-400'
                    }`}
                    aria-hidden
                  >
                    {selected && <span className="size-1.5 rounded-full bg-amber-600" />}
                  </span>
                  <span className="leading-snug break-words whitespace-normal text-amber-950">
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-[11px] font-medium text-amber-900">
          修改要求（发给写手，可编辑）
        </label>
        <textarea
          value={draft.instruction}
          onChange={(e) => onChangeInstruction(e.target.value)}
          rows={2}
          placeholder="点选上方方向自动填入，或在此自定义修改要求…"
          className="w-full resize-none rounded border border-amber-300 bg-white/70 px-2 py-1 text-xs text-amber-950 outline-none placeholder:text-amber-500/80 focus-visible:ring-2 focus-visible:ring-amber-400"
        />
      </div>
    </div>
  );
}

function buildInitialDrafts(
  issues: ReadonlyArray<ConsistencyIssueDto>,
): ReadonlyArray<IssueDecisionDraft> {
  return issues.map((issue) => ({ instruction: issue.suggestedFix ?? '', selectedOptionId: undefined }));
}

function ConflictPanel({
  conflict,
  onApprove,
  onReject,
  onModify,
}: {
  conflict: PendingConflict;
  onApprove: (runId: string) => void;
  onReject: (runId: string) => void;
  onModify: (runId: string, issues: ReadonlyArray<ConsistencyIssueDto>) => void;
}): JSX.Element {
  const [drafts, setDrafts] = useState<ReadonlyArray<IssueDecisionDraft>>(() =>
    buildInitialDrafts(conflict.issues),
  );

  // 新一轮冲突（换 runId / 换问题集）到达时重置草稿。
  useEffect(() => {
    setDrafts(buildInitialDrafts(conflict.issues));
  }, [conflict.runId, conflict.issues]);

  const updateDraft = (index: number, patch: Partial<IssueDecisionDraft>): void => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  // 采纳：把每条问题的作者修改要求作为 suggestedFix 回传（modify → 覆盖 activeBugs → 交写手）。
  // 剔除 evidence（Main 侧 consistencyIssueSchema 为 strict，不含该字段）。
  const submitModify = (): void => {
    const issues: ReadonlyArray<ConsistencyIssueDto> = conflict.issues.map((issue, i) => {
      const typed = (drafts[i]?.instruction ?? '').trim();
      const instruction = typed.length > 0 ? typed : (issue.suggestedFix ?? issue.description);
      return {
        type: issue.type,
        severity: issue.severity,
        anchors: issue.anchors,
        description: issue.description,
        suggestedFix: instruction,
        requiresHumanDecision: false,
      };
    });
    onModify(conflict.runId, issues);
  };

  return (
    <div className="mb-2 space-y-2 overflow-hidden rounded-md border border-amber-300 bg-amber-50/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-amber-900">一致性问题需要作者裁决</span>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="xs" variant="outline" onClick={() => onApprove(conflict.runId)}>
            知情放行
          </Button>
          <Button type="button" size="xs" variant="destructive" onClick={() => onReject(conflict.runId)}>
            驳回终止
          </Button>
        </div>
      </div>
      {conflict.issues.map((issue, index) => (
        <ConflictIssueCard
          key={`${issue.type}-${index}`}
          issue={issue}
          draft={drafts[index] ?? { instruction: '', selectedOptionId: undefined }}
          onPickOption={(optionId, label) =>
            updateDraft(index, { selectedOptionId: optionId, instruction: label })
          }
          onChangeInstruction={(text) => updateDraft(index, { instruction: text })}
        />
      ))}
      <div className="flex justify-end pt-1">
        <Button type="button" size="sm" onClick={submitModify}>
          采纳修改并交写手
        </Button>
      </div>
    </div>
  );
}

export function DialogueAxis({
  turns,
  activeRunId,
  pendingConflict,
  findingsByRun,
  activeFinding,
  onAsk,
  askTargetLabel,
  onAbort,
  onApproveConflict,
  onRejectConflict,
  onModifyConflict,
  onSelectFinding,
  onAdoptFinding,
}: DialogueAxisProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const busy = activeRunId !== undefined;
  const mention = resolveAgentMention(draft);
  const mentionToken = draft.trimStart().match(/^@([^\s，,。.!！?？:：]*)$/u)?.[1];
  const mentionMenuOpen = mentionToken !== undefined;
  const normalizedMentionToken = mentionToken?.toLocaleLowerCase() ?? '';
  const mentionCandidates = mentionMenuOpen
    ? AGENT_CATALOG_ENTRIES.filter(
        (entry) =>
          entry.label.toLocaleLowerCase().includes(normalizedMentionToken) ||
          entry.agent.toLocaleLowerCase().includes(normalizedMentionToken),
      )
    : [];
  const draftTargetLabel = mention.kind === 'resolved' ? mention.entry.label : askTargetLabel;
  const mentionError = mention.kind === 'unknown' && !mentionMenuOpen
    ? `未找到专家“${mention.mention}”`
    : undefined;
  useEffect(() => {
    setMentionIndex(0);
  }, [normalizedMentionToken]);

  const completeMention = (index: number): void => {
    const entry = mentionCandidates[index];
    if (entry === undefined) return;
    setDraft(`@${entry.label} `);
    setMentionIndex(0);
  };

  // 多 agent 召唤编排态：标注当前运行的目标专家（据 activeRunId 对应助手 turn 的 agent + 权威目录）。
  const activeAgent = activeRunId === undefined
    ? undefined
    : turns.find((t) => t.runId === activeRunId && t.role === 'assistant')?.agent;
  const activeAgentEntry = activeAgent === undefined ? undefined : resolveAgentEntry(activeAgent);
  const activeAgentLabel = activeAgentEntry?.label;
  const ActiveAgentIcon = activeAgentEntry === undefined ? undefined : resolveAgentIcon(activeAgentEntry.icon);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** 用户是否停在底部（决定流式期间是否自动跟随、是否显示"到底部"按钮）。 */
  const [atBottom, setAtBottom] = useState(true);

  const isAtBottom = (el: HTMLDivElement): boolean =>
    el.scrollHeight - el.scrollTop - el.clientHeight < 24;

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth'): void => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // 新内容到达时：若用户本就停在底部，则自动跟随。
  useEffect(() => {
    if (atBottom) scrollToBottom('auto');
  }, [turns, atBottom]);

  const submit = (): void => {
    const text = draft.trim();
    if (text.length === 0 || busy || mentionError !== undefined) return;
    onAsk(text);
    setDraft('');
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border bg-card">
      <div className="border-b border-border px-3 py-2 font-semibold text-foreground">对话</div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={(e) => setAtBottom(isAtBottom(e.currentTarget))}
          className="h-full overflow-y-auto px-3 py-3"
        >
          {turns.length === 0 ? (
            <p className="text-sm text-muted-foreground">选中章节后，在下方向助手提问或发起召唤。</p>
          ) : (
            turns.map((turn, i) => (
              <TurnView
                key={`${turn.runId}-${turn.role}-${i}`}
                turn={turn}
                finding={turn.role === 'assistant' ? findingsByRun.get(turn.runId) : undefined}
                activeFinding={activeFinding}
                onSelectFinding={onSelectFinding}
                onAdoptFinding={onAdoptFinding}
              />
            ))
          )}
        </div>
        {!atBottom && (
          <Button
            variant="outline"
            size="icon"
            aria-label="滚动到底部"
            onClick={() => scrollToBottom()}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          >
            <ArrowDown className="size-4" />
          </Button>
        )}
      </div>
      <div className="border-t border-border p-3">
        {pendingConflict !== undefined && (
          <ConflictPanel
            conflict={pendingConflict}
            onApprove={onApproveConflict}
            onReject={onRejectConflict}
            onModify={onModifyConflict}
          />
        )}
        {busy && activeRunId !== undefined && (
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              {ActiveAgentIcon !== undefined && (
                <ActiveAgentIcon className="size-3.5 animate-pulse text-primary" aria-hidden />
              )}
              {activeAgentLabel !== undefined ? `${activeAgentLabel} 生成中…` : '生成中…'}
            </span>
            <Button variant="destructive" size="xs" onClick={() => onAbort(activeRunId)}>
              手刹（中断）
            </Button>
          </div>
        )}
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            发送给：<span className="font-medium text-foreground">{draftTargetLabel}</span>
          </span>
          <span>输入 @专家名 可切换</span>
        </div>
        <div className="relative">
          {mentionMenuOpen && (
            <div
              id="dialogue-agent-mentions"
              role="listbox"
              aria-label="选择专家"
              className="absolute bottom-full z-20 mb-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            >
              {mentionCandidates.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  未找到匹配“{mentionToken}”的专家
                </div>
              ) : (
                mentionCandidates.map((entry, index) => {
                  const Icon = resolveAgentIcon(entry.icon);
                  const selected = index === mentionIndex;
                  return (
                    <button
                      key={entry.agent}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        completeMention(index);
                      }}
                      onMouseEnter={() => setMentionIndex(index)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                      }`}
                    >
                      <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{entry.label}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{entry.description}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">@{entry.agent}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (mentionMenuOpen && mentionCandidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionIndex((current) => (current + 1) % mentionCandidates.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionIndex((current) =>
                    (current - 1 + mentionCandidates.length) % mentionCandidates.length,
                  );
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  completeMention(mentionIndex);
                  return;
                }
              }
              if (mentionMenuOpen && e.key === 'Escape') {
                e.preventDefault();
                setDraft('');
                return;
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder={`继续向${askTargetLabel}补充意见，或输入 @专家名 切换`}
            rows={3}
            aria-autocomplete="list"
            aria-controls={mentionMenuOpen ? 'dialogue-agent-mentions' : undefined}
            aria-expanded={mentionMenuOpen}
            className="w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <div className="mt-1 min-h-4 text-[11px] text-destructive">{mentionError}</div>
        <div className="mt-1 flex justify-end">
          <Button size="sm" disabled={busy || draft.trim().length === 0 || mentionError !== undefined} onClick={submit}>
            发送
          </Button>
        </div>
      </div>
    </aside>
  );
}
