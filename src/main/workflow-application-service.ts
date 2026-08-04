import { getBuiltinWorkflowTemplate } from '../core/workflow/templates.js';
import type { WorkflowRecord } from './db/workflow-repository.js';
import type {
  GetWorkflowSnapshotRequest,
  WorkflowAssetQuery,
  WorkflowCommand,
  WorkflowSnapshotDto,
} from '../shared/ipc/workflow-messages.js';
import { CreativeAssetRepository, WorkflowIssueRepository, WorkflowRepository } from './db/index.js';
import { getBuiltinWorkflowTemplate as templateFor } from '../core/workflow/templates.js';
import type { WorkflowCommand as CoreWorkflowCommand } from '../core/workflow/state-machine.js';
import type { WorkflowKind } from '../core/workflow/types.js';

export class WorkflowApplicationService {
  private pendingAssetEvents: ReadonlyArray<Record<string, unknown>> = [];

  drainAssetEvents(): ReadonlyArray<Record<string, unknown>> {
    const events = this.pendingAssetEvents;
    this.pendingAssetEvents = [];
    return events;
  }

  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly assets: CreativeAssetRepository,
    private readonly issues: WorkflowIssueRepository,
  ) {}

  private snapshot(record: WorkflowRecord): WorkflowSnapshotDto {
    return { ...record, authorIntents: (record.authorIntents ?? []) as WorkflowSnapshotDto['authorIntents'], stages: record.stages as unknown as ReadonlyArray<Record<string, unknown>> };
  }

  private snapshotOrNull(record: WorkflowRecord | null): WorkflowSnapshotDto | null {
    return record === null ? null : this.snapshot(record);
  }

  async get(query: GetWorkflowSnapshotRequest): Promise<WorkflowSnapshotDto | null> {
    if (query.workflowId !== undefined) {
      if (query.projectId === undefined) throw new Error('workflow query requires projectId');
      const record = await this.workflows.get(query.workflowId);
      if (record !== null && record.projectId !== query.projectId) throw new Error('workflow does not belong to project');
      return this.snapshotOrNull(record);
    }
    if (query.projectId !== undefined) return this.snapshotOrNull(await this.workflows.getActive(query.projectId));
    return null;
  }

  async active(projectId: string): Promise<WorkflowSnapshotDto | null> {
    return this.snapshotOrNull(await this.workflows.getActive(projectId));
  }

  async latest(workflowId: string): Promise<WorkflowSnapshotDto | null> {
    return this.snapshotOrNull(await this.workflows.get(workflowId));
  }

  async asset(query: WorkflowAssetQuery): Promise<Record<string, unknown> | null> {
    const asset = await this.assets.get(query.assetId);
    if (query.projectId === undefined) throw new Error('asset query requires projectId');
    if (asset !== null && asset.projectId !== query.projectId) {
      throw new Error('asset does not belong to project');
    }
    return asset as unknown as Record<string, unknown> | null;
  }

  async command(command: WorkflowCommand): Promise<WorkflowSnapshotDto | null> {
    if (command.type === 'start-workflow') {
      const kind = command.kind ?? 'new-book-creation';
      const template = getBuiltinWorkflowTemplate(kind);
      if (template === undefined) throw new Error('unknown workflow template');
      const workflowId = command.workflowId ?? `${command.projectId}:${Date.now()}`;
      const stages = template.stages.map((stage) => ({
        stageId: `${workflowId}:${stage.id}`,
        templateStageId: stage.id,
        status: stage.id === template.initialStageId ? 'ready' : 'pending',
        actor: stage.actor,
        scope: { kind: stage.scope, projectId: command.projectId },
        runIds: [], artifactRefs: [], impactStatus: 'none',
      }));
      return this.snapshot(await this.workflows.create({
        workflowId, projectId: command.projectId, kind, templateVersion: String(template.version),
        objective: command.objective, authorIntents: command.authorIntents ?? [], status: 'active', currentStageId: `${workflowId}:${template.initialStageId}`, stages,
      }, command.operationId));
    }

    if (command.type === 'workflow-confirm-stage') {
      const replayed = await this.workflows.replay(command.workflowId, command.operationId);
      if (replayed !== null) return this.snapshot(replayed);
    }
    const record = await this.workflows.get(command.workflowId);
    if (record === null) throw new Error('workflow not found');
    if (command.workflowRef !== undefined) {
      if (command.workflowRef.workflowId !== record.workflowId || !record.stages.some((stage) => stage.stageId === command.workflowRef!.stageId)) throw new Error('workflowRef does not belong to workflow');
      if (command.workflowRef.stageId !== record.currentStageId) throw new Error('workflowRef.stageId must equal current stage');
    }
    if (command.expectedVersion === undefined) throw new Error('expectedVersion is required');
    const action = command.type.replace('workflow-', '');
    if (action === 'update-goal') {
      // 目标/作者要求更新：不推进阶段，不改写历史诊断；下次诊断消费最新版。
      if (command.objective === undefined && command.authorIntents === undefined) throw new Error('objective or authorIntents is required');
      if (command.authorIntents !== undefined && record.kind !== 'legacy-book-revision') throw new Error('author intents are only supported for legacy revision');
      return this.snapshot(await this.workflows.update(
        record.workflowId,
        command.expectedVersion,
        {
          ...(command.objective === undefined ? {} : { objective: command.objective }),
          ...(command.authorIntents === undefined ? {} : { authorIntents: command.authorIntents }),
        },
        command.operationId,
      ));
    }
    if (action === 'update-author-intents') {
      if (record.kind !== 'legacy-book-revision') throw new Error('author intents are only supported for legacy revision');
      if (command.authorIntents === undefined) throw new Error('authorIntents is required');
      return this.snapshot(await this.workflows.update(
        record.workflowId,
        command.expectedVersion,
        { authorIntents: command.authorIntents },
        command.operationId,
      ));
    }
    if (record.version !== command.expectedVersion) throw new Error('workflow version conflict');
    if (command.stageId !== undefined && command.stageId !== record.currentStageId) throw new Error('command.stageId must equal current stage');
    const stageId = record.currentStageId;
    if (stageId === null) throw new Error('workflow has no current stage');
    const stage = record.stages.find((candidate) => candidate.stageId === stageId);
    if (stage === undefined) throw new Error('stage does not belong to workflow');

    if (action === 'select-issue' || action === 'dismiss-issue' || action === 'verify-issue') {
      if (command.issueId === undefined) throw new Error('issueId is required');
      if (command.workflowRef !== undefined) {
        if (command.workflowRef.issueId === undefined || command.workflowRef.issueId !== command.issueId) {
          throw new Error('workflowRef.issueId must equal command.issueId');
        }
      } else if (command.stageId === undefined) {
        throw new Error('issue command requires workflowRef or command.stageId');
      }
      const issue = await this.issues.get(command.issueId);
      if (issue === null || issue.workflowId !== record.workflowId) throw new Error('issue does not belong to workflow');
      if (action === 'select-issue') {
        await this.issues.select(command.issueId, 'author', command.runId);
        await this.workflows.selectIssue(record.workflowId, command.issueId);
      }
      if (action === 'dismiss-issue') await this.issues.dismiss(command.issueId, command.reason ?? '');
      if (action === 'verify-issue') {
        throw new Error('verification result is Main-owned; use run-targeted-verification');
      }
    }

    if (action === 'change-asset') {
      if (command.assetId === undefined || command.content === undefined) throw new Error('assetId and candidate content are required');
      const asset = await this.assets.get(command.assetId);
      if (asset === null || asset.projectId !== record.projectId) throw new Error('asset does not belong to workflow project');
      const candidate = await this.assets.createCandidate(command.assetId, command.content, {
        ...(command.provenance ?? {}),
        runId: command.runId ?? command.operationId,
        workflowRef: { workflowId: record.workflowId, stageId },
      });
      this.pendingAssetEvents = [{ 
        type: 'creative-asset-change-proposed',
        runId: command.runId ?? command.operationId,
        candidate: { ...candidate, workflowRef: { workflowId: record.workflowId, stageId } },
      }];
    }
    if (action === 'confirm-asset-change') {
      const candidateId = command.candidateId ?? command.assetId;
      if (candidateId === undefined) throw new Error('candidateId is required');
      const candidate = await this.assets.getCandidate(candidateId);
      if (candidate === null) throw new Error('asset candidate not found');
      const asset = await this.assets.get(candidate.assetId);
      if (asset === null || asset.projectId !== record.projectId) throw new Error('asset candidate does not belong to workflow project');
      const confirmed = await this.assets.confirmCandidate(candidate.candidateId, command.operationId);
      const workflowRef = { workflowId: record.workflowId, stageId };
      this.pendingAssetEvents = [
        { type: 'creative-asset-updated', runId: command.runId ?? command.operationId, asset: confirmed.asset, workflowRef, projectId: record.projectId },
        ...confirmed.impacts.map((impact) => ({ type: 'asset-impact-detected', runId: command.runId ?? command.operationId,
          impact: { impactId: impact.impactId, assetId: impact.assetId, status: impact.status, targetRefs: [`${impact.targetType}:${impact.targetId}`], workflowRef: impact.workflowId === null ? workflowRef : { workflowId: impact.workflowId, stageId: impact.stageId ?? stageId }, projectId: impact.projectId } })),
      ];
    }
    if (action === 'resolve-asset-impact') {
      if (command.impactId === undefined || command.result === undefined) throw new Error('impactId and result are required');
      await this.assets.resolveImpact(command.impactId, command.result, command.operationId, record.projectId);
    }
    if (action === 'reject-asset-change') {
      const candidateId = command.candidateId ?? command.assetId;
      if (candidateId === undefined) throw new Error('candidateId is required');
      const candidate = await this.assets.getCandidate(candidateId);
      if (candidate === null) throw new Error('asset candidate not found');
      const asset = await this.assets.get(candidate.assetId);
      if (asset === null || asset.projectId !== record.projectId) throw new Error('asset candidate does not belong to workflow project');
      await this.assets.rejectCandidate(candidate.candidateId, command.operationId);
    }

    const template = templateFor(record.kind as WorkflowKind, Number(record.templateVersion));
    if (template === undefined) throw new Error(`unknown workflow template version: ${record.kind}@${record.templateVersion}`);
    let coreCommand: CoreWorkflowCommand | undefined;
    if (action === 'pause') coreCommand = { kind: 'pause' };
    else if (action === 'resume') coreCommand = { kind: 'resume' };
    else if (action === 'cancel') coreCommand = { kind: 'cancel' };
    else if (action === 'start-stage') coreCommand = command.runId === undefined ? { kind: 'start-stage' } : { kind: 'start-stage', runId: command.runId };
    else if (action === 'retry-stage') coreCommand = { kind: 'retry-stage', runId: command.runId ?? command.operationId ?? `run:${Date.now()}` };
    else if (action === 'skip-stage') coreCommand = { kind: 'skip-stage' };
    else if (action === 'confirm-stage') {
      const isFinalizationGate = ['chapter-finalization', 'whole-book-audit', 'final-audit'].includes(stage.templateStageId);
      const blocking = isFinalizationGate
        ? await this.issues.countFinalizationBlocking(record.workflowId)
        : await this.issues.countBlocking(record.workflowId);
      if (blocking > 0 && isFinalizationGate) {
        throw new Error(`workflow has ${blocking} blocking issue(s)`);
      }
      const transition = command.result === undefined ? 'completed' : command.result;
      if (transition !== 'completed' && transition !== 'continue-loop' && transition !== 'finish-loop') {
        throw new Error(`invalid confirmation transition: ${transition}`);
      }
      if ((transition === 'continue-loop' || transition === 'finish-loop') && stage.templateStageId !== 'chapter-finalization') {
        throw new Error(`${transition} is only allowed at chapter-finalization`);
      }
      const chapterId = command.chapterId?.trim();
      if (transition === 'continue-loop' && (chapterId === undefined || chapterId.length === 0)) {
        throw new Error('chapterId is required to continue chapter loop');
      }
      coreCommand = {
        kind: 'confirm-stage',
        confirmationId: command.operationId ?? `confirmation:${Date.now()}`,
        transition,
        ...(transition === 'continue-loop' && chapterId !== undefined
          ? { nextScope: { kind: 'chapter', projectId: record.projectId, chapterId } }
          : {}),
      };
    } else if (![ 
      'select-issue', 'dismiss-issue', 'verify-issue',
      'change-asset', 'reject-asset-change', 'confirm-asset-change', 'resolve-asset-impact',
    ].includes(action)) {
      throw new Error('action not allowed');
    }

    if (coreCommand === undefined) return this.snapshot(await this.workflows.get(record.workflowId) as WorkflowRecord);
    const transitioned = await this.workflows.transition(record.workflowId, template, {
      operationId: command.operationId, expectedVersion: command.expectedVersion,
      at: new Date().toISOString(), command: coreCommand,
    });
    return this.snapshot(transitioned);
  }
}
