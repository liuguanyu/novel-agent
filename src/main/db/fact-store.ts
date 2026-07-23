/**
 * 事实库 SQLite 实现 (persistence-sqlite tasks 5.1–5.6)
 *
 * spec: fact-store-runtime / fact-model / fact-versioning——
 * 持久化类型化实体/别名/属性/时间线/关系/伏笔 + 事实版本链；增量非覆盖写入；可关联 checkpoint。
 *
 * 实现 core/story-bible 的 FactStoreReader 契约，并提供最小写入 API（appendVersion + put*）。
 * 本波不做自动抽取/一致性视图算法（I4/I5）；getView 返回当前库中事实并标注请求版本。
 *
 * 复合结构（provenance/aliasSet/timeline 等）以 JSON payload 整存整取；读回经最小结构收窄，禁 any。
 */

import { randomUUID } from 'node:crypto';
import type {
  Entity,
  EntityId,
  FactStoreReader,
  FactView,
  FactVersionId,
  CheckpointId,
  Timeline,
  TimelineEvent,
  Relation,
  RelationPhase,
  PlotHook,
  Provenance,
  AliasSet,
  EntityAttribute,
  FactStatus,
} from '../../core/story-bible/index.js';
import type {
  StoryBibleFactDeleteLocatorDto,
  StoryBibleFactEditDto,
  StoryBibleFactLocatorDto,
} from '../../shared/ipc/index.js';
import { asEntityId, asFactVersionId } from '../../core/story-bible/index.js';
import type { SqliteDatabase, SqlParam, SqlRow } from './sqlite-database.js';

/** 解析 JSON 文本为对象（失败抛错，交上层结构化处理）。 */
function parseJson<T>(text: string, label: string): T {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} payload 非对象`);
  }
  return value as T;
}

/** 追加一个事实版本时的选项。 */
export interface AppendVersionOptions {
  /** 前驱版本（初始为 null） */
  parent?: FactVersionId | null;
  /** 关联 checkpoint（若在某 checkpoint 上下文写入） */
  checkpoint?: CheckpointId | null;
}

/** 事实库存储：读契约（FactStoreReader）+ 最小写入 API。 */
export class SqliteFactStore implements FactStoreReader {
  readonly #db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.#db = db;
  }

  /** 追加一个事实版本（增量非覆盖），返回其版本 id。 */
  async appendVersion(options: AppendVersionOptions = {}): Promise<FactVersionId> {
    const id = asFactVersionId(randomUUID());
    const parent = options.parent ?? null;
    const checkpoint = options.checkpoint ?? null;
    await this.#db.run(
      'INSERT INTO fact_versions (id, parent_id, checkpoint_id, created_at) VALUES (?, ?, ?, ?)',
      id,
      parent,
      checkpoint,
      Date.now(),
    );
    return id;
  }

  /** 记录一条增量变更（只追加，MUST NOT 覆盖历史）。 */
  async #recordChange(
    version: FactVersionId,
    op: 'add' | 'update' | 'delete',
    kind: string,
    targetId: string,
    checkpoint: CheckpointId | null,
    payload: unknown,
  ): Promise<void> {
    await this.#db.run(
      'INSERT INTO fact_changes (version_id, op, kind, target_id, checkpoint_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      version,
      op,
      kind,
      targetId,
      checkpoint,
      payload === undefined ? null : JSON.stringify(payload),
      Date.now(),
    );
  }

  /**
   * 写入/更新一个实体（含别名与属性），并记录增量变更。
   * 已存在则更新 updated_version（不删旧变更记录，保留历史）。
   */
  async putEntity(
    version: FactVersionId,
    entity: Entity,
    checkpoint: CheckpointId | null = null,
  ): Promise<void> {
    await this.#db.transaction(async (tx) => {
      const existing = await tx.get('SELECT id FROM entities WHERE id = ?', entity.id);
      const op = existing === null ? 'add' : 'update';

      await tx.run(
        `INSERT INTO entities (id, type, canonical_name, status, provenance_json, introduced_version, updated_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           canonical_name = excluded.canonical_name,
           status = excluded.status,
           provenance_json = excluded.provenance_json,
           updated_version = excluded.updated_version`,
        entity.id,
        entity.type,
        entity.canonicalName,
        entity.status,
        JSON.stringify(entity.provenance),
        version,
        version,
      );

      // 别名与属性以「先清后插」保持与实体当前态一致（历史仍由 fact_changes 保留）。
      await tx.run('DELETE FROM entity_aliases WHERE entity_id = ?', entity.id);
      for (const alias of entity.aliasSet.aliases) {
        await tx.run(
          'INSERT INTO entity_aliases (entity_id, alias, status, provenance_json, introduced_version) VALUES (?, ?, ?, ?, ?)',
          entity.id,
          alias,
          entity.aliasSet.status,
          JSON.stringify(entity.aliasSet.provenance),
          version,
        );
      }

      await tx.run('DELETE FROM entity_attributes WHERE entity_id = ?', entity.id);
      for (const attr of entity.attributes) {
        await tx.run(
          'INSERT INTO entity_attributes (entity_id, key, value, status, provenance_json, introduced_version) VALUES (?, ?, ?, ?, ?, ?)',
          entity.id,
          attr.key,
          attr.value,
          attr.status,
          JSON.stringify(attr.provenance),
          version,
        );
      }

      await this.#recordChangeTx(tx, version, op, 'entity', entity.id, checkpoint, {
        canonicalName: entity.canonicalName,
      });
    });
  }

  /** 事务内记录变更（复用 #recordChange 逻辑但走同一事务连接）。 */
  async #recordChangeTx(
    tx: SqliteDatabase,
    version: FactVersionId,
    op: 'add' | 'update' | 'delete',
    kind: string,
    targetId: string,
    checkpoint: CheckpointId | null,
    payload: unknown,
  ): Promise<void> {
    await tx.run(
      'INSERT INTO fact_changes (version_id, op, kind, target_id, checkpoint_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      version,
      op,
      kind,
      targetId,
      checkpoint,
      payload === undefined ? null : JSON.stringify(payload),
      Date.now(),
    );
  }

  /** 写入一个时间线事件。 */
  async putTimelineEvent(
    version: FactVersionId,
    event: TimelineEvent,
    checkpoint: CheckpointId | null = null,
  ): Promise<void> {
    await this.#db.run(
      `INSERT INTO timeline_events (id, seq, payload_json, introduced_version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, payload_json = excluded.payload_json`,
      event.id,
      event.at.tick,
      JSON.stringify(event),
      version,
    );
    await this.#recordChange(version, 'add', 'timeline-event', event.id, checkpoint, undefined);
  }

  /** 写入一个关系。 */
  async putRelation(
    version: FactVersionId,
    relation: Relation,
    checkpoint: CheckpointId | null = null,
  ): Promise<void> {
    await this.#db.run(
      `INSERT INTO relations (id, from_entity, to_entity, payload_json, introduced_version)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         from_entity = excluded.from_entity,
         to_entity = excluded.to_entity,
         payload_json = excluded.payload_json`,
      relation.id,
      relation.from,
      relation.to,
      JSON.stringify(relation),
      version,
    );
    await this.#recordChange(version, 'add', 'relation', relation.id, checkpoint, undefined);
  }

  /** 写入一个伏笔。 */
  async putPlotHook(
    version: FactVersionId,
    hook: PlotHook,
    checkpoint: CheckpointId | null = null,
  ): Promise<void> {
    await this.#db.run(
      `INSERT INTO plot_hooks (id, state, payload_json, introduced_version, updated_version)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         payload_json = excluded.payload_json,
         updated_version = excluded.updated_version`,
      hook.id,
      hook.state,
      JSON.stringify(hook),
      version,
      version,
    );
    await this.#recordChange(version, 'add', 'plot-hook', hook.id, checkpoint, undefined);
  }

  /** 组装单个实体（别名 + 属性）。 */
  async #assembleEntity(row: SqlRow): Promise<Entity> {
    const id = asEntityId(String(row['id']));
    const provenance = parseJson<Provenance>(String(row['provenance_json']), 'entity.provenance');

    const aliasRows = await this.#db.all(
      'SELECT alias, status, provenance_json FROM entity_aliases WHERE entity_id = ?',
      id,
    );
    const aliases = aliasRows.map((r) => String(r['alias']));
    const first = aliasRows[0];
    const aliasSet: AliasSet = {
      aliases,
      status: (first !== undefined ? String(first['status']) : String(row['status'])) as FactStatus,
      provenance:
        first !== undefined
          ? parseJson<Provenance>(String(first['provenance_json']), 'alias.provenance')
          : provenance,
    };

    const attrRows = await this.#db.all(
      'SELECT key, value, status, provenance_json FROM entity_attributes WHERE entity_id = ?',
      id,
    );
    const attributes: EntityAttribute[] = attrRows.map((r) => ({
      key: String(r['key']),
      value: String(r['value']),
      status: String(r['status']) as FactStatus,
      provenance: parseJson<Provenance>(String(r['provenance_json']), 'attribute.provenance'),
    }));

    return {
      id,
      type: String(row['type']),
      canonicalName: String(row['canonical_name']),
      aliasSet,
      attributes,
      status: String(row['status']) as FactStatus,
      provenance,
    };
  }

  readonly getEntity = async (
    _version: FactVersionId,
    id: EntityId,
  ): Promise<Entity | null> => {
    const row = await this.#db.get('SELECT * FROM entities WHERE id = ?', id as SqlParam);
    return row === null ? null : this.#assembleEntity(row);
  };

  readonly getView = async (version: FactVersionId): Promise<FactView> => {
    const entityRows = await this.#db.all('SELECT * FROM entities');
    const entities = await Promise.all(entityRows.map((r) => this.#assembleEntity(r)));

    const eventRows = await this.#db.all('SELECT payload_json FROM timeline_events ORDER BY seq');
    const events = eventRows.map((r) =>
      parseJson<TimelineEvent>(String(r['payload_json']), 'timeline-event'),
    );
    const timeline: Timeline = { events };

    const relationRows = await this.#db.all('SELECT payload_json FROM relations');
    const relations = relationRows.map((r) =>
      parseJson<Relation>(String(r['payload_json']), 'relation'),
    );

    const hookRows = await this.#db.all('SELECT payload_json FROM plot_hooks');
    const plotHooks = hookRows.map((r) => parseJson<PlotHook>(String(r['payload_json']), 'plot-hook'));

    return { version, entities, timeline, relations, plotHooks };
  };

  async confirmFact(target: StoryBibleFactLocatorDto): Promise<FactVersionId> {
    const latest = await this.getLatestVersion();
    if (latest === null) throw new Error('事实库为空：无法确认事实');
    const view = await this.getView(latest);
    const version = await this.appendVersion({ parent: latest });

    switch (target.kind) {
      case 'entity': {
        const entity = view.entities.find((item) => item.id === target.entityId);
        if (entity === undefined) throw new Error(`实体不存在：${target.entityId}`);
        await this.putEntity(version, { ...entity, status: 'confirmed' });
        return version;
      }
      case 'entity-attribute': {
        const entity = view.entities.find((item) => item.id === target.entityId);
        if (entity === undefined) throw new Error(`实体不存在：${target.entityId}`);
        const found = entity.attributes.some(
          (attribute) => attribute.key === target.attributeKey && attribute.value === target.attributeValue,
        );
        if (!found) {
          throw new Error(`属性不存在：${target.entityId}.${target.attributeKey}=${target.attributeValue}`);
        }
        const attributes: EntityAttribute[] = entity.attributes.map((attribute) =>
          attribute.key === target.attributeKey && attribute.value === target.attributeValue
            ? { ...attribute, status: 'confirmed' }
            : attribute,
        );
        await this.putEntity(version, { ...entity, attributes });
        return version;
      }
      case 'timeline-event': {
        const event = view.timeline.events.find((item) => item.id === target.eventId);
        if (event === undefined) throw new Error(`时间线事件不存在：${target.eventId}`);
        await this.putTimelineEvent(version, { ...event, status: 'confirmed' });
        return version;
      }
      case 'relation-phase': {
        const relation = view.relations.find((item) => item.id === target.relationId);
        if (relation === undefined) throw new Error(`关系不存在：${target.relationId}`);
        const phase = relation.phases[target.phaseIndex];
        if (phase === undefined) throw new Error(`关系相位不存在：${target.relationId}[${target.phaseIndex}]`);
        const phases: RelationPhase[] = relation.phases.map((item, index) =>
          index === target.phaseIndex ? { ...item, status: 'confirmed' } : item,
        );
        await this.putRelation(version, { ...relation, phases });
        return version;
      }
      case 'plot-hook': {
        const hook = view.plotHooks.find((item) => item.id === target.hookId);
        if (hook === undefined) throw new Error(`伏笔不存在：${target.hookId}`);
        await this.putPlotHook(version, { ...hook, status: 'confirmed' });
        return version;
      }
    }
  }

  async editFact(edit: StoryBibleFactEditDto): Promise<FactVersionId> {
    const latest = await this.getLatestVersion();
    if (latest === null) throw new Error('事实库为空：无法编辑事实');
    const view = await this.getView(latest);
    const version = await this.appendVersion({ parent: latest });

    switch (edit.kind) {
      case 'entity': {
        const entity = view.entities.find((item) => item.id === edit.entityId);
        if (entity === undefined) throw new Error(`实体不存在：${edit.entityId}`);
        const canonicalName = edit.canonicalName?.trim();
        const aliases = edit.aliases?.map((alias) => alias.trim()).filter((alias) => alias.length > 0);
        if ((canonicalName === undefined || canonicalName.length === 0) && aliases === undefined) {
          throw new Error('实体编辑至少需要 canonicalName 或 aliases');
        }
        const nextAliases = aliases !== undefined ? [...new Set(aliases)] : entity.aliasSet.aliases;
        await this.putEntity(version, {
          ...entity,
          ...(canonicalName !== undefined && canonicalName.length > 0 ? { canonicalName } : {}),
          aliasSet: { ...entity.aliasSet, aliases: nextAliases, status: 'confirmed' },
          status: 'confirmed',
        });
        return version;
      }
      case 'entity-attribute': {
        const entity = view.entities.find((item) => item.id === edit.entityId);
        if (entity === undefined) throw new Error(`实体不存在：${edit.entityId}`);
        const found = entity.attributes.some(
          (attribute) => attribute.key === edit.attributeKey && attribute.value === edit.attributeValue,
        );
        if (!found) throw new Error(`属性不存在：${edit.entityId}.${edit.attributeKey}=${edit.attributeValue}`);
        const newKey = edit.newKey?.trim();
        const newValue = edit.newValue?.trim();
        if ((newKey === undefined || newKey.length === 0) && (newValue === undefined || newValue.length === 0)) {
          throw new Error('属性编辑至少需要 newKey 或 newValue');
        }
        const attributes: EntityAttribute[] = entity.attributes.map((attribute) =>
          attribute.key === edit.attributeKey && attribute.value === edit.attributeValue
            ? {
                ...attribute,
                key: newKey !== undefined && newKey.length > 0 ? newKey : attribute.key,
                value: newValue !== undefined && newValue.length > 0 ? newValue : attribute.value,
                status: 'confirmed',
              }
            : attribute,
        );
        await this.putEntity(version, { ...entity, attributes });
        return version;
      }
      case 'timeline-event': {
        const event = view.timeline.events.find((item) => item.id === edit.eventId);
        if (event === undefined) throw new Error(`时间线事件不存在：${edit.eventId}`);
        const description = edit.description?.trim();
        const label = edit.label?.trim();
        if ((description === undefined || description.length === 0) && (label === undefined || label.length === 0) && edit.tick === undefined) {
          throw new Error('时间线编辑至少需要 description、label 或 tick');
        }
        await this.putTimelineEvent(version, {
          ...event,
          ...(description !== undefined && description.length > 0 ? { description } : {}),
          at: {
            ...event.at,
            ...(label !== undefined && label.length > 0 ? { label } : {}),
            ...(edit.tick !== undefined ? { tick: edit.tick } : {}),
          },
          status: 'confirmed',
        });
        return version;
      }
      case 'relation-phase': {
        const relation = view.relations.find((item) => item.id === edit.relationId);
        if (relation === undefined) throw new Error(`关系不存在：${edit.relationId}`);
        const phase = relation.phases[edit.phaseIndex];
        if (phase === undefined) throw new Error(`关系相位不存在：${edit.relationId}[${edit.phaseIndex}]`);
        const kindValue = edit.kindValue?.trim();
        const label = edit.label?.trim();
        if ((kindValue === undefined || kindValue.length === 0) && (label === undefined || label.length === 0) && edit.tick === undefined) {
          throw new Error('关系相位编辑至少需要 kindValue、label 或 tick');
        }
        const phases: RelationPhase[] = relation.phases.map((item, index) =>
          index === edit.phaseIndex
            ? {
                ...item,
                ...(kindValue !== undefined && kindValue.length > 0 ? { kind: kindValue } : {}),
                since: {
                  ...item.since,
                  ...(label !== undefined && label.length > 0 ? { label } : {}),
                  ...(edit.tick !== undefined ? { tick: edit.tick } : {}),
                },
                status: 'confirmed',
              }
            : item,
        );
        await this.putRelation(version, { ...relation, phases });
        return version;
      }
      case 'plot-hook': {
        const hook = view.plotHooks.find((item) => item.id === edit.hookId);
        if (hook === undefined) throw new Error(`伏笔不存在：${edit.hookId}`);
        const description = edit.description?.trim();
        if ((description === undefined || description.length === 0) && edit.state === undefined) {
          throw new Error('伏笔编辑至少需要 description 或 state');
        }
        await this.putPlotHook(version, {
          ...hook,
          ...(description !== undefined && description.length > 0 ? { description } : {}),
          ...(edit.state !== undefined ? { state: edit.state } : {}),
          status: 'confirmed',
        });
        return version;
      }
    }
  }

  /**
   * 删除一条误抽事实（校验存在后创建新版本并移除）。
   * 删除实体时一并移除引用它的关系与其别名/属性，避免悬挂外键。
   */
  async deleteFact(target: StoryBibleFactDeleteLocatorDto): Promise<FactVersionId> {
    const latest = await this.getLatestVersion();
    if (latest === null) throw new Error('事实库为空：无法删除事实');
    const view = await this.getView(latest);

    // 先校验目标存在（MUST NOT 部分写入 / 不产生空版本）。
    switch (target.kind) {
      case 'entity': {
        if (!view.entities.some((item) => item.id === target.entityId)) {
          throw new Error(`实体不存在：${target.entityId}`);
        }
        break;
      }
      case 'entity-attribute': {
        const entity = view.entities.find((item) => item.id === target.entityId);
        if (entity === undefined) throw new Error(`实体不存在：${target.entityId}`);
        const found = entity.attributes.some(
          (attribute) => attribute.key === target.attributeKey && attribute.value === target.attributeValue,
        );
        if (!found) {
          throw new Error(`属性不存在：${target.entityId}.${target.attributeKey}=${target.attributeValue}`);
        }
        break;
      }
      case 'entity-alias': {
        const entity = view.entities.find((item) => item.id === target.entityId);
        if (entity === undefined) throw new Error(`实体不存在：${target.entityId}`);
        if (!entity.aliasSet.aliases.includes(target.alias)) {
          throw new Error(`别名不存在：${target.entityId}.${target.alias}`);
        }
        break;
      }
      case 'timeline-event': {
        if (!view.timeline.events.some((item) => item.id === target.eventId)) {
          throw new Error(`时间线事件不存在：${target.eventId}`);
        }
        break;
      }
      case 'relation': {
        if (!view.relations.some((item) => item.id === target.relationId)) {
          throw new Error(`关系不存在：${target.relationId}`);
        }
        break;
      }
      case 'plot-hook': {
        if (!view.plotHooks.some((item) => item.id === target.hookId)) {
          throw new Error(`伏笔不存在：${target.hookId}`);
        }
        break;
      }
    }

    const version = await this.appendVersion({ parent: latest });
    await this.#db.transaction(async (tx) => {
      switch (target.kind) {
        case 'entity': {
          // 先移除引用该实体的关系，再删别名/属性，最后删实体（外键 ON）。
          await tx.run('DELETE FROM relations WHERE from_entity = ? OR to_entity = ?', target.entityId, target.entityId);
          await tx.run('DELETE FROM entity_aliases WHERE entity_id = ?', target.entityId);
          await tx.run('DELETE FROM entity_attributes WHERE entity_id = ?', target.entityId);
          await tx.run('DELETE FROM entities WHERE id = ?', target.entityId);
          await this.#recordChangeTx(tx, version, 'delete', 'entity', target.entityId, null, undefined);
          break;
        }
        case 'entity-attribute': {
          await tx.run(
            'DELETE FROM entity_attributes WHERE entity_id = ? AND key = ? AND value = ?',
            target.entityId,
            target.attributeKey,
            target.attributeValue,
          );
          await this.#recordChangeTx(tx, version, 'delete', 'attribute', target.entityId, null, {
            key: target.attributeKey,
            value: target.attributeValue,
          });
          break;
        }
        case 'entity-alias': {
          await tx.run(
            'DELETE FROM entity_aliases WHERE entity_id = ? AND alias = ?',
            target.entityId,
            target.alias,
          );
          await this.#recordChangeTx(tx, version, 'delete', 'alias', target.entityId, null, {
            alias: target.alias,
          });
          break;
        }
        case 'timeline-event': {
          await tx.run('DELETE FROM timeline_events WHERE id = ?', target.eventId);
          await this.#recordChangeTx(tx, version, 'delete', 'timeline-event', target.eventId, null, undefined);
          break;
        }
        case 'relation': {
          await tx.run('DELETE FROM relations WHERE id = ?', target.relationId);
          await this.#recordChangeTx(tx, version, 'delete', 'relation', target.relationId, null, undefined);
          break;
        }
        case 'plot-hook': {
          await tx.run('DELETE FROM plot_hooks WHERE id = ?', target.hookId);
          await this.#recordChangeTx(tx, version, 'delete', 'plot-hook', target.hookId, null, undefined);
          break;
        }
      }
    });
    return version;
  }

  /**
   * 把源实体合并进目标实体：并入别名/属性、把引用源实体的关系改指目标、删除源实体。
   * 校验源与目标均存在且互不相同后，创建新版本原子写入。
   */
  async mergeEntities(sourceEntityId: string, targetEntityId: string): Promise<FactVersionId> {
    if (sourceEntityId === targetEntityId) throw new Error('源实体与目标实体不能相同');
    const latest = await this.getLatestVersion();
    if (latest === null) throw new Error('事实库为空：无法合并实体');
    const view = await this.getView(latest);
    const source = view.entities.find((item) => item.id === sourceEntityId);
    if (source === undefined) throw new Error(`源实体不存在：${sourceEntityId}`);
    const target = view.entities.find((item) => item.id === targetEntityId);
    if (target === undefined) throw new Error(`目标实体不存在：${targetEntityId}`);

    // 目标实体并入源的规范名与别名（去重），并合并未重复的属性。
    const mergedAliases = [
      ...new Set([
        ...target.aliasSet.aliases,
        source.canonicalName,
        ...source.aliasSet.aliases,
      ]),
    ];
    const attributeKeyOf = (attribute: EntityAttribute): string => `${attribute.key}\u0000${attribute.value}`;
    const existingAttrKeys = new Set(target.attributes.map(attributeKeyOf));
    const mergedAttributes: EntityAttribute[] = [
      ...target.attributes,
      ...source.attributes.filter((attribute) => !existingAttrKeys.has(attributeKeyOf(attribute))),
    ];

    const version = await this.appendVersion({ parent: latest });

    // 目标实体的别名/属性经 putEntity「先清后插」重建（各自事务，与既有确认/编辑一致）。
    await this.putEntity(version, {
      ...target,
      aliasSet: { ...target.aliasSet, aliases: mergedAliases },
      attributes: mergedAttributes,
    });

    // 改指关系 + 删除源实体，单事务保证外键一致与整体回滚。
    const relationsToRepoint = view.relations.filter(
      (relation) => relation.from === sourceEntityId || relation.to === sourceEntityId,
    );
    await this.#db.transaction(async (tx) => {
      for (const relation of relationsToRepoint) {
        const repointed: Relation = {
          ...relation,
          from: (relation.from === sourceEntityId ? asEntityId(targetEntityId) : relation.from),
          to: (relation.to === sourceEntityId ? asEntityId(targetEntityId) : relation.to),
        };
        await tx.run(
          'UPDATE relations SET from_entity = ?, to_entity = ?, payload_json = ? WHERE id = ?',
          repointed.from,
          repointed.to,
          JSON.stringify(repointed),
          relation.id,
        );
        await this.#recordChangeTx(tx, version, 'update', 'relation', relation.id, null, {
          mergedFrom: sourceEntityId,
          mergedInto: targetEntityId,
        });
      }
      await tx.run('DELETE FROM entity_aliases WHERE entity_id = ?', sourceEntityId);
      await tx.run('DELETE FROM entity_attributes WHERE entity_id = ?', sourceEntityId);
      await tx.run('DELETE FROM entities WHERE id = ?', sourceEntityId);
      await this.#recordChangeTx(tx, version, 'delete', 'entity', sourceEntityId, null, {
        mergedInto: targetEntityId,
      });
    });
    return version;
  }

  /** 取最近一次 appendVersion 的版本 id（按 created_at 降序）。无版本时返回 null。 */
  async getLatestVersion(): Promise<FactVersionId | null> {
    const row = await this.#db.get(
      'SELECT id FROM fact_versions ORDER BY created_at DESC LIMIT 1',
    );
    return row === null ? null : asFactVersionId(String(row['id']));
  }
}
