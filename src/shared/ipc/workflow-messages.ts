/** Workflow-guided workbench IPC DTOs. All fields are serializable and optional additions preserve standalone clients. */
export type AuthorIntentKindDto = 'preserve' | 'extract' | 'remove';
export interface AuthorIntentDto { kind: AuthorIntentKindDto; text: string }
export interface WorkflowRefDto { workflowId: string; stageId: string; issueId?: string }
export interface WorkflowRequestMeta { requestId?: string; operationId?: string; expectedVersion?: number; workflowRef?: WorkflowRefDto }
export interface WorkflowSnapshotDto { workflowId:string; projectId:string; kind:string; templateVersion:string|number; objective:string; authorIntents:ReadonlyArray<AuthorIntentDto>; status:string; currentStageId:string|null; stages:ReadonlyArray<Record<string,unknown>>; version:number; createdAt:number; updatedAt:number }
export interface WorkflowSnapshotResponse { snapshot: WorkflowSnapshotDto|null; failure?: WorkflowFailureEvent }
export interface GetWorkflowSnapshotRequest extends WorkflowRequestMeta { workflowId?: string; projectId?: string }
export interface StartWorkflowCommand extends WorkflowRequestMeta { type:'start-workflow'; requestId:string; operationId:string; projectId:string; workflowId?:string; kind?:'new-book-creation'|'legacy-book-revision'; objective:string; authorIntents?:ReadonlyArray<AuthorIntentDto> }
export type WorkflowAction = 'start-stage'|'confirm-stage'|'retry-stage'|'skip-stage'|'pause'|'resume'|'cancel'|'update-goal'|'update-author-intents'|'select-issue'|'dismiss-issue'|'verify-issue'|'change-asset'|'confirm-asset-change'|'reject-asset-change'|'resolve-asset-impact';
export interface WorkflowActionCommand extends WorkflowRequestMeta { type: `workflow-${WorkflowAction}`; requestId:string; operationId:string; expectedVersion:number; workflowId:string; stageId?:string; issueId?:string; assetId?:string; candidateId?:string; impactId?:string; runId?:string; reason?:string; result?:string; content?:unknown; provenance?:unknown; objective?:string; authorIntents?:ReadonlyArray<AuthorIntentDto> }
export type WorkflowCommand = StartWorkflowCommand|WorkflowActionCommand;
export interface WorkflowFailureEvent { type:'workflow-failure'; runId: string; requestId?:string; operationId?:string; workflowRef?:WorkflowRefDto; error:{code:string;message:string}; snapshot?:WorkflowSnapshotDto|null }
export interface WorkflowSnapshotEvent { type:'workflow-snapshot'; runId: string; requestId?:string; operationId?:string; snapshot:WorkflowSnapshotDto }
export interface WorkflowIssueDto { issueId:string; workflowId:string; status:string; [key:string]:unknown }
export interface WorkflowAssetQuery { assetId:string; projectId?:string }
export interface WorkflowAssetResponse { asset:Record<string,unknown>|null }
export const WORKFLOW_QUERY_CHANNELS={ snapshot:'query:workflow-snapshot', active:'query:workflow-active', asset:'query:workflow-asset' } as const;
export type WorkflowQueryChannel=(typeof WORKFLOW_QUERY_CHANNELS)[keyof typeof WORKFLOW_QUERY_CHANNELS];
export const WORKFLOW_COMMAND_CHANNEL='command:workflow';
