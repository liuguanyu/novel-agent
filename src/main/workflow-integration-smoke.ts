import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CreativeAssetRepository,
  ResearchArtifactRepository,
  openDatabase,
  SqliteStageRunEvidenceRecorder,
  WorkflowIssueRepository,
  WorkflowRepository,
} from './db/index.js';
import { WorkflowApplicationService } from './workflow-application-service.js';
import { resolveContinuation, type ContinuationScope, type InterruptContinuationRecord } from '../core/workflow/continuation.js';
import { planningAssetKindFor, planningAssetScopeKind } from '../core/workflow/planning-assets.js';

const directory = await mkdtemp(join(tmpdir(), 'novel-agent-workflow-'));
const opened = await openDatabase(join(directory, 'integration.sqlite'));
if (!opened.ok) throw new Error(opened.message);
assert.equal(opened.ok, true);

const db = opened.db;
try {
  const workflows = new WorkflowRepository(db);
  const assets = new CreativeAssetRepository(db);
  const issues = new WorkflowIssueRepository(db);
  const service = new WorkflowApplicationService(workflows, assets, issues);

  const newBook = await service.command({
    type: 'start-workflow', workflowId: 'new-book', projectId: 'project-new',
    objective: 'integration', kind: 'new-book-creation', requestId: 'req-new', operationId: 'op-new',
  });
  assert.ok(newBook !== null);
  const evidence = new SqliteStageRunEvidenceRecorder(db);
  const advanceNewBookStage = async (expectedTemplateStageId: string, index: number): Promise<void> => {
    const current = await workflows.get('new-book');
    assert.ok(current !== null && current.currentStageId !== null);
    const stageId = current.currentStageId;
    const stage = current.stages.find((candidate) => candidate.stageId === stageId);
    assert.equal(stage?.templateStageId, expectedTemplateStageId);
    const runId = `new-book:${expectedTemplateStageId}:${index}`;
    const started = await service.command({
      type: 'workflow-start-stage', workflowId: 'new-book', stageId,
      expectedVersion: current.version, runId, requestId: `${runId}:start`, operationId: `${runId}:start-op`,
    });
    assert.ok(started !== null);
    await evidence.record({ runId, workflowRef: { workflowId: 'new-book', stageId }, status: 'started' });
    await evidence.record({
      runId, workflowRef: { workflowId: 'new-book', stageId }, status: 'completed',
      ...(stage?.actor === 'quality-gate' ? { completion: { passed: true, issueIds: [] } } : {}),
    });
    if (stage?.actor === 'author' || stage?.actor === 'expert') {
      const awaiting = await workflows.get('new-book');
      assert.ok(awaiting !== null && awaiting.currentStageId !== null);
      await service.command({
        type: 'workflow-confirm-stage', workflowId: 'new-book', stageId: awaiting.currentStageId,
        expectedVersion: awaiting.version, requestId: `${runId}:confirm`, operationId: `${runId}:confirm-op`,
      });
    }
  };
  const chapterPath = ['concept', 'worldbuilding', 'character-design', 'book-outline', 'chapter-plan', 'scene-outline', 'draft-writing', 'fact-extraction', 'automatic-review'];
  for (const [index, stageId] of chapterPath.entries()) await advanceNewBookStage(stageId, index);

  const finding = {
    type: 'attribute-conflict', description: 'The protagonist has conflicting eye colours.',
    anchors: [{ kind: 'chapter', id: 'chapter-1' }],
  };
  const [created] = await issues.upsertFromAudit('new-book', 'audit-new-1', [finding]);
  assert.equal(created?.status, 'open');
  assert.equal(await issues.countBlocking('new-book'), 1);
  await advanceNewBookStage('author-review', chapterPath.length);

  const atFinalization = await workflows.get('new-book');
  assert.ok(atFinalization !== null && atFinalization.currentStageId !== null);
  const finalStage = atFinalization.stages.find((stage) => stage.stageId === atFinalization.currentStageId);
  assert.equal(finalStage?.templateStageId, 'chapter-finalization');
  const finalizeRunId = 'new-book:chapter-finalization';
  await service.command({
    type: 'workflow-start-stage', workflowId: 'new-book', stageId: atFinalization.currentStageId,
    expectedVersion: atFinalization.version, runId: finalizeRunId, requestId: 'req-finalize-start', operationId: 'op-finalize-start',
  });
  await evidence.record({ runId: finalizeRunId, workflowRef: { workflowId: 'new-book', stageId: atFinalization.currentStageId }, status: 'started' });
  await evidence.record({ runId: finalizeRunId, workflowRef: { workflowId: 'new-book', stageId: atFinalization.currentStageId }, status: 'completed' });
  const blockedSnapshot = await workflows.get('new-book');
  assert.ok(blockedSnapshot !== null);
  await assert.rejects(service.command({
    type: 'workflow-confirm-stage', workflowId: 'new-book', stageId: String(finalStage['stageId']),
    expectedVersion: blockedSnapshot.version, requestId: 'req-blocked', operationId: 'op-blocked',
  }), /blocking issue/);

  assert.ok(created !== undefined);
  const beforeSelection = await workflows.get('new-book');
  assert.ok(beforeSelection !== null);
  await service.command({
    type: 'workflow-select-issue', workflowId: 'new-book', stageId: String(finalStage['stageId']), issueId: created.issueId,
    expectedVersion: beforeSelection.version, runId: 'fix-1', requestId: 'req-select', operationId: 'op-select',
  });
  assert.equal((await issues.get(created.issueId))?.status, 'fixing');
  await issues.linkCheckpointAndMarkVerifying(created.issueId, 'checkpoint-1');
  await issues.linkCheckpointAndMarkVerifying(created.issueId, 'checkpoint-1');
  assert.equal((await issues.get(created.issueId))?.status, 'verifying');
  await issues.recordVerificationAndTransition(created.issueId, 'verify-1', true, false, ['report-1']);
  await issues.recordVerificationAndTransition(created.issueId, 'verify-1', true, false, ['report-1']);
  assert.equal((await issues.get(created.issueId))?.status, 'resolved');
  assert.equal(await issues.countBlocking('new-book'), 0);

  const afterSelection = await workflows.get('new-book');
  assert.ok(afterSelection !== null);
  const finalized = await service.command({
    type: 'workflow-confirm-stage', workflowId: 'new-book', stageId: String(finalStage['stageId']),
    expectedVersion: afterSelection.version, requestId: 'req-finalize', operationId: 'op-finalize',
  });
  assert.ok(finalized !== null);
  assert.equal(finalized.stages.find((stage) => stage['stageId'] === finalized.currentStageId)?.['templateStageId'], 'whole-book-audit');
  const wholeBookStageId = finalized.currentStageId;
  assert.ok(wholeBookStageId !== null);
  const wholeBookRunId = 'new-book:whole-book-audit';
  await evidence.record({ runId: wholeBookRunId, workflowRef: { workflowId: 'new-book', stageId: wholeBookStageId }, status: 'started' });
  await evidence.record({ runId: wholeBookRunId, workflowRef: { workflowId: 'new-book', stageId: wholeBookStageId }, status: 'completed', completion: { passed: true, issueIds: [] } });
  assert.equal((await workflows.get('new-book'))?.status, 'completed');

  const nextChapter = await service.command({
    type: 'start-workflow', workflowId: 'new-book-next-chapter', projectId: 'project-next',
    objective: 'continue chapter loop', kind: 'new-book-creation', requestId: 'req-next', operationId: 'op-next',
  });
  assert.ok(nextChapter !== null);
  for (const [index, templateStageId] of [...chapterPath, 'author-review'].entries()) {
    const current = await workflows.get('new-book-next-chapter');
    assert.ok(current !== null && current.currentStageId !== null);
    const stageId = current.currentStageId;
    const stage = current.stages.find((candidate) => candidate.stageId === stageId);
    assert.equal(stage?.templateStageId, templateStageId);
    const runId = `new-book-next:${templateStageId}:${index}`;
    await service.command({ type: 'workflow-start-stage', workflowId: 'new-book-next-chapter', stageId, expectedVersion: current.version, runId, requestId: `${runId}:start`, operationId: `${runId}:start-op` });
    await evidence.record({ runId, workflowRef: { workflowId: 'new-book-next-chapter', stageId }, status: 'started' });
    await evidence.record({ runId, workflowRef: { workflowId: 'new-book-next-chapter', stageId }, status: 'completed', ...(stage?.actor === 'quality-gate' ? { completion: { passed: true, issueIds: [] } } : {}) });
    if (stage?.actor === 'author' || stage?.actor === 'expert') {
      const awaiting = await workflows.get('new-book-next-chapter');
      assert.ok(awaiting !== null && awaiting.currentStageId !== null);
      await service.command({ type: 'workflow-confirm-stage', workflowId: 'new-book-next-chapter', stageId: awaiting.currentStageId, expectedVersion: awaiting.version, requestId: `${runId}:confirm`, operationId: `${runId}:confirm-op` });
    }
  }
  const nextFinalization = await workflows.get('new-book-next-chapter');
  assert.ok(nextFinalization !== null && nextFinalization.currentStageId !== null);
  const nextFinalRun = 'new-book-next:finalization';
  await service.command({ type: 'workflow-start-stage', workflowId: 'new-book-next-chapter', stageId: nextFinalization.currentStageId, expectedVersion: nextFinalization.version, runId: nextFinalRun, requestId: 'req-next-final-start', operationId: 'op-next-final-start' });
  await evidence.record({ runId: nextFinalRun, workflowRef: { workflowId: 'new-book-next-chapter', stageId: nextFinalization.currentStageId }, status: 'started' });
  await evidence.record({ runId: nextFinalRun, workflowRef: { workflowId: 'new-book-next-chapter', stageId: nextFinalization.currentStageId }, status: 'completed' });
  const nextAwaiting = await workflows.get('new-book-next-chapter');
  assert.ok(nextAwaiting !== null && nextAwaiting.currentStageId !== null);
  const firstChapterStages = nextAwaiting.stages.filter((stage) => ['chapter-plan', 'scene-outline', 'draft-writing', 'fact-extraction', 'automatic-review', 'author-review', 'chapter-finalization'].includes(stage.templateStageId));
  const firstChapterStageIds = new Set(firstChapterStages.map((stage) => stage.stageId));
  await assert.rejects(service.command({
    type: 'workflow-confirm-stage', workflowId: 'new-book-next-chapter', stageId: nextAwaiting.currentStageId,
    expectedVersion: nextAwaiting.version, result: 'continue-loop', requestId: 'req-next-final-missing-scope', operationId: 'op-next-final-missing-scope',
  }), /chapterId is required/);
  const continued = await service.command({
    type: 'workflow-confirm-stage', workflowId: 'new-book-next-chapter', stageId: nextAwaiting.currentStageId,
    expectedVersion: nextAwaiting.version, result: 'continue-loop', chapterId: 'chapter-2',
    requestId: 'req-next-final-confirm', operationId: 'op-next-final-confirm',
  });
  assert.ok(continued !== null && continued.currentStageId !== null);
  assert.equal(continued.stages.find((stage) => stage['stageId'] === continued.currentStageId)?.['templateStageId'], 'chapter-plan');
  const continuedRecord = await workflows.get('new-book-next-chapter');
  assert.ok(continuedRecord !== null && continuedRecord.currentStageId !== null);
  const secondChapterStages = continuedRecord.stages.filter((stage) => !firstChapterStageIds.has(stage.stageId) && stage.scope !== null && typeof stage.scope === 'object' && 'kind' in stage.scope && stage.scope.kind === 'chapter');
  assert.deepEqual(secondChapterStages.map((stage) => stage.templateStageId), ['chapter-plan', 'scene-outline', 'draft-writing', 'fact-extraction', 'automatic-review', 'author-review', 'chapter-finalization']);
  assert.ok(secondChapterStages.every((stage) => !firstChapterStageIds.has(stage.stageId)));
  assert.ok(secondChapterStages.every((stage) => JSON.stringify(stage.scope) === JSON.stringify({ kind: 'chapter', projectId: 'project-next', chapterId: 'chapter-2' })));
  assert.ok(secondChapterStages.every((stage) => (stage.runIds ?? []).length === 0 && (stage.artifactRefs ?? []).length === 0 && (stage.completionEvidence ?? []).length === 0));
  assert.equal(secondChapterStages[0]?.status, 'ready');
  assert.ok(secondChapterStages.slice(1).every((stage) => stage.status === 'pending'));
  assert.equal(firstChapterStages.find((stage) => stage.templateStageId === 'chapter-plan')?.status, 'completed');
  assert.equal(firstChapterStages.find((stage) => stage.templateStageId === 'chapter-finalization')?.status, 'awaiting-confirmation');

  const replayedContinuation = await service.command({
    type: 'workflow-confirm-stage', workflowId: 'new-book-next-chapter', stageId: nextAwaiting.currentStageId,
    expectedVersion: nextAwaiting.version, result: 'continue-loop', chapterId: 'chapter-2',
    requestId: 'req-next-final-confirm-replay', operationId: 'op-next-final-confirm',
  });
  assert.equal(replayedContinuation?.version, continuedRecord.version);
  assert.equal(replayedContinuation?.stages.length, continuedRecord.stages.length);

  const secondPlan = secondChapterStages[0];
  assert.ok(secondPlan !== undefined);
  await service.command({
    type: 'workflow-start-stage', workflowId: 'new-book-next-chapter', stageId: secondPlan.stageId,
    expectedVersion: continuedRecord.version, runId: 'new-book-next:chapter-2:plan', requestId: 'req-chapter-2-plan-start', operationId: 'op-chapter-2-plan-start',
  });
  const afterSecondPlanStart = await workflows.get('new-book-next-chapter');
  assert.ok(afterSecondPlanStart !== null);
  assert.equal(afterSecondPlanStart.stages.find((stage) => stage.stageId === secondPlan.stageId)?.status, 'running');
  assert.equal(afterSecondPlanStart.stages.find((stage) => stage.stageId === firstChapterStages[0]?.stageId)?.status, 'completed');

  await workflows.create({
    workflowId: 'new-book-finish-loop', projectId: 'project-finish', kind: 'new-book-creation', templateVersion: '1',
    objective: 'finish chapter loop', status: 'active', currentStageId: 'finish:chapter-finalization',
    stages: [
      { stageId: 'finish:chapter-finalization', templateStageId: 'chapter-finalization', status: 'ready', actor: 'author', scope: { kind: 'chapter', projectId: 'project-finish', chapterId: 'chapter-last' }, runIds: [], artifactRefs: [], impactStatus: 'none', completionEvidence: [] },
      { stageId: 'finish:whole-book-audit', templateStageId: 'whole-book-audit', status: 'pending', actor: 'quality-gate', scope: { kind: 'project', projectId: 'project-finish' }, runIds: [], artifactRefs: [], impactStatus: 'none', completionEvidence: [] },
    ],
  }, 'op-finish-create');
  const finishReady = await workflows.get('new-book-finish-loop');
  assert.ok(finishReady !== null && finishReady.currentStageId !== null);
  const finishRunning = await service.command({
    type: 'workflow-start-stage', workflowId: finishReady.workflowId, stageId: finishReady.currentStageId,
    expectedVersion: finishReady.version, requestId: 'req-finish-start', operationId: 'op-finish-start',
  });
  assert.ok(finishRunning !== null && finishRunning.currentStageId !== null);
  const finishedLoop = await service.command({
    type: 'workflow-confirm-stage', workflowId: finishRunning.workflowId, stageId: finishRunning.currentStageId,
    expectedVersion: finishRunning.version, result: 'finish-loop', requestId: 'req-finish-confirm', operationId: 'op-finish-confirm',
  });
  assert.ok(finishedLoop !== null && finishedLoop.currentStageId !== null);
  const finishAudit = finishedLoop.stages.find((stage) => stage['stageId'] === finishedLoop.currentStageId);
  assert.equal(finishAudit?.['templateStageId'], 'whole-book-audit');
  assert.deepEqual(finishAudit?.['scope'], { kind: 'project', projectId: 'project-finish' });
  assert.equal(finishedLoop.stages.filter((stage) => stage['templateStageId'] === 'chapter-plan').length, 0);

  const legacy = await service.command({
    type: 'start-workflow', workflowId: 'legacy', projectId: 'project-legacy',
    objective: 'integration', kind: 'legacy-book-revision', requestId: 'req-legacy', operationId: 'op-legacy',
  });
  assert.ok(legacy !== null);
  const legacyBeforeIntentUpdate = await workflows.get('legacy');
  assert.ok(legacyBeforeIntentUpdate !== null && legacyBeforeIntentUpdate.currentStageId !== null);
  const legacyStageStatus = legacyBeforeIntentUpdate.stages.find((stage) => stage.stageId === legacyBeforeIntentUpdate.currentStageId)?.status;
  const updatedLegacy = await service.command({
    type: 'workflow-update-author-intents', workflowId: 'legacy', expectedVersion: legacyBeforeIntentUpdate.version,
    authorIntents: [{ kind: 'preserve', text: '保留茶馆冲突' }, { kind: 'remove', text: '修复时间线冲突' }],
    requestId: 'req-legacy-intents-update', operationId: 'op-legacy-intents-update',
  });
  assert.ok(updatedLegacy !== null);
  assert.equal(updatedLegacy.version, legacyBeforeIntentUpdate.version + 1);
  assert.equal(updatedLegacy.currentStageId, legacyBeforeIntentUpdate.currentStageId);
  assert.equal(updatedLegacy.stages.find((stage) => stage.stageId === updatedLegacy.currentStageId)?.status, legacyStageStatus);
  assert.deepEqual(updatedLegacy.authorIntents, [{ kind: 'preserve', text: '保留茶馆冲突' }, { kind: 'remove', text: '修复时间线冲突' }]);
  const replayedIntentUpdate = await service.command({
    type: 'workflow-update-author-intents', workflowId: 'legacy', expectedVersion: legacyBeforeIntentUpdate.version,
    authorIntents: [{ kind: 'preserve', text: '保留茶馆冲突' }, { kind: 'remove', text: '修复时间线冲突' }],
    requestId: 'req-legacy-intents-update-replay', operationId: 'op-legacy-intents-update',
  });
  assert.ok(replayedIntentUpdate !== null);
  assert.equal(replayedIntentUpdate.version, updatedLegacy.version);
  assert.equal(replayedIntentUpdate.currentStageId, updatedLegacy.currentStageId);
  assert.deepEqual(replayedIntentUpdate.authorIntents, updatedLegacy.authorIntents);
  await assert.rejects(service.command({
    type: 'workflow-update-author-intents', workflowId: 'legacy', expectedVersion: legacyBeforeIntentUpdate.version,
    authorIntents: [], requestId: 'req-legacy-intents-stale', operationId: 'op-legacy-intents-stale',
  }), /version conflict/);

  // update-goal（task 10.3）：objective + intents 同时更新，阶段不变；operationId 幂等；旧版本拒绝。
  const legacyBeforeGoal = await workflows.get('legacy');
  assert.ok(legacyBeforeGoal !== null && legacyBeforeGoal.currentStageId !== null);
  const goalUpdated = await service.command({
    type: 'workflow-update-goal', workflowId: 'legacy', expectedVersion: legacyBeforeGoal.version,
    objective: '重建主线因果链，保留茶馆群像', authorIntents: [{ kind: 'preserve', text: '保留茶馆群像' }],
    requestId: 'req-legacy-goal-update', operationId: 'op-legacy-goal-update',
  });
  assert.ok(goalUpdated !== null);
  assert.equal(goalUpdated.objective, '重建主线因果链，保留茶馆群像');
  assert.deepEqual(goalUpdated.authorIntents, [{ kind: 'preserve', text: '保留茶馆群像' }]);
  assert.equal(goalUpdated.version, legacyBeforeGoal.version + 1);
  assert.equal(goalUpdated.currentStageId, legacyBeforeGoal.currentStageId);
  assert.equal(
    goalUpdated.stages.find((stage) => stage.stageId === goalUpdated.currentStageId)?.status,
    legacyBeforeGoal.stages.find((stage) => stage.stageId === legacyBeforeGoal.currentStageId)?.status,
  );
  const goalReplayed = await service.command({
    type: 'workflow-update-goal', workflowId: 'legacy', expectedVersion: legacyBeforeGoal.version,
    objective: '重建主线因果链，保留茶馆群像', authorIntents: [{ kind: 'preserve', text: '保留茶馆群像' }],
    requestId: 'req-legacy-goal-replay', operationId: 'op-legacy-goal-update',
  });
  assert.ok(goalReplayed !== null);
  assert.equal(goalReplayed.version, goalUpdated.version);
  assert.equal(goalReplayed.objective, goalUpdated.objective);
  await assert.rejects(service.command({
    type: 'workflow-update-goal', workflowId: 'legacy', expectedVersion: legacyBeforeGoal.version,
    objective: '过期版本的目标', requestId: 'req-legacy-goal-stale', operationId: 'op-legacy-goal-stale',
  }), /version conflict/);
  // 新书工作流：objective 可更新，但 authorIntents 仅限老书重建。
  const newBookBeforeGoal = await workflows.get('new-book');
  assert.ok(newBookBeforeGoal !== null);
  await assert.rejects(service.command({
    type: 'workflow-update-goal', workflowId: 'new-book', expectedVersion: newBookBeforeGoal.version,
    authorIntents: [{ kind: 'preserve', text: '不应支持' }], requestId: 'req-new-goal-intents', operationId: 'op-new-goal-intents',
  }), /only supported for legacy revision/);
  const [legacyIssue] = await issues.upsertFromAudit('legacy', 'legacy-audit-1', [finding]);
  assert.ok(legacyIssue !== undefined);
  await issues.select(legacyIssue.issueId, 'author', 'legacy-fix');
  await issues.linkCheckpointAndMarkVerifying(legacyIssue.issueId, 'legacy-checkpoint');
  await issues.recordVerificationAndTransition(legacyIssue.issueId, 'legacy-verify', true, false, []);
  const [recurrent] = await issues.upsertFromAudit('legacy', 'legacy-final-audit', [finding]);
  assert.equal(recurrent?.issueId, legacyIssue.issueId);
  assert.equal(recurrent?.status, 'open');

  await assets.create({
    assetId: 'outline', projectId: 'project-new', kind: 'book-outline',
    scope: { kind: 'project', projectId: 'project-new' }, content: { title: 'old' },
    status: 'confirmed', provenance: { runId: 'seed' },
  });
  await assets.create({ assetId: 'outline-consumer', projectId: 'project-new', kind: 'chapter-plan', scope: { kind: 'project', projectId: 'project-new' }, content: {}, status: 'confirmed', provenance: { runId: 'seed' } });
  await assets.addDependency({ sourceAssetId: 'outline', sourceVersion: 1, dependentAssetId: 'outline-consumer', kind: 'review', targetType: 'workflow-stage', targetId: String(finalStage.stageId), workflowId: 'new-book', stageId: String(finalStage.stageId), scope: { kind: 'project' } });
  const beforeImpactStageStatus = (await workflows.getStage(String(finalStage.stageId)))?.status;
  const candidate = await assets.createCandidate('outline', { title: 'new' }, { runId: 'proposal' });
  assert.deepEqual((await assets.get('outline'))?.content, { title: 'old' });
  const confirmed = await assets.confirmCandidate(candidate.candidateId, 'confirm-outline');
  const duplicateConfirm = await assets.confirmCandidate(candidate.candidateId, 'confirm-outline');
  assert.deepEqual(duplicateConfirm, confirmed);
  assert.equal(confirmed.impacts.length, 1);
  assert.equal(confirmed.impacts[0]?.status, 'needs-review');
  assert.equal((await assets.listImpacts('outline', confirmed.version)).length, 1);
  assert.equal((await workflows.getStage(String(finalStage.stageId)))?.impactStatus, 'needs-review');
  await assets.resolveImpact(String(confirmed.impacts[0]?.impactId), 'accepted', 'resolve-outline-impact', 'project-new');
  assert.equal((await workflows.getStage(String(finalStage.stageId)))?.impactStatus, 'none');
  assert.equal((await workflows.getStage(String(finalStage.stageId)))?.status, beforeImpactStageStatus);
  assert.deepEqual((await assets.get('outline'))?.content, { title: 'new' });
  assert.equal((await assets.getCandidate(candidate.candidateId))?.status, 'confirmed');
  assert.ok(candidate.changeSetId !== undefined);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM creative_asset_change_sets WHERE change_set_id=?', candidate.changeSetId))?.['count']), 1);

  await assets.create({
    assetId: 'character-asset', projectId: 'project-new', kind: 'character',
    scope: { kind: 'project', projectId: 'project-new' },
    content: { canonicalName: '林默', aliases: ['阿默'], attributes: { role: 'protagonist' } },
    status: 'draft', provenance: { runId: 'seed' },
  });
  const characterCandidate = await assets.createCandidate('character-asset', {
    canonicalName: '林默', aliases: ['阿默'], attributes: { role: 'protagonist' },
  }, { runId: 'character-proposal', sources: [{ location: { id: 'chapter-1', kind: 'chapter' }, quote: '林默走进院门', confidence: 1 }] });
  const confirmedCharacter = await assets.confirmCandidate(characterCandidate.candidateId, 'confirm-character');
  assert.equal(confirmedCharacter.version, 2);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM entities WHERE id=?', 'asset:character:林默'))?.['count']), 1);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM entities WHERE id=?', 'asset:book-outline:new'))?.['count'] ?? 0), 0);

  // task 6.1：规划专家只生成待确认候选；确认后仅人物/世界观同步 Story Bible。
  assert.equal(planningAssetKindFor('concept-generator', 'concept'), 'concept');
  assert.equal(planningAssetKindFor('worldbuilding', 'worldbuilding'), 'worldbuilding');
  assert.equal(planningAssetKindFor('character-generator', 'character-design'), 'character');
  assert.equal(planningAssetKindFor('scene-outliner', 'scene-outline'), 'scene-outline');
  assert.equal(planningAssetKindFor('architect', 'book-outline'), 'book-outline');
  assert.equal(planningAssetKindFor('architect', 'chapter-plan'), 'chapter-plan');
  assert.equal(planningAssetScopeKind('chapter-plan'), 'chapter');
  assert.equal(planningAssetScopeKind('concept'), 'project');
  const planningKinds = ['concept', 'worldbuilding', 'book-outline', 'chapter-plan', 'scene-outline'] as const;
  for (const [index, kind] of planningKinds.entries()) {
    const assetId = `planning-${kind}`;
    await assets.create({
      assetId, projectId: 'project-new', kind,
      scope: kind === 'chapter-plan' || kind === 'scene-outline'
        ? { kind: 'project', projectId: 'project-new' }
        : { kind: 'project', projectId: 'project-new' },
      content: {}, status: 'draft', provenance: { runId: 'planning-seed' },
    });
    const proposal = await assets.createCandidate(assetId, { draft: `规划产出-${index}` }, {
      runId: `planning-${kind}-run`, authorClarification: '待作者确认',
    });
    assert.equal(proposal.status, 'pending');
    assert.deepEqual((await assets.get(assetId))?.content, {});
  }
  const worldbuilding = await assets.create({
    assetId: 'worldbuilding-asset', projectId: 'project-new', kind: 'worldbuilding',
    scope: { kind: 'project', projectId: 'project-new' }, content: {}, status: 'draft', provenance: { runId: 'seed' },
  });
  const worldbuildingCandidate = await assets.createCandidate(worldbuilding.assetId, {
    canonicalName: '霜原', attributes: { climate: '寒冷' },
  }, { runId: 'worldbuilding-proposal', sources: [{ location: { id: 'project-new', kind: 'project' }, quote: '研究来源', confidence: 1 }] });
  await assets.confirmCandidate(worldbuildingCandidate.candidateId, 'confirm-worldbuilding');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM entities WHERE id=?', 'asset:worldbuilding:霜原'))?.['count']), 1);
  const researchArtifacts = new ResearchArtifactRepository(db);
  const artifact = await researchArtifacts.create({
    artifactId: 'research-artifact-6-1', projectId: 'project-new', content: '带来源的研究结论',
    source: 'researcher', sourceVersion: 'research-run-v1', runId: 'research-run-v1',
    workflowId: 'new-book', stageId: String(newBook?.currentStageId),
  });
  assert.equal(artifact.source, 'researcher');
  assert.equal(artifact.sourceVersion, 'research-run-v1');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM creative_assets WHERE asset_id=?', artifact.artifactId))?.['count'] ?? 0), 0);

  const atomic = await assets.createCandidate('outline', { title: 'atomic' }, { runId: 'atomic' });
  await db.exec(`CREATE TRIGGER fail_candidate_confirm BEFORE UPDATE OF status ON creative_asset_candidates
    WHEN NEW.candidate_id='${atomic.candidateId}' AND NEW.status='confirmed' BEGIN SELECT RAISE(ABORT, 'forced confirm failure'); END`);
  await assert.rejects(assets.confirmCandidate(atomic.candidateId, 'confirm-atomic'), /forced confirm failure/);
  assert.equal((await assets.get('outline'))?.version, confirmed.version);
  assert.equal((await assets.getCandidate(atomic.candidateId))?.status, 'pending');
  await db.exec('DROP TRIGGER fail_candidate_confirm');

  const rejected = await assets.createCandidate('outline', { title: 'never' }, { runId: 'proposal-2' });
  await assets.rejectCandidate(rejected.candidateId, 'reject-outline');
  await assets.rejectCandidate(rejected.candidateId, 'reject-outline');
  assert.equal((await assets.getCandidate(rejected.candidateId))?.status, 'rejected');
  assert.deepEqual((await assets.get('outline'))?.content, { title: 'new' });

  // task 4.6：Main 边界校验——伪造归属、过期版本与不允许动作经 application service 命令入口拒绝。
  // 使用仍 active 的 new-book-next-chapter（当前处于 chapter-plan）。
  const boundary = await workflows.get('new-book-next-chapter');
  assert.ok(boundary !== null && boundary.currentStageId !== null);
  // 伪造 workflowRef.stageId（不属于该 workflow 任何阶段）。
  await assert.rejects(service.command({
    type: 'workflow-skip-stage', workflowId: 'new-book-next-chapter', expectedVersion: boundary.version,
    workflowRef: { workflowId: 'new-book-next-chapter', stageId: 'forged-stage' },
    requestId: 'req-forged-ref', operationId: 'op-forged-ref',
  }), /workflowRef does not belong/);
  // workflowRef.stageId 存在但非当前阶段（借用另一阶段的稳定 id）。
  const nonCurrentStage = boundary.stages.find((stage) => stage.stageId !== boundary.currentStageId);
  assert.ok(nonCurrentStage !== undefined);
  await assert.rejects(service.command({
    type: 'workflow-skip-stage', workflowId: 'new-book-next-chapter', expectedVersion: boundary.version,
    workflowRef: { workflowId: 'new-book-next-chapter', stageId: nonCurrentStage.stageId },
    requestId: 'req-noncurrent-ref', operationId: 'op-noncurrent-ref',
  }), /must equal current stage/);
  // 过期版本：expectedVersion 落后于实例真实 version。
  await assert.rejects(service.command({
    type: 'workflow-skip-stage', workflowId: 'new-book-next-chapter', expectedVersion: boundary.version - 1,
    requestId: 'req-stale-version', operationId: 'op-stale-version',
  }), /version conflict/);
  // command.stageId 与当前阶段不一致同样被拒。
  await assert.rejects(service.command({
    type: 'workflow-skip-stage', workflowId: 'new-book-next-chapter', expectedVersion: boundary.version,
    stageId: nonCurrentStage.stageId, requestId: 'req-stage-mismatch', operationId: 'op-stage-mismatch',
  }), /command.stageId must equal current stage/);
  // 归属不存在的 workflow。
  await assert.rejects(service.command({
    type: 'workflow-skip-stage', workflowId: 'no-such-workflow', expectedVersion: 1,
    requestId: 'req-missing-workflow', operationId: 'op-missing-workflow',
  }), /workflow not found/);
  // 跨项目伪造 asset 归属：outline 属 project-new，不属于 legacy 工作流项目。
  await assert.rejects(service.command({
    type: 'workflow-change-asset', workflowId: 'legacy', assetId: 'outline', content: { title: 'x' },
    expectedVersion: (await workflows.get('legacy'))?.version ?? 0,
    requestId: 'req-cross-project-asset', operationId: 'op-cross-project-asset',
  }), /asset does not belong to workflow project/);

  // task 4.6：continuation 判别联合——resolveContinuation 校验 decision 与精确归属（standalone/workflow/issue/asset）。
  const workflowRecord: InterruptContinuationRecord = {
    interruptId: 'int-1', scope: { kind: 'workflow', workflowRef: { workflowId: 'w', stageId: 's' }, runId: 'r' },
    sourceNode: 'writer', continuation: { kind: 'resume-source-node', sourceNode: 'writer' },
    allowedDecisionKinds: ['correct', 'modify'], createdAt: new Date().toISOString(),
  };
  // 不允许的 decision → decision-not-allowed。
  assert.deepEqual(resolveContinuation(workflowRecord, 'delete', workflowRecord.scope), { ok: false, reason: 'decision-not-allowed' });
  // scope 精确匹配 → ok，返回持久化的 continuation。
  assert.deepEqual(resolveContinuation(workflowRecord, 'modify', workflowRecord.scope), { ok: true, continuation: workflowRecord.continuation });
  // 同 kind 但 stageId 不同 → scope-mismatch。
  const wrongStage: ContinuationScope = { kind: 'workflow', workflowRef: { workflowId: 'w', stageId: 'other' }, runId: 'r' };
  assert.deepEqual(resolveContinuation(workflowRecord, 'modify', wrongStage), { ok: false, reason: 'scope-mismatch' });
  // kind 不同（standalone vs workflow）→ scope-mismatch。
  const standaloneScope: ContinuationScope = { kind: 'standalone', runId: 'r' };
  assert.deepEqual(resolveContinuation(workflowRecord, 'modify', standaloneScope), { ok: false, reason: 'scope-mismatch' });
  // standalone 记录与相同 standalone scope 匹配 → ok（standalone resume 兼容）。
  const standaloneRecord: InterruptContinuationRecord = {
    interruptId: 'int-2', scope: standaloneScope, sourceNode: 'writer',
    continuation: { kind: 'resume-source-node', sourceNode: 'writer' }, allowedDecisionKinds: ['correct'], createdAt: new Date().toISOString(),
  };
  assert.deepEqual(resolveContinuation(standaloneRecord, 'correct', standaloneScope), { ok: true, continuation: standaloneRecord.continuation });
  // issue scope 携带 issueId，issueId 不同 → scope-mismatch。
  const issueRecord: InterruptContinuationRecord = {
    interruptId: 'int-3', scope: { kind: 'issue', workflowRef: { workflowId: 'w', stageId: 's', issueId: 'i1' }, issueId: 'i1', runId: 'r' },
    sourceNode: 'reviewer', continuation: { kind: 'resume-issue-fix', issueId: 'i1' }, allowedDecisionKinds: ['modify'], createdAt: new Date().toISOString(),
  };
  const otherIssueScope: ContinuationScope = { kind: 'issue', workflowRef: { workflowId: 'w', stageId: 's', issueId: 'i2' }, issueId: 'i2', runId: 'r' };
  assert.deepEqual(resolveContinuation(issueRecord, 'modify', otherIssueScope), { ok: false, reason: 'scope-mismatch' });
  assert.deepEqual(resolveContinuation(issueRecord, 'modify', issueRecord.scope), { ok: true, continuation: issueRecord.continuation });
  // asset scope 按 assetId/changeSetId 匹配。
  const assetScope: ContinuationScope = { kind: 'asset', assetId: 'a1', changeSetId: 'cs1', runId: 'r' };
  const assetRecord: InterruptContinuationRecord = {
    interruptId: 'int-4', scope: assetScope, sourceNode: 'writer',
    continuation: { kind: 'resume-asset-maintenance', assetId: 'a1' }, allowedDecisionKinds: ['modify'], createdAt: new Date().toISOString(),
  };
  assert.deepEqual(resolveContinuation(assetRecord, 'modify', { kind: 'asset', assetId: 'a1', changeSetId: 'cs-other', runId: 'r' }), { ok: false, reason: 'scope-mismatch' });
  assert.deepEqual(resolveContinuation(assetRecord, 'modify', assetScope), { ok: true, continuation: assetRecord.continuation });

  // task 3.7：单项目 active 唯一约束——同一 project 已有 active workflow 时再插入 active 实例
  // 触发 idx_workflow_active_project 部分唯一索引冲突。用独立 project 自建首个 active 实例后重复插入。
  const uniqueProject = 'project-active-unique';
  const firstActive = await workflows.create({
    workflowId: 'active-first', projectId: uniqueProject, kind: 'new-book-creation',
    templateVersion: '1', objective: 'first active', status: 'active', currentStageId: null, stages: [],
  });
  assert.equal(firstActive.status, 'active');
  await assert.rejects(workflows.create({
    workflowId: 'active-second', projectId: uniqueProject, kind: 'new-book-creation',
    templateVersion: '1', objective: 'second active', status: 'active', currentStageId: null, stages: [],
  }), /UNIQUE|constraint/i);
  // 同 project 的非 active（completed）实例不受唯一约束限制，可正常创建。
  const completedSibling = await workflows.create({
    workflowId: 'active-completed-sibling', projectId: uniqueProject, kind: 'new-book-creation',
    templateVersion: '1', objective: 'completed sibling', status: 'completed', currentStageId: null, stages: [],
  });
  assert.equal(completedSibling.status, 'completed');

  // task 3.7：base version 冲突——两个 candidate 基于同一 baseVersion，先确认其一抬高资产版本，
  // 再确认另一个陈旧 candidate 时 baseVersion 已不等于 current，confirmCandidate 抛版本冲突。
  const outlineNow = await assets.get('outline');
  assert.ok(outlineNow !== null);
  const staleCandidate = await assets.createCandidate('outline', { title: 'stale-base' }, { runId: 'stale-base' });
  const freshCandidate = await assets.createCandidate('outline', { title: 'fresh-base' }, { runId: 'fresh-base' });
  assert.equal(staleCandidate.baseVersion, outlineNow.version);
  assert.equal(freshCandidate.baseVersion, outlineNow.version);
  await assets.confirmCandidate(freshCandidate.candidateId, 'confirm-fresh-base');
  await assert.rejects(
    assets.confirmCandidate(staleCandidate.candidateId, 'confirm-stale-base'),
    /version conflict/,
  );
  assert.equal((await assets.getCandidate(staleCandidate.candidateId))?.status, 'pending');
  assert.deepEqual((await assets.get('outline'))?.content, { title: 'fresh-base' });

  // task 3.7：应用重启恢复——用第二个连接重开同一数据库文件，仿真进程重启后从持久化重建实例，
  // 断言 stage 快照、currentStageId、version 与关闭前完全一致（不依赖内存态）。
  const beforeRestart = await workflows.get('new-book');
  assert.ok(beforeRestart !== null);
  const reopened = await openDatabase(join(directory, 'integration.sqlite'));
  if (!reopened.ok) throw new Error(reopened.message);
  try {
    const restarted = new WorkflowRepository(reopened.db);
    const recovered = await restarted.get('new-book');
    assert.ok(recovered !== null);
    assert.equal(recovered.version, beforeRestart.version);
    assert.equal(recovered.currentStageId, beforeRestart.currentStageId);
    assert.equal(recovered.status, beforeRestart.status);
    assert.deepEqual(
      recovered.stages.map((stage) => [stage.stageId, stage.templateStageId, stage.status, stage.impactStatus ?? null]),
      beforeRestart.stages.map((stage) => [stage.stageId, stage.templateStageId, stage.status, stage.impactStatus ?? null]),
    );
    // 重启后单项目 active 唯一约束仍生效（uniqueProject 仅 active-first 为 active）。
    assert.equal((await restarted.getActive(uniqueProject))?.workflowId, 'active-first');
  } finally {
    await reopened.db.close();
  }

  console.log('workflow integration smoke: ok');
} finally {
  await db.close();
  await rm(directory, { recursive: true, force: true });
}
