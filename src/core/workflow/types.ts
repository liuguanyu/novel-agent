export type WorkflowKind = 'new-book-creation' | 'legacy-book-revision';
export type AuthorIntentKind = 'preserve' | 'extract' | 'remove';

export interface AuthorIntent {
  readonly kind: AuthorIntentKind;
  readonly text: string;
}
export type WorkflowStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
export type StageStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'awaiting-confirmation'
  | 'completed'
  | 'skipped'
  | 'failed';

/** Orthogonal to StageStatus: an impact never silently changes lifecycle state. */
export type StageImpactStatus = 'none' | 'stale' | 'needs-review' | 'conflicting';
export type StageActor = 'system' | 'expert' | 'author' | 'quality-gate';

export type WorkflowScope =
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'chapter'; readonly projectId: string; readonly chapterId: string }
  | { readonly kind: 'issue'; readonly projectId: string; readonly issueId: string };

export interface WorkflowRef {
  readonly workflowId: string;
  readonly stageId: string;
  /** Present when this run belongs to one issue in an issue-scoped stage. */
  readonly issueId?: string;
}

export type WorkflowArtifactRef =
  | { readonly kind: 'creative-asset'; readonly assetId: string; readonly version: number }
  | { readonly kind: 'audit'; readonly auditRunId: string }
  | { readonly kind: 'checkpoint'; readonly checkpointId: string }
  | { readonly kind: 'manuscript'; readonly manuscriptNodeId: string }
  | { readonly kind: 'fact-version'; readonly factVersion: number }
  | { readonly kind: 'run-output'; readonly runId: string };

export type WorkflowBlockingReason =
  | { readonly kind: 'conflict'; readonly conflictIds: ReadonlyArray<string> }
  | { readonly kind: 'missing-anchor'; readonly issueId: string }
  | { readonly kind: 'failed-run'; readonly runId: string; readonly message?: string }
  | { readonly kind: 'interrupted-run'; readonly runId: string; readonly message?: string }
  | { readonly kind: 'asset-impact'; readonly impactSetId: string }
  | { readonly kind: 'quality-gate'; readonly issueIds: ReadonlyArray<string> }
  | { readonly kind: 'version-conflict'; readonly expectedVersion: number; readonly actualVersion: number };

export type StageCompletionEvidence =
  | { readonly kind: 'run-succeeded'; readonly runId: string }
  | { readonly kind: 'author-confirmation'; readonly confirmationId: string }
  | { readonly kind: 'quality-gate'; readonly runId: string; readonly passed: boolean }
  | { readonly kind: 'checkpoint'; readonly checkpointId: string }
  | { readonly kind: 'finalization'; readonly manuscriptNodeId: string };

export interface WorkflowStageInstance {
  readonly stageId: string;
  readonly templateStageId: string;
  readonly status: StageStatus;
  readonly impactStatus: StageImpactStatus;
  readonly actor: StageActor;
  readonly scope: WorkflowScope;
  readonly runIds: ReadonlyArray<string>;
  readonly artifactRefs: ReadonlyArray<WorkflowArtifactRef>;
  readonly completionEvidence: ReadonlyArray<StageCompletionEvidence>;
  readonly blockingReason?: WorkflowBlockingReason;
  readonly enteredAt?: string;
  readonly completedAt?: string;
}

export interface WorkflowInstance {
  readonly workflowId: string;
  readonly projectId: string;
  readonly kind: WorkflowKind;
  readonly templateVersion: number;
  readonly objective: string;
  readonly authorIntents: ReadonlyArray<AuthorIntent>;
  readonly status: WorkflowStatus;
  readonly currentStageId: string;
  readonly stages: ReadonlyArray<WorkflowStageInstance>;
  /** Optimistic concurrency version. */
  readonly version: number;
  /** Bounded/persisted by the repository; retained here to make transitions pure and idempotent. */
  readonly appliedOperationIds: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WorkflowGate =
  | { readonly kind: 'automatic'; readonly evidence: StageCompletionEvidence['kind'] }
  | { readonly kind: 'author-confirmation'; readonly evidence: StageCompletionEvidence['kind'] }
  | { readonly kind: 'quality'; readonly evidence: 'quality-gate'; readonly blockingOnFailure: boolean };

export type WorkflowTransitionCondition =
  | 'completed'
  | 'quality-failed'
  | 'continue-loop'
  | 'finish-loop'
  | 'issues-found';

export interface WorkflowTransitionDefinition {
  readonly to: string;
  readonly when: WorkflowTransitionCondition;
}

export interface WorkflowTemplateStage {
  readonly id: string;
  readonly label: string;
  readonly actor: StageActor;
  readonly scope: WorkflowScope['kind'];
  readonly allowedExperts: ReadonlyArray<string>;
  readonly completionGate: WorkflowGate;
  readonly skippable: boolean;
  readonly retryable: boolean;
  readonly transitions: ReadonlyArray<WorkflowTransitionDefinition>;
}

export interface WorkflowTemplate {
  readonly kind: WorkflowKind;
  readonly version: number;
  readonly label: string;
  readonly initialStageId: string;
  readonly stages: ReadonlyArray<WorkflowTemplateStage>;
}
