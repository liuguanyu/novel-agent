import type {
  ConsistencyIssueDto,
  CreativeAssetCandidateDto,
  SummonRunCommand,
  WorkflowActionCommand,
  WorkflowSnapshotDto,
} from '../../shared/ipc/index.js';

export type IssueLifecycleStatus = NonNullable<ConsistencyIssueDto['workflowStatus']>;

export interface IssueLifecyclePresentation {
  readonly status: IssueLifecycleStatus;
  readonly label: string;
  readonly nextAction: string;
  readonly outcome: 'active' | 'verifying' | 'resolved' | 'dismissed';
  readonly reason: string | undefined;
}

const ISSUE_LIFECYCLE_LABELS: Readonly<Record<IssueLifecycleStatus, string>> = {
  open: '待处理',
  fixing: '修复中',
  verifying: '复检中',
  resolved: '已解决',
  dismissed: '已忽略',
};

/** Renderer-only lifecycle copy. Status remains a Main projection; this helper never transitions an issue. */
export function presentIssueLifecycle(
  status: IssueLifecycleStatus,
  resolutionReason?: string,
): IssueLifecyclePresentation {
  switch (status) {
    case 'open':
      return { status, label: ISSUE_LIFECYCLE_LABELS[status], nextAction: '下一步：选择问题并定位原文', outcome: 'active', reason: undefined };
    case 'fixing':
      return { status, label: ISSUE_LIFECYCLE_LABELS[status], nextAction: '下一步：完成改写并提交 hunk 裁决', outcome: 'active', reason: undefined };
    case 'verifying':
      return { status, label: ISSUE_LIFECYCLE_LABELS[status], nextAction: '下一步：运行针对性复检', outcome: 'verifying', reason: undefined };
    case 'resolved':
      return { status, label: ISSUE_LIFECYCLE_LABELS[status], nextAction: '已完成：问题已解决', outcome: 'resolved', reason: resolutionReason };
    case 'dismissed': {
      const reason = resolutionReason?.trim();
      return {
        status,
        label: ISSUE_LIFECYCLE_LABELS[status],
        nextAction: `已忽略${reason === undefined || reason.length === 0 ? '' : `：${reason}`}`,
        outcome: 'dismissed',
        reason: reason === undefined || reason.length === 0 ? undefined : reason,
      };
    }
  }
}

export type ChapterTarget =
  | { readonly enabled: false; readonly reason: 'missing-chapter-anchor' }
  | { readonly enabled: true; readonly targetChapterId: string; readonly crossesChapter: boolean };

/** Resolve the stable chapter target without guessing from scene/volume anchors. */
export function resolveIssueChapterTarget(
  issue: Pick<ConsistencyIssueDto, 'anchors'>,
  currentChapterId?: string,
): ChapterTarget {
  const anchor = issue.anchors.find((candidate) => candidate.kind === 'chapter');
  if (anchor === undefined) return { enabled: false, reason: 'missing-chapter-anchor' };
  return {
    enabled: true,
    targetChapterId: anchor.id,
    crossesChapter: currentChapterId !== undefined && currentChapterId !== anchor.id,
  };
}

export type IssueRefactorIntent =
  | { readonly enabled: false; readonly reason: 'missing-chapter-anchor' | 'missing-evidence-quote' }
  | {
      readonly enabled: true;
      readonly issueId: string | undefined;
      readonly targetChapterId: string;
      readonly crossesChapter: boolean;
      readonly prefill: {
        readonly nodeId: string;
        readonly original: string;
        readonly suggestion: string;
        readonly rewritten: '';
      };
    };

/** Adopt means prefill only: suggestedFix is never promoted to rewritten manuscript text. */
export function buildIssueRefactorIntent(
  issue: Pick<ConsistencyIssueDto, 'anchors' | 'evidence' | 'suggestedFix' | 'issueId'>,
  currentChapterId?: string,
): IssueRefactorIntent {
  const target = resolveIssueChapterTarget(issue, currentChapterId);
  if (!target.enabled) return target;
  const original = issue.evidence?.quote ?? '';
  if (original.length === 0) return { enabled: false, reason: 'missing-evidence-quote' };
  return {
    enabled: true,
    issueId: issue.issueId,
    targetChapterId: target.targetChapterId,
    crossesChapter: target.crossesChapter,
    prefill: {
      nodeId: target.targetChapterId,
      original,
      suggestion: issue.suggestedFix ?? '',
      rewritten: '',
    },
  };
}

export interface AssetClarificationSelectionInput {
  readonly runId: string;
  readonly agent: string;
  readonly mode: SummonRunCommand['mode'];
  readonly scope: SummonRunCommand['scope'];
  readonly targetAssetId: string;
  readonly workflowRef?: SummonRunCommand['workflowRef'];
  readonly anchorNodeId?: string;
  readonly instruction?: string;
  readonly autoExtractFacts?: boolean;
}

/** Construct the author's target-selection intent; it contains no asset content/version mutation. */
export function buildAssetClarificationSelectionCommand(
  input: AssetClarificationSelectionInput,
): SummonRunCommand {
  return {
    type: 'summon-run',
    runId: input.runId,
    agent: input.agent,
    mode: input.mode,
    scope: input.scope,
    targetAssetId: input.targetAssetId,
    ...(input.workflowRef === undefined ? {} : { workflowRef: input.workflowRef }),
    ...(input.anchorNodeId === undefined ? {} : { anchorNodeId: input.anchorNodeId }),
    ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
    ...(input.autoExtractFacts === undefined ? {} : { autoExtractFacts: input.autoExtractFacts }),
  };
}

export interface AssetCandidateDecisionInput {
  readonly workflow: Pick<WorkflowSnapshotDto, 'workflowId' | 'currentStageId' | 'version'>;
  readonly candidate: Pick<CreativeAssetCandidateDto, 'candidateId' | 'workflowRef'>;
  readonly decision: 'confirm' | 'reject';
  readonly requestId: string;
  readonly operationId: string;
}

/** Construct candidate confirmation/rejection intent only; Main owns all asset state and version changes. */
export function buildAssetCandidateDecisionCommand(
  input: AssetCandidateDecisionInput,
): WorkflowActionCommand {
  const stageId = input.candidate.workflowRef?.stageId ?? input.workflow.currentStageId;
  return {
    type: input.decision === 'confirm' ? 'workflow-confirm-asset-change' : 'workflow-reject-asset-change',
    workflowId: input.workflow.workflowId,
    ...(stageId === null || stageId === undefined ? {} : { stageId }),
    candidateId: input.candidate.candidateId,
    requestId: input.requestId,
    operationId: input.operationId,
    expectedVersion: input.workflow.version,
  };
}
