/**
 * 审校结构化卡片 (review-findings-ui)
 *
 * 把一次审校运行的 ConsistencyIssueDto[] 渲染为按严重度配色的卡片（critical=朱砂 / warning=琥珀 / info=墨灰）：
 * 左边框 + 徽标着色，含类型/严重度、描述、证据引文、建议修复。点击带证据的卡片 → onSelect(index)
 * 触发正文定位高亮与连线；卡片带 data-finding-id 供连线覆盖层测量。Renderer 无业务逻辑：仅呈现与选中。
 */

import type { ConsistencyIssueDto } from '../../shared/ipc/index.js';

/** 严重度 → 中文标签。 */
const SEVERITY_LABEL: Record<ConsistencyIssueDto['severity'], string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
};

/** 严重度 → 卡片视觉（左边框 + 底色 + 徽标 + 选中环），明暗主题经语义色适配。 */
const SEVERITY_STYLE: Record<
  ConsistencyIssueDto['severity'],
  { card: string; selected: string; badge: string; quote: string }
> = {
  critical: {
    card: 'border-l-destructive bg-destructive/5 hover:bg-destructive/10',
    selected: 'ring-2 ring-destructive/60 bg-destructive/10',
    badge: 'bg-destructive/15 text-destructive',
    quote: 'border-destructive/40',
  },
  warning: {
    card: 'border-l-amber-500 bg-amber-500/5 hover:bg-amber-500/10',
    selected: 'ring-2 ring-amber-500/60 bg-amber-500/10',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    quote: 'border-amber-500/40',
  },
  info: {
    card: 'border-l-muted-foreground/50 bg-muted/40 hover:bg-muted/70',
    selected: 'ring-2 ring-muted-foreground/40 bg-muted/70',
    badge: 'bg-muted-foreground/15 text-muted-foreground',
    quote: 'border-muted-foreground/40',
  },
};

/** 连线覆盖层据此选择器测量选中卡片的位置。 */
export function findingCardId(runId: string, index: number): string {
  return `finding-${runId}-${index}`;
}

function FindingCard({
  runId,
  index,
  issue,
  selected,
  onSelect,
  onAdopt,
}: {
  runId: string;
  index: number;
  issue: ConsistencyIssueDto;
  selected: boolean;
  onSelect: (index: number) => void;
  onAdopt?: ((issue: ConsistencyIssueDto) => void) | undefined;
}): JSX.Element {
  const style = SEVERITY_STYLE[issue.severity];
  const locatable = issue.evidence?.quote !== undefined && issue.evidence.quote.length > 0;
  const refactorable = locatable && issue.anchors.some((anchor) => anchor.kind === 'chapter');
  return (
    <div
      data-finding-id={findingCardId(runId, index)}
      role={locatable ? 'button' : undefined}
      tabIndex={locatable ? 0 : undefined}
      aria-pressed={locatable ? selected : undefined}
      onClick={locatable ? () => onSelect(index) : undefined}
      onKeyDown={
        locatable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(index);
              }
            }
          : undefined
      }
      className={`space-y-1.5 overflow-hidden rounded-md border border-l-4 border-border p-2.5 text-xs transition-colors ${
        style.card
      } ${selected ? style.selected : ''} ${
        locatable ? 'cursor-pointer' : 'cursor-default opacity-90'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${style.badge}`}>
          {SEVERITY_LABEL[issue.severity]}
        </span>
        <span className="text-[11px] text-muted-foreground">{issue.type}</span>
        {locatable && (
          <span className="ml-auto text-[10px] text-muted-foreground">点击定位原文 →</span>
        )}
      </div>
      <p className="leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {issue.description}
      </p>
      {issue.evidence?.quote !== undefined && issue.evidence.quote.length > 0 && (
        <blockquote className={`border-l-2 pl-2 break-words text-muted-foreground ${style.quote}`}>
          {issue.evidence.quote}
        </blockquote>
      )}
      {issue.suggestedFix !== undefined && (
        <p className="break-words text-muted-foreground">建议：{issue.suggestedFix}</p>
      )}
      {refactorable && onAdopt !== undefined && (
        <div className="flex justify-end pt-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAdopt(issue);
            }}
            className="rounded border border-border bg-background px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-muted"
          >
            采纳并修改 →
          </button>
        </div>
      )}
    </div>
  );
}

/** 一次审校运行的卡片列表。 */
export function FindingsPanel({
  runId,
  issues,
  activeIndex,
  onSelect,
  onAdopt,
}: {
  runId: string;
  issues: ReadonlyArray<ConsistencyIssueDto>;
  /** 当前选中的问题索引（该 runId 下），无则 undefined。 */
  activeIndex: number | undefined;
  onSelect: (index: number) => void;
  /** 采纳某条发现并跳重构面板预填。 */
  onAdopt?: ((issue: ConsistencyIssueDto) => void) | undefined;
}): JSX.Element | null {
  if (issues.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {issues.map((issue, index) => (
        <FindingCard
          key={`${issue.type}-${index}`}
          runId={runId}
          index={index}
          issue={issue}
          selected={activeIndex === index}
          onSelect={onSelect}
          onAdopt={onAdopt}
        />
      ))}
    </div>
  );
}
