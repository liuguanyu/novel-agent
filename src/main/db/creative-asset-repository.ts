import { createHash, randomUUID } from 'node:crypto';
import type { ConsistencyIssue } from '../../core/story-bible/consistency-issue.js';
import {
  transitionWorkflowIssue,
  type WorkflowIssueRecord,
  type WorkflowIssueStatus,
} from '../../core/workflow/issues.js';
import type { SqlRow, SqliteDatabase } from './sqlite-database.js';
import { OptimisticVersionConflictError } from './workflow-repository.js';

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function extractRunId(provenance: unknown): string | null {
  const value = asObject(provenance)?.runId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractClarification(provenance: unknown): string {
  const value = asObject(provenance)?.authorClarification;
  return typeof value === 'string' ? value : '';
}

function diffAssetContent(previous: unknown, next: unknown): ReadonlyArray<Record<string, unknown>> {
  const before = asObject(previous) ?? {};
  const after = asObject(next) ?? {};
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].sort().flatMap((path) => {
    if (!(path in after)) return [{ kind: 'remove', path: [path], previousValue: before[path] }];
    if (JSON.stringify(before[path]) === JSON.stringify(after[path])) return [];
    return [{ kind: 'set', path: [path], value: after[path], previousValue: before[path] }];
  });
}

function storyBibleEntity(content: unknown, kind: string, provenance: unknown): { id: string; type: string; canonicalName: string; provenance: Record<string, unknown> } | null {
  const root = asObject(content);
  const nested = asObject(root?.storyBibleEntity) ?? asObject(root?.entity) ?? root;
  const canonicalName = nested === null || typeof nested.canonicalName !== 'string' ? '' : nested.canonicalName.trim();
  const sources = asObject(provenance)?.sources;
  if (canonicalName.length === 0 || !Array.isArray(sources) || sources.length === 0) return null;
  return { id: typeof nested?.id === 'string' ? nested.id : `asset:${kind}:${canonicalName}`, type: kind === 'character' ? 'person' : 'other', canonicalName, provenance: { sources } };
}

export interface CreativeAssetRecord {
  readonly assetId: string;
  readonly projectId: string;
  readonly kind: string;
  readonly scope: unknown;
  readonly content: unknown;
  readonly version: number;
  readonly status: string;
  readonly provenance: unknown;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type AssetImpactLevel = 'stale' | 'needs-review' | 'conflicting';
export interface CreativeAssetDependencyInput { readonly sourceAssetId: string; readonly sourceVersion: number; readonly dependentAssetId: string; readonly kind: string; readonly targetType?: string; readonly targetId?: string; readonly workflowId?: string; readonly stageId?: string; readonly scope?: unknown; }
export interface CreativeAssetImpactRecord { readonly impactId: string; readonly assetId: string; readonly assetVersion: number; readonly stageId: string | null; readonly targetType: string; readonly targetId: string; readonly status: AssetImpactLevel | 'resolved'; readonly decision: string | null; readonly workflowId: string | null; readonly projectId: string; readonly createdAt: number; }
export interface ConfirmCandidateResult extends CreativeAssetRecord { readonly asset: CreativeAssetRecord; readonly impacts: ReadonlyArray<CreativeAssetImpactRecord>; }

export interface CreativeAssetCandidate {
  readonly candidateId: string;
  readonly assetId: string;
  readonly baseVersion: number;
  readonly content: unknown;
  readonly provenance: unknown;
  readonly status: 'pending' | 'confirmed' | 'rejected';
  readonly changeSetId?: string;
}

export class CreativeAssetRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async get(assetId: string): Promise<CreativeAssetRecord | null> {
    const asset = await this.db.get('SELECT * FROM creative_assets WHERE asset_id=?', assetId);
    if (asset === null) return null;
    const version = await this.db.get(
      'SELECT * FROM creative_asset_versions WHERE asset_id=? AND version=?',
      assetId,
      Number(asset['current_version']),
    );
    return version === null ? null : this.map(asset, version);
  }

  async create(
    input: Omit<CreativeAssetRecord, 'version' | 'createdAt' | 'updatedAt'> & { version?: number },
    operationId?: string,
  ): Promise<CreativeAssetRecord> {
    return this.db.transaction(async (tx) => {
      if (operationId !== undefined) {
        const old = await tx.get('SELECT result_json FROM operation_ids WHERE operation_id=?', operationId);
        if (old !== null) return JSON.parse(String(old['result_json'])) as CreativeAssetRecord;
      }
      const now = Date.now();
      const version = input.version ?? 1;
      await tx.run(
        'INSERT INTO creative_assets(asset_id,project_id,kind,scope_json,current_version,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        input.assetId, input.projectId, input.kind, JSON.stringify(input.scope), version, input.status, now, now,
      );
      await tx.run(
        'INSERT INTO creative_asset_versions(asset_id,version,content_json,provenance_json,status,created_at,operation_id) VALUES(?,?,?,?,?,?,?)',
        input.assetId, version, JSON.stringify(input.content), JSON.stringify(input.provenance), input.status, now,
        operationId ?? null,
      );
      const record: CreativeAssetRecord = { ...input, version, createdAt: now, updatedAt: now };
      if (operationId !== undefined) {
        await tx.run('INSERT INTO operation_ids VALUES(?,?,?,?)', operationId, `asset:${input.assetId}`, JSON.stringify(record), now);
      }
      return record;
    });
  }

  async update(
    assetId: string,
    expectedVersion: number,
    content: unknown,
    status: string,
    provenance: unknown,
    operationId?: string,
  ): Promise<CreativeAssetRecord> {
    return this.db.transaction(async (tx) => {
      if (operationId !== undefined) {
        const old = await tx.get('SELECT result_json FROM operation_ids WHERE operation_id=?', operationId);
        if (old !== null) return JSON.parse(String(old['result_json'])) as CreativeAssetRecord;
      }
      const asset = await tx.get('SELECT * FROM creative_assets WHERE asset_id=?', assetId);
      if (asset === null || Number(asset['current_version']) !== expectedVersion) {
        throw new OptimisticVersionConflictError(`asset:${assetId}`, expectedVersion);
      }
      const version = expectedVersion + 1;
      const now = Date.now();
      await tx.run(
        'INSERT INTO creative_asset_versions VALUES(?,?,?,?,?,?,?)',
        assetId, version, JSON.stringify(content), JSON.stringify(provenance), status, now, operationId ?? null,
      );
      await tx.run('UPDATE creative_assets SET current_version=?,status=?,updated_at=? WHERE asset_id=?', version, status, now, assetId);
      const record: CreativeAssetRecord = {
        assetId,
        projectId: String(asset['project_id']),
        kind: String(asset['kind']),
        scope: JSON.parse(String(asset['scope_json'])) as unknown,
        content,
        version,
        status,
        provenance,
        createdAt: Number(asset['created_at']),
        updatedAt: now,
      };
      if (operationId !== undefined) {
        await tx.run('INSERT INTO operation_ids VALUES(?,?,?,?)', operationId, `asset:${assetId}`, JSON.stringify(record), now);
      }
      return record;
    });
  }

  async createCandidate(assetId: string, content: unknown, provenance: unknown): Promise<CreativeAssetCandidate> {
    return this.db.transaction(async (tx) => {
      const asset = await this.get(assetId);
      if (asset === null) throw new Error('asset not found');
      const candidateId = randomUUID();
      const changeSetId = `asset-change-set:${candidateId}`;
      const operations = diffAssetContent(asset.content, content);
      const now = Date.now();
      const candidate: CreativeAssetCandidate = {
        candidateId, assetId, baseVersion: asset.version, content, provenance, status: 'pending', changeSetId,
      };
      await tx.run(
        'INSERT INTO creative_asset_candidates(candidate_id,asset_id,base_version,content_json,provenance_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        candidateId, assetId, asset.version, JSON.stringify(content), JSON.stringify(provenance), 'pending', now, now,
      );
      await tx.run(
        'INSERT INTO creative_asset_change_sets(change_set_id,asset_id,base_version,operations_json,clarification,source_run_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        changeSetId, assetId, asset.version, JSON.stringify(operations), extractClarification(provenance), extractRunId(provenance), 'pending-confirmation', now, now,
      );
      return candidate;
    });
  }

  async getCandidate(candidateId: string): Promise<CreativeAssetCandidate | null> {
    const row = await this.db.get('SELECT * FROM creative_asset_candidates WHERE candidate_id=?', candidateId);
    if (row === null) return null;
    return {
      candidateId: String(row['candidate_id']), assetId: String(row['asset_id']),
      baseVersion: Number(row['base_version']), content: JSON.parse(String(row['content_json'])) as unknown,
      provenance: JSON.parse(String(row['provenance_json'])) as unknown,
      status: String(row['status']) as CreativeAssetCandidate['status'],
      ...(row['candidate_id'] !== null ? { changeSetId: `asset-change-set:${String(row['candidate_id'])}` } : {}),
    };
  }

  async addDependency(input: CreativeAssetDependencyInput): Promise<void> {
    await this.db.run(`INSERT INTO creative_asset_dependencies
      (asset_id,depends_on_asset_id,dependency_type,asset_version,created_at,target_type,target_id,workflow_id,stage_id,scope_json)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id,depends_on_asset_id,dependency_type) DO UPDATE SET
      asset_version=excluded.asset_version,target_type=excluded.target_type,target_id=excluded.target_id,workflow_id=excluded.workflow_id,stage_id=excluded.stage_id,scope_json=excluded.scope_json`,
    input.dependentAssetId,input.sourceAssetId,input.kind,input.sourceVersion,Date.now(),input.targetType ?? (input.stageId === undefined?'asset':'workflow-stage'),input.targetId ?? input.stageId ?? input.dependentAssetId,input.workflowId ?? null,input.stageId ?? null,JSON.stringify(input.scope ?? {}));
  }

  async listImpacts(assetId: string, assetVersion?: number): Promise<ReadonlyArray<CreativeAssetImpactRecord>> {
    const rows=await this.db.all(`SELECT i.*,a.project_id,d.workflow_id FROM creative_asset_impacts i JOIN creative_assets a ON a.asset_id=i.asset_id LEFT JOIN creative_asset_dependencies d ON d.depends_on_asset_id=i.asset_id AND d.stage_id=i.stage_id AND COALESCE(d.target_id,d.asset_id)=i.target_id WHERE i.asset_id=? AND (? IS NULL OR i.asset_version=?) ORDER BY i.impact_id`,assetId,assetVersion ?? null,assetVersion ?? null);
    return rows.map((row)=>this.mapImpact(row));
  }

  async confirmCandidate(candidateId: string, operationId = `confirm-candidate:${candidateId}`): Promise<ConfirmCandidateResult> {
    return this.db.transaction(async (tx) => {
      const old = await tx.get('SELECT result_json FROM operation_ids WHERE operation_id=?', operationId);
      if (old !== null) return JSON.parse(String(old['result_json'])) as ConfirmCandidateResult;
      const row = await tx.get("SELECT * FROM creative_asset_candidates WHERE candidate_id=? AND status='pending'", candidateId);
      if (row === null) throw new Error('pending asset candidate not found');
      const assetId = String(row['asset_id']);
      const baseVersion = Number(row['base_version']);
      const asset = await tx.get('SELECT * FROM creative_assets WHERE asset_id=?', assetId);
      if (asset === null || Number(asset['current_version']) !== baseVersion) {
        throw new OptimisticVersionConflictError(`asset:${assetId}`, baseVersion);
      }
      const content = JSON.parse(String(row['content_json'])) as unknown;
      const provenance = JSON.parse(String(row['provenance_json'])) as unknown;
      const version = baseVersion + 1;
      const now = Date.now();
      await tx.run(
        'INSERT INTO creative_asset_versions VALUES(?,?,?,?,?,?,?)',
        assetId, version, JSON.stringify(content), JSON.stringify(provenance), 'confirmed', now, operationId,
      );
      await tx.run('UPDATE creative_assets SET current_version=?,status=?,updated_at=? WHERE asset_id=?', version, 'confirmed', now, assetId);
      await tx.run("UPDATE creative_asset_candidates SET status='confirmed',updated_at=? WHERE candidate_id=?", now, candidateId);
      await tx.run("UPDATE creative_asset_change_sets SET status='applied',updated_at=? WHERE change_set_id=?", now, `asset-change-set:${candidateId}`);

      // Only confirmed character/worldbuilding assets may become Story Bible facts.
      // Outline/plan assets remain planning artifacts and are intentionally excluded.
      const kind = String(asset['kind']);
      const fact = (kind === 'character' || kind === 'worldbuilding') ? storyBibleEntity(content, kind, provenance) : null;
      if (fact !== null) {
        const factVersion = randomUUID();
        await tx.run('INSERT INTO fact_versions(id,parent_id,checkpoint_id,created_at) VALUES(?,?,?,?)', factVersion, null, null, now);
        const root = asObject(content);
        const aliases = Array.isArray(root?.aliases) ? root.aliases.filter((item): item is string => typeof item === 'string') : [];
        const rawAttributes = asObject(root?.attributes);
        await tx.run(`INSERT INTO entities(id,type,canonical_name,status,provenance_json,introduced_version,updated_version)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,canonical_name=excluded.canonical_name,status=excluded.status,provenance_json=excluded.provenance_json,updated_version=excluded.updated_version`,
          fact.id, fact.type, fact.canonicalName, 'confirmed', JSON.stringify(fact.provenance), factVersion, factVersion);
        await tx.run('DELETE FROM entity_aliases WHERE entity_id=?', fact.id);
        for (const alias of [fact.canonicalName, ...aliases]) {
          await tx.run('INSERT INTO entity_aliases(entity_id,alias,status,provenance_json,introduced_version) VALUES(?,?,?,?,?)', fact.id, alias, 'confirmed', JSON.stringify(fact.provenance), factVersion);
        }
        await tx.run('DELETE FROM entity_attributes WHERE entity_id=?', fact.id);
        if (rawAttributes !== null) for (const [key, value] of Object.entries(rawAttributes)) {
          await tx.run('INSERT INTO entity_attributes(entity_id,key,value,status,provenance_json,introduced_version) VALUES(?,?,?,?,?,?)', fact.id, key, JSON.stringify(value), 'confirmed', JSON.stringify(fact.provenance), factVersion);
        }
        await tx.run('INSERT INTO fact_changes(version_id,op,kind,target_id,checkpoint_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)', factVersion, 'update', 'entity', fact.id, null, JSON.stringify({ sourceAssetId: assetId, sourceAssetVersion: version }), now);
      }
      const record: CreativeAssetRecord = {
        assetId, projectId: String(asset['project_id']), kind: String(asset['kind']),
        scope: JSON.parse(String(asset['scope_json'])) as unknown, content, version, status: 'confirmed', provenance,
        createdAt: Number(asset['created_at']), updatedAt: now,
      };
      const dependencies=await tx.all(`SELECT * FROM creative_asset_dependencies WHERE depends_on_asset_id=? AND asset_version=? ORDER BY dependency_type,asset_id,target_type,target_id,stage_id`,assetId,baseVersion);
      const impacts: CreativeAssetImpactRecord[]=[];
      for(const dependency of dependencies){
        const level=this.impactLevel(String(dependency['dependency_type']),String(dependency['target_type']),String(dependency['scope_json'])); const targetType=String(dependency['target_type']); const targetId=String(dependency['target_id'] ?? dependency['asset_id']); const stageId=dependency['stage_id']===null?null:String(dependency['stage_id']);
        const identity=[assetId,baseVersion,version,String(dependency['asset_id']),String(dependency['dependency_type']),targetType,targetId,stageId].join('\u0000'); const impactId=`impact:${createHash('sha256').update(identity).digest('hex').slice(0,32)}`;
        await tx.run(`INSERT INTO creative_asset_impacts(impact_id,asset_id,asset_version,stage_id,target_type,target_id,status,decision,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,impactId,assetId,version,stageId,targetType,targetId,level,null,now);
        if(stageId!==null){ const current=await tx.get('SELECT impact_status FROM workflow_stages WHERE stage_id=?',stageId); if(current!==null) await tx.run('UPDATE workflow_stages SET impact_status=?,version=version+1,updated_at=? WHERE stage_id=?',this.maxImpact(current['impact_status']===null?'none':String(current['impact_status']),level),now,stageId); }
        impacts.push({impactId,assetId,assetVersion:version,stageId,targetType,targetId,status:level,decision:null,workflowId:dependency['workflow_id']===null?null:String(dependency['workflow_id']),projectId:String(asset['project_id']),createdAt:now});
      }
      const analysisId=`analysis:${createHash('sha256').update(`${assetId}:${baseVersion}:${version}`).digest('hex').slice(0,32)}`;
      await tx.run('INSERT INTO creative_asset_impact_analyses VALUES(?,?,?,?,?,?)',analysisId,assetId,baseVersion,version,impacts.length,now);
      const result: ConfirmCandidateResult={...record,asset:record,impacts};
      await tx.run('INSERT INTO operation_ids VALUES(?,?,?,?)',operationId,`asset-candidate:${candidateId}`,JSON.stringify(result),now);
      return result;
    });
  }

  async rejectCandidate(candidateId: string, operationId = `reject-candidate:${candidateId}`): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (await tx.get('SELECT 1 FROM operation_ids WHERE operation_id=?', operationId) !== null) return;
      const result = await tx.run(
        "UPDATE creative_asset_candidates SET status='rejected',updated_at=? WHERE candidate_id=? AND status='pending'",
        Date.now(), candidateId,
      );
      if (result.changes !== 1) throw new Error('pending asset candidate not found');
      await tx.run('INSERT INTO operation_ids VALUES(?,?,?,?)', operationId, `asset-candidate:${candidateId}`, JSON.stringify(null), Date.now());
    });
  }

  async resolveImpact(impactId: string, decision: string, operationId = `resolve-impact:${impactId}`, projectId?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (await tx.get('SELECT 1 FROM operation_ids WHERE operation_id=?', operationId) !== null) return;
      const impact = await tx.get(
        `SELECT i.impact_id,i.stage_id FROM creative_asset_impacts i JOIN creative_assets a ON a.asset_id=i.asset_id
         WHERE i.impact_id=? AND (? IS NULL OR a.project_id=?)`, impactId, projectId ?? null, projectId ?? null,
      );
      if (impact === null) throw new Error('asset impact does not belong to workflow project');
      await tx.run("UPDATE creative_asset_impacts SET status='resolved',decision=? WHERE impact_id=?", decision, impactId);
      if(impact['stage_id']!==null){ const stageId=String(impact['stage_id']); const unresolved=await tx.all("SELECT status FROM creative_asset_impacts WHERE stage_id=? AND status!='resolved'",stageId); const status=unresolved.reduce((current,row)=>this.maxImpact(current,String(row['status'])),'none'); await tx.run('UPDATE workflow_stages SET impact_status=?,version=version+1,updated_at=? WHERE stage_id=?',status,Date.now(),stageId); }
      await tx.run('INSERT INTO operation_ids VALUES(?,?,?,?)', operationId, `asset-impact:${impactId}`, JSON.stringify(null), Date.now());
    });
  }

  private impactLevel(kind:string,targetType:string,scopeJson:string):AssetImpactLevel { const scope=JSON.parse(scopeJson) as {impactLevel?:unknown}; if(scope.impactLevel==='stale'||scope.impactLevel==='needs-review'||scope.impactLevel==='conflicting') return scope.impactLevel; if(kind==='conflict'||kind==='semantic-conflict') return 'conflicting'; if(targetType==='workflow-stage'||targetType==='quality-result'||kind==='review') return 'needs-review'; return 'stale'; }
  private maxImpact(left:string,right:string):string { const rank:Readonly<Record<string,number>>={none:0,stale:1,'needs-review':2,conflicting:3}; return (rank[right]??0)>(rank[left]??0)?right:left; }
  private mapImpact(row:SqlRow):CreativeAssetImpactRecord { return {impactId:String(row['impact_id']),assetId:String(row['asset_id']),assetVersion:Number(row['asset_version']),stageId:row['stage_id']===null?null:String(row['stage_id']),targetType:String(row['target_type']),targetId:String(row['target_id']),status:String(row['status']) as CreativeAssetImpactRecord['status'],decision:row['decision']===null?null:String(row['decision']),workflowId:row['workflow_id']===null||row['workflow_id']===undefined?null:String(row['workflow_id']),projectId:String(row['project_id']),createdAt:Number(row['created_at'])}; }

  private map(asset: SqlRow, version: SqlRow): CreativeAssetRecord {
    return {
      assetId: String(asset['asset_id']), projectId: String(asset['project_id']), kind: String(asset['kind']),
      scope: JSON.parse(String(asset['scope_json'])) as unknown,
      content: JSON.parse(String(version['content_json'])) as unknown,
      version: Number(version['version']), status: String(version['status']),
      provenance: JSON.parse(String(version['provenance_json'])) as unknown,
      createdAt: Number(asset['created_at']), updatedAt: Number(asset['updated_at']),
    };
  }
}

export interface AuditIssueInput {
  readonly type: string;
  readonly description: string;
  readonly anchors: ReadonlyArray<{ readonly kind: string; readonly id: unknown }>;
}

function fingerprint(issue: AuditIssueInput): string {
  const anchors = issue.anchors.map((anchor) => `${anchor.kind}:${String(anchor.id)}`).sort();
  const normalizedDescription = issue.description.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(JSON.stringify([issue.type, anchors, normalizedDescription])).digest('hex');
}

function parseStrings(value: unknown): ReadonlyArray<string> {
  return JSON.parse(String(value)) as string[];
}

export interface WorkflowIssueRefactorApplyInput {
  readonly issueId: string;
  readonly refactorRunId: string;
  readonly checkpointId: string;
  readonly anchor: unknown;
  readonly decisions: ReadonlyArray<{ readonly hunkId: string; readonly decision: 'accept' | 'reject' }>;
  readonly acceptedHunkIds: ReadonlyArray<string>;
  readonly baseHash: string;
  readonly resultHash: string;
}

export interface WorkflowIssueRefactorApplyRecord extends WorkflowIssueRefactorApplyInput {
  readonly createdAt: number;
}

export class WorkflowIssueRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async get(issueId: string): Promise<WorkflowIssueRecord | null> {
    return this.getWith(this.db, issueId);
  }

  async getPayload(issueId: string): Promise<ConsistencyIssue | null> {
    const row = await this.db.get('SELECT issue_payload_json FROM workflow_issues WHERE issue_id=?', issueId);
    if (row === null || row['issue_payload_json'] === null) return null;
    return JSON.parse(String(row['issue_payload_json'])) as ConsistencyIssue;
  }

  private async getWith(db: SqliteDatabase, issueId: string): Promise<WorkflowIssueRecord | null> {
    const row = await db.get('SELECT * FROM workflow_issues WHERE issue_id=?', issueId);
    if (row === null) return null;
    const history = await db.all('SELECT * FROM workflow_issue_history WHERE issue_id=? ORDER BY created_at,id', issueId);
    const entries = history.map((entry) => ({
      at: new Date(Number(entry['created_at'])).toISOString(),
      actor: String(entry['actor'] ?? 'system') as 'system' | 'expert' | 'author' | 'quality-gate',
      ...(entry['source_run_id'] === null ? {} : { sourceRunId: String(entry['source_run_id']) }),
      evidenceRefs: entry['evidence_json'] === null ? [] : parseStrings(entry['evidence_json']),
      ...(entry['reason'] === null ? {} : { note: String(entry['reason']) }),
    }));
    const transitions = history.filter((entry) => String(entry['kind']) === 'transition').map((entry) => ({
      ...entries[history.indexOf(entry)]!,
      from: String(entry['reason'] ?? 'open').split('->')[0] as WorkflowIssueStatus,
      to: String(entry['status']) as WorkflowIssueStatus,
    }));
    return {
      issueId, workflowId: String(row['workflow_id']), sourceAuditRunId: String(row['source_audit_run_id']),
      status: String(row['status']) as WorkflowIssueStatus, anchorRefs: parseStrings(row['anchor_refs_json']),
      refactorRunIds: parseStrings(row['refactor_run_ids_json']),
      checkpointIds: (await db.all('SELECT checkpoint_id FROM workflow_issue_checkpoints WHERE issue_id=?', issueId)).map((item) => String(item['checkpoint_id'])),
      verificationRunIds: (await db.all('SELECT verification_run_id FROM workflow_issue_verifications WHERE issue_id=?', issueId)).map((item) => String(item['verification_run_id'])),
      discoveryHistory: entries.filter((_entry, index) => String(history[index]?.['kind']) === 'discovery'),
      auditHistory: entries.filter((_entry, index) => String(history[index]?.['kind']) === 'audit'),
      transitionHistory: transitions,
      resolutionHistory: entries.filter((_entry, index) => String(history[index]?.['kind']) === 'resolution'),
      ...(row['resolution_reason'] === null ? {} : { resolutionReason: String(row['resolution_reason']) }),
    };
  }

  async upsertFromAudit(workflowId: string, auditRunId: string, issues: ReadonlyArray<AuditIssueInput | ConsistencyIssue>): Promise<ReadonlyArray<WorkflowIssueRecord>> {
    return this.db.transaction(async (tx) => {
      const records: WorkflowIssueRecord[] = [];
      for (const issue of issues) {
        const stableFingerprint = fingerprint(issue);
        const existing = await tx.get('SELECT issue_id,status,version FROM workflow_issues WHERE workflow_id=? AND fingerprint=?', workflowId, stableFingerprint);
        const anchors = issue.anchors.map((anchor) => `${anchor.kind}:${String(anchor.id)}`);
        if (existing === null) {
          const issueId = `${workflowId}:${stableFingerprint.slice(0, 24)}`;
          const now = Date.now();
          await tx.run(
            'INSERT INTO workflow_issues(issue_id,workflow_id,source_audit_run_id,status,anchor_refs_json,fingerprint,issue_payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
            issueId, workflowId, auditRunId, 'open', JSON.stringify(anchors), stableFingerprint, JSON.stringify(issue), now, now,
          );
          await this.appendHistory(tx, issueId, 'discovery', 'open', auditRunId, 'quality-gate', anchors);
          const created = await this.getWith(tx, issueId);
          if (created !== null) records.push(created);
        } else {
          const issueId = String(existing['issue_id']);
          const version = Number(existing['version']);
          const changed = await tx.run(
            'UPDATE workflow_issues SET source_audit_run_id=?,anchor_refs_json=?,issue_payload_json=?,updated_at=?,version=version+1 WHERE issue_id=? AND version=?',
            auditRunId, JSON.stringify(anchors), JSON.stringify(issue), Date.now(), issueId, version,
          );
          if (changed.changes !== 1) throw new OptimisticVersionConflictError(`issue:${issueId}`, version);
          await this.appendHistory(tx, issueId, 'audit', String(existing['status']), auditRunId, 'quality-gate', anchors);
          if (String(existing['status']) === 'resolved') {
            await this.transitionWith(tx, issueId, { kind: 'reopen', auditRunId, evidenceRefs: anchors });
          }
          const updated = await this.getWith(tx, issueId);
          if (updated !== null) records.push(updated);
        }
      }
      return records;
    });
  }

  async select(issueId: string, actor: 'author' | 'system' = 'author', runId?: string): Promise<WorkflowIssueRecord> {
    return this.transition(issueId, { kind: 'start-fixing', actor, ...(runId === undefined ? {} : { runId }) });
  }

  async dismiss(issueId: string, reason: string): Promise<WorkflowIssueRecord> {
    return this.transition(issueId, { kind: 'dismiss', reason, actor: 'author' });
  }

  async linkCheckpointAndMarkVerifying(issueId: string, checkpointId: string): Promise<WorkflowIssueRecord> {
    return this.db.transaction(async (tx) => {
      if (await tx.get('SELECT 1 FROM workflow_issue_checkpoints WHERE issue_id=? AND checkpoint_id=?', issueId, checkpointId) !== null) {
        const existing = await this.getWith(tx, issueId);
        if (existing === null) throw new Error('workflow issue not found');
        return existing;
      }
      const issue = await this.transitionWith(tx, issueId, { kind: 'record-checkpoint', checkpointId, actor: 'system' });
      await tx.run('INSERT INTO workflow_issue_checkpoints VALUES(?,?,?)', issueId, checkpointId, Date.now());
      return issue;
    });
  }

  async recordRefactorApplyAndMarkVerifying(input: WorkflowIssueRefactorApplyInput): Promise<WorkflowIssueRecord> {
    return this.db.transaction(async (tx) => {
      const applied = await tx.get(
        'SELECT 1 FROM workflow_issue_refactor_applies WHERE issue_id=? AND refactor_run_id=?',
        input.issueId,
        input.refactorRunId,
      );
      if (applied !== null) {
        const existing = await this.getWith(tx, input.issueId);
        if (existing === null) throw new Error('workflow issue not found');
        return existing;
      }
      const issue = await this.transitionWith(tx, input.issueId, {
        kind: 'record-checkpoint',
        checkpointId: input.checkpointId,
        actor: 'system',
      });
      const createdAt = Date.now();
      await tx.run(
        'INSERT INTO workflow_issue_checkpoints VALUES(?,?,?)',
        input.issueId,
        input.checkpointId,
        createdAt,
      );
      await tx.run(
        `INSERT INTO workflow_issue_refactor_applies
          (issue_id,refactor_run_id,checkpoint_id,anchor_json,decisions_json,accepted_hunk_ids_json,base_hash,result_hash,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`,
        input.issueId,
        input.refactorRunId,
        input.checkpointId,
        JSON.stringify(input.anchor),
        JSON.stringify(input.decisions),
        JSON.stringify(input.acceptedHunkIds),
        input.baseHash,
        input.resultHash,
        createdAt,
      );
      return issue;
    });
  }

  async listRefactorApplies(issueId: string): Promise<ReadonlyArray<WorkflowIssueRefactorApplyRecord>> {
    const rows = await this.db.all(
      'SELECT * FROM workflow_issue_refactor_applies WHERE issue_id=? ORDER BY created_at,refactor_run_id',
      issueId,
    );
    return rows.map((row) => ({
      issueId: String(row['issue_id']),
      refactorRunId: String(row['refactor_run_id']),
      checkpointId: String(row['checkpoint_id']),
      anchor: JSON.parse(String(row['anchor_json'])) as unknown,
      decisions: JSON.parse(String(row['decisions_json'])) as WorkflowIssueRefactorApplyRecord['decisions'],
      acceptedHunkIds: parseStrings(row['accepted_hunk_ids_json']),
      baseHash: String(row['base_hash']),
      resultHash: String(row['result_hash']),
      createdAt: Number(row['created_at']),
    }));
  }

  async recordVerificationAndTransition(issueId: string, runId: string, passed: boolean, equivalentConflict: boolean, evidenceRefs: ReadonlyArray<string>): Promise<WorkflowIssueRecord> {
    return this.db.transaction(async (tx) => {
      if (await tx.get('SELECT 1 FROM workflow_issue_verifications WHERE issue_id=? AND verification_run_id=?', issueId, runId) !== null) {
        const existing = await this.getWith(tx, issueId);
        if (existing === null) throw new Error('workflow issue not found');
        return existing;
      }
      const issue = await this.transitionWith(tx, issueId, { kind: 'verify', runId, passed, equivalentConflict, evidenceRefs });
      await tx.run('INSERT INTO workflow_issue_verifications VALUES(?,?,?,?,?)', issueId, runId, passed && !equivalentConflict ? 'passed' : 'failed', JSON.stringify(evidenceRefs), Date.now());
      return issue;
    });
  }

  async reopen(issueId: string, auditRunId: string, evidenceRefs: ReadonlyArray<string>): Promise<WorkflowIssueRecord> {
    return this.transition(issueId, { kind: 'reopen', auditRunId, evidenceRefs });
  }

  async countBlocking(workflowId: string): Promise<number> {
    const row = await this.db.get("SELECT COUNT(*) AS n FROM workflow_issues WHERE workflow_id=? AND status IN ('open','fixing','verifying')", workflowId);
    return Number(row?.['n'] ?? 0);
  }

  private async transition(issueId: string, command: Parameters<typeof transitionWorkflowIssue>[1]): Promise<WorkflowIssueRecord> {
    return this.db.transaction((tx) => this.transitionWith(tx, issueId, command));
  }

  private async transitionWith(db: SqliteDatabase, issueId: string, command: Parameters<typeof transitionWorkflowIssue>[1]): Promise<WorkflowIssueRecord> {
    const row = await db.get('SELECT version FROM workflow_issues WHERE issue_id=?', issueId);
    const current = await this.getWith(db, issueId);
    if (row === null || current === null) throw new Error('workflow issue not found');
    const version = Number(row['version']);
    const result = transitionWorkflowIssue(current, command, new Date().toISOString());
    if (!result.ok) throw new Error(`issue transition rejected: ${result.reason}`);
    const next = result.issue;
    const changed = await db.run(
      'UPDATE workflow_issues SET status=?,refactor_run_ids_json=?,resolution_reason=?,updated_at=?,version=version+1 WHERE issue_id=? AND version=?',
      next.status, JSON.stringify(next.refactorRunIds), next.resolutionReason ?? null, Date.now(), issueId, version,
    );
    if (changed.changes !== 1) throw new OptimisticVersionConflictError(`issue:${issueId}`, version);
    const last = next.transitionHistory.at(-1);
    if (last !== undefined && last !== current.transitionHistory.at(-1)) {
      await this.appendHistory(db, issueId, 'transition', next.status, last.sourceRunId, last.actor, last.evidenceRefs, `${last.from}->${last.to}`);
    }
    const resolution = next.resolutionHistory.at(-1);
    if (resolution !== undefined && resolution !== current.resolutionHistory.at(-1)) {
      await this.appendHistory(
        db,
        issueId,
        'resolution',
        next.status,
        resolution.sourceRunId,
        resolution.actor,
        resolution.evidenceRefs,
        resolution.note,
      );
    }
    return next;
  }

  private async appendHistory(db: SqliteDatabase, issueId: string, kind: string, status: string, sourceRunId: string | undefined, actor: string, evidence: unknown, reason?: string): Promise<void> {
    await db.run(
      'INSERT INTO workflow_issue_history(issue_id,kind,status,source_run_id,actor,evidence_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?)',
      issueId, kind, status, sourceRunId ?? null, actor, JSON.stringify(evidence), reason ?? null, Date.now(),
    );
  }
}
