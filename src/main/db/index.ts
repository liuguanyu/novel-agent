/**
 * SQLite 持久化层统一导出 (persistence-sqlite)
 *
 * Main-only：数据库服务、schema migrations、checkpoint 存储、事实库存储。
 * Renderer MUST NOT 直接导入本模块（依赖单向 renderer→core→shared，DB 能力仅在 Main）。
 */

export { openDatabase, SqliteDatabase } from './sqlite-database.js';
export type { OpenDbResult, SqlParam, SqlRow } from './sqlite-database.js';
export { MIGRATIONS } from './migrations.js';
export type { Migration } from './migrations.js';
export { SqliteCheckpointer } from './checkpoint-store.js';
export { SqliteFactStore } from './fact-store.js';
export { ResearchArtifactRepository } from './research-artifact-repository.js';
export type { ResearchArtifactRecord } from './research-artifact-repository.js';
export type { AppendVersionOptions } from './fact-store.js';
export { WorkflowRepository, OptimisticVersionConflictError } from './workflow-repository.js';
export type { WorkflowRecord, WorkflowStageRecord, CreateWorkflowInput } from './workflow-repository.js';
export { CreativeAssetRepository, WorkflowIssueRepository } from './creative-asset-repository.js';
export type { CreativeAssetRecord, CreativeAssetCandidate, CreativeAssetDependencyInput, CreativeAssetImpactRecord, ConfirmCandidateResult, AuditIssueInput, WorkflowIssueRefactorApplyInput, WorkflowIssueRefactorApplyRecord } from './creative-asset-repository.js';
export { SqliteStageRunEvidenceRecorder, SqliteContinuationRecordService, assertWorkflowRefOwnership } from './workflow-runtime-persistence.js';
export { TaskRunRepository } from './task-run-repository.js';
export type { TaskAuthorCandidateRecord } from './task-run-repository.js';
