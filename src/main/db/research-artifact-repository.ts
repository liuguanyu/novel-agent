import type { SqliteDatabase } from './sqlite-database.js';

export interface ResearchArtifactRecord {
  readonly artifactId: string;
  readonly projectId: string;
  readonly content: string;
  readonly source: string;
  readonly sourceVersion: string;
  readonly runId: string;
  readonly workflowId?: string;
  readonly stageId?: string;
  readonly createdAt: number;
}

/** Research is durable evidence, not a CreativeAsset or Story Bible fact. */
export class ResearchArtifactRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async create(input: Omit<ResearchArtifactRecord, 'createdAt'>): Promise<ResearchArtifactRecord> {
    const createdAt = Date.now();
    await this.db.run(
      `INSERT INTO research_artifacts
        (artifact_id,project_id,content,source,source_version,run_id,workflow_id,stage_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      input.artifactId,
      input.projectId,
      input.content,
      input.source,
      input.sourceVersion,
      input.runId,
      input.workflowId ?? null,
      input.stageId ?? null,
      createdAt,
    );
    return { ...input, createdAt };
  }
}
