import type { StageImpactStatus, WorkflowRef, WorkflowScope } from './types.js';

export type CreativeAssetKind = 'concept' | 'worldbuilding' | 'character' | 'book-outline' | 'chapter-plan' | 'scene-outline';
export type CreativeAssetStatus = 'draft' | 'confirmed' | 'deprecated' | 'conflicting';
export type CreativeAssetContent = Readonly<Record<string, unknown>>;

export interface CreativeAssetProvenance {
  readonly runId: string;
  readonly authorClarification?: string;
  readonly workflowRef?: WorkflowRef;
  readonly previousVersion?: number;
}

interface CreativeAssetBase {
  readonly assetId: string;
  readonly projectId: string;
  readonly content: CreativeAssetContent;
  readonly version: number;
  readonly status: CreativeAssetStatus;
  readonly provenance: CreativeAssetProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CreativeAsset =
  | (CreativeAssetBase & { readonly kind: 'concept' | 'worldbuilding' | 'book-outline'; readonly scope: Extract<WorkflowScope, { kind: 'project' }> })
  | (CreativeAssetBase & { readonly kind: 'character'; readonly scope: Extract<WorkflowScope, { kind: 'project' }>; readonly storyBibleEntityId?: string })
  | (CreativeAssetBase & { readonly kind: 'chapter-plan'; readonly scope: Extract<WorkflowScope, { kind: 'chapter' }>; readonly manuscriptNodeId: string })
  | (CreativeAssetBase & { readonly kind: 'scene-outline'; readonly scope: Extract<WorkflowScope, { kind: 'chapter' }>; readonly manuscriptNodeId: string });

export type CreativeAssetOperation =
  | { readonly kind: 'set'; readonly path: ReadonlyArray<string | number>; readonly value: unknown; readonly previousValue?: unknown }
  | { readonly kind: 'remove'; readonly path: ReadonlyArray<string | number>; readonly previousValue: unknown };

export type CreativeAssetChangeStatus = 'pending-confirmation' | 'applied' | 'blocked' | 'cancelled' | 'failed';
export interface CreativeAssetChangeSet {
  readonly changeSetId: string;
  readonly assetId: string;
  readonly baseVersion: number;
  readonly operations: ReadonlyArray<CreativeAssetOperation>;
  readonly authorClarification: string;
  readonly sourceRunId: string;
  readonly affectedSummary: string;
  readonly status: CreativeAssetChangeStatus;
  readonly workflowRef?: WorkflowRef;
  readonly createdAt: string;
}

export type AssetDependencyTarget =
  | { readonly kind: 'asset'; readonly assetId: string; readonly version: number }
  | { readonly kind: 'manuscript'; readonly manuscriptNodeId: string }
  | { readonly kind: 'quality-result'; readonly auditRunId: string }
  | { readonly kind: 'workflow-stage'; readonly workflowRef: WorkflowRef };

export interface CreativeAssetDependency {
  readonly dependencyId: string;
  readonly sourceAssetId: string;
  readonly sourceVersion: number;
  readonly target: AssetDependencyTarget;
}

export interface AssetImpact {
  readonly impactId: string;
  readonly target: AssetDependencyTarget;
  readonly status: Exclude<StageImpactStatus, 'none'>;
  readonly reason: string;
  readonly sourceAssetId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
}

export interface AssetImpactSet {
  readonly impactSetId: string;
  readonly assetId: string;
  readonly assetVersion: number;
  readonly impacts: ReadonlyArray<AssetImpact>;
  readonly analyzedAt: string;
}
