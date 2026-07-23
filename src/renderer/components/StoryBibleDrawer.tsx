/** Story Bible 只读查看面板。 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type {
  ProvenanceSourceDto,
  StoryBibleDto,
  StoryBibleEntityDto,
  StoryBibleFactDeleteLocatorDto,
  StoryBibleFactEditDto,
  StoryBibleFactLocatorDto,
  StoryBiblePlotHookDto,
  StoryBibleRelationDto,
  StoryBibleTimelineEventDto,
} from '../../shared/ipc/index.js';
import { useStoryBible } from '../hooks/useStoryBible.js';

function SourceList({ sources }: { sources: ReadonlyArray<ProvenanceSourceDto> }): JSX.Element | null {
  if (sources.length === 0) return null;
  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      {sources.slice(0, 2).map((source, index) => (
        <div key={`${source.location.id}-${index}`} className="rounded bg-muted px-2 py-1">
          <span className="font-mono">{source.location.kind}:{source.location.id}</span>
          <span className="ml-1">{Math.round(source.confidence * 100)}%</span>
          <div className="mt-0.5 text-foreground/80">“{source.quote}”</div>
        </div>
      ))}
    </div>
  );
}

function ConfirmButton({
  disabled,
  onConfirm,
  target,
}: {
  readonly disabled: boolean;
  readonly onConfirm: (target: StoryBibleFactLocatorDto) => void;
  readonly target: StoryBibleFactLocatorDto;
}): JSX.Element {
  return (
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onConfirm(target)}>
      确认
    </Button>
  );
}

function EditButton({ disabled, onClick }: { readonly disabled: boolean; readonly onClick: () => void }): JSX.Element {
  return (
    <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onClick}>
      编辑
    </Button>
  );
}

function DeleteButton({
  disabled,
  onDelete,
  target,
  confirmMessage,
}: {
  readonly disabled: boolean;
  readonly onDelete: (target: StoryBibleFactDeleteLocatorDto) => void;
  readonly target: StoryBibleFactDeleteLocatorDto;
  readonly confirmMessage: string;
}): JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={disabled}
      onClick={() => {
        if (window.confirm(confirmMessage)) onDelete(target);
      }}
    >
      删除
    </Button>
  );
}

function EntityCard({
  entity,
  entities,
  confirming,
  editing,
  deleting,
  merging,
  onConfirm,
  onEdit,
  onDelete,
  onMerge,
}: {
  readonly entity: StoryBibleEntityDto;
  readonly entities: ReadonlyArray<StoryBibleEntityDto>;
  readonly confirming: boolean;
  readonly editing: boolean;
  readonly deleting: boolean;
  readonly merging: boolean;
  readonly onConfirm: (target: StoryBibleFactLocatorDto) => void;
  readonly onEdit: (edit: StoryBibleFactEditDto) => void;
  readonly onDelete: (target: StoryBibleFactDeleteLocatorDto) => void;
  readonly onMerge: (sourceEntityId: string, targetEntityId: string) => void;
}): JSX.Element {
  return (
    <article className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">{entity.canonicalName}</div>
          <div className="text-xs text-muted-foreground">{entity.type} · {entity.status}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">{entity.aliases.length} aliases</div>
          <EditButton
            disabled={editing}
            onClick={() => {
              const canonicalName = window.prompt('实体规范名', entity.canonicalName)?.trim();
              if (canonicalName !== undefined && canonicalName.length > 0 && canonicalName !== entity.canonicalName) {
                onEdit({ kind: 'entity', entityId: entity.id, canonicalName });
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={merging || entities.length < 2}
            onClick={() => {
              const targetName = window.prompt(
                `把「${entity.canonicalName}」合并到哪个实体？输入目标实体的规范名`,
              )?.trim();
              if (targetName === undefined || targetName.length === 0) return;
              const target = entities.find(
                (candidate) =>
                  candidate.id !== entity.id &&
                  (candidate.canonicalName === targetName || candidate.aliases.includes(targetName)),
              );
              if (target === undefined) {
                window.alert(`未找到名为「${targetName}」的目标实体`);
                return;
              }
              if (window.confirm(`确认把「${entity.canonicalName}」合并到「${target.canonicalName}」？源实体将被删除。`)) {
                onMerge(entity.id, target.id);
              }
            }}
          >
            合并
          </Button>
          <DeleteButton
            disabled={deleting}
            onDelete={onDelete}
            target={{ kind: 'entity', entityId: entity.id }}
            confirmMessage={`确认删除实体「${entity.canonicalName}」及其引用关系？`}
          />
          {entity.status !== 'confirmed' && (
            <ConfirmButton
              disabled={confirming}
              onConfirm={onConfirm}
              target={{ kind: 'entity', entityId: entity.id }}
            />
          )}
        </div>
      </div>
      {entity.aliases.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entity.aliases.map((alias) => (
            <span key={alias} className="group inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
              {alias}
              <button
                type="button"
                disabled={deleting}
                className="text-muted-foreground hover:text-destructive"
                title="删除别名"
                onClick={() => {
                  if (window.confirm(`确认删除别名「${alias}」？`)) {
                    onDelete({ kind: 'entity-alias', entityId: entity.id, alias });
                  }
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {entity.attributes.length > 0 && (
        <div className="mt-2 space-y-1 text-xs">
          {entity.attributes.map((attr, index) => (
            <div key={`${attr.key}-${index}`} className="flex items-center justify-between gap-2">
              <div>
                <span className="font-medium">{attr.key}</span>: {attr.value}
                <span className="ml-1 text-muted-foreground">({attr.status})</span>
              </div>
              <div className="flex items-center gap-1">
                <EditButton
                  disabled={editing}
                  onClick={() => {
                    const newValue = window.prompt(`${attr.key} 的新值`, attr.value)?.trim();
                    if (newValue !== undefined && newValue.length > 0 && newValue !== attr.value) {
                      onEdit({
                        kind: 'entity-attribute',
                        entityId: entity.id,
                        attributeKey: attr.key,
                        attributeValue: attr.value,
                        newValue,
                      });
                    }
                  }}
                />
                <DeleteButton
                  disabled={deleting}
                  onDelete={onDelete}
                  target={{
                    kind: 'entity-attribute',
                    entityId: entity.id,
                    attributeKey: attr.key,
                    attributeValue: attr.value,
                  }}
                  confirmMessage={`确认删除属性「${attr.key}: ${attr.value}」？`}
                />
                {attr.status !== 'confirmed' && (
                  <ConfirmButton
                    disabled={confirming}
                    onConfirm={onConfirm}
                    target={{
                      kind: 'entity-attribute',
                      entityId: entity.id,
                      attributeKey: attr.key,
                      attributeValue: attr.value,
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <SourceList sources={entity.sources} />
    </article>
  );
}

function TimelineItem({
  event,
  confirming,
  editing,
  deleting,
  onConfirm,
  onEdit,
  onDelete,
}: {
  readonly event: StoryBibleTimelineEventDto;
  readonly confirming: boolean;
  readonly editing: boolean;
  readonly deleting: boolean;
  readonly onConfirm: (target: StoryBibleFactLocatorDto) => void;
  readonly onEdit: (edit: StoryBibleFactEditDto) => void;
  readonly onDelete: (target: StoryBibleFactDeleteLocatorDto) => void;
}): JSX.Element {
  return (
    <article className="rounded-md border border-border p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">#{event.tick} {event.label}</div>
        <div className="flex items-center gap-1">
          <EditButton
            disabled={editing}
            onClick={() => {
              const description = window.prompt('时间线事件描述', event.description)?.trim();
              if (description !== undefined && description.length > 0 && description !== event.description) {
                onEdit({ kind: 'timeline-event', eventId: event.id, description });
              }
            }}
          />
          <DeleteButton
            disabled={deleting}
            onDelete={onDelete}
            target={{ kind: 'timeline-event', eventId: event.id }}
            confirmMessage={`确认删除时间线事件「${event.label}」？`}
          />
          {event.status !== 'confirmed' && (
            <ConfirmButton
              disabled={confirming}
              onConfirm={onConfirm}
              target={{ kind: 'timeline-event', eventId: event.id }}
            />
          )}
        </div>
      </div>
      <div>{event.description}</div>
      <div className="text-xs text-muted-foreground">{event.status}</div>
      <SourceList sources={event.sources} />
    </article>
  );
}

function RelationItem({
  relation,
  confirming,
  editing,
  deleting,
  onConfirm,
  onEdit,
  onDelete,
}: {
  readonly relation: StoryBibleRelationDto;
  readonly confirming: boolean;
  readonly editing: boolean;
  readonly deleting: boolean;
  readonly onConfirm: (target: StoryBibleFactLocatorDto) => void;
  readonly onEdit: (edit: StoryBibleFactEditDto) => void;
  readonly onDelete: (target: StoryBibleFactDeleteLocatorDto) => void;
}): JSX.Element {
  return (
    <article className="rounded-md border border-border p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{relation.fromName} → {relation.toName}</div>
        <DeleteButton
          disabled={deleting}
          onDelete={onDelete}
          target={{ kind: 'relation', relationId: relation.id }}
          confirmMessage={`确认删除关系「${relation.fromName} → ${relation.toName}」？`}
        />
      </div>
      <div className="text-xs text-muted-foreground">{relation.directionality}</div>
      <div className="mt-1 space-y-1">
        {relation.phases.map((phase, index) => (
          <div key={`${phase.kind}-${index}`} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span>{phase.kind} · #{phase.tick} {phase.label} · {phase.status}</span>
              <div className="flex items-center gap-1">
                <EditButton
                  disabled={editing}
                  onClick={() => {
                    const kindValue = window.prompt('关系类型', phase.kind)?.trim();
                    if (kindValue !== undefined && kindValue.length > 0 && kindValue !== phase.kind) {
                      onEdit({ kind: 'relation-phase', relationId: relation.id, phaseIndex: index, kindValue });
                    }
                  }}
                />
                {phase.status !== 'confirmed' && (
                  <ConfirmButton
                    disabled={confirming}
                    onConfirm={onConfirm}
                    target={{ kind: 'relation-phase', relationId: relation.id, phaseIndex: index }}
                  />
                )}
              </div>
            </div>
            <SourceList sources={phase.sources} />
          </div>
        ))}
      </div>
    </article>
  );
}

function PlotHookItem({
  hook,
  confirming,
  editing,
  deleting,
  onConfirm,
  onEdit,
  onDelete,
}: {
  readonly hook: StoryBiblePlotHookDto;
  readonly confirming: boolean;
  readonly editing: boolean;
  readonly deleting: boolean;
  readonly onConfirm: (target: StoryBibleFactLocatorDto) => void;
  readonly onEdit: (edit: StoryBibleFactEditDto) => void;
  readonly onDelete: (target: StoryBibleFactDeleteLocatorDto) => void;
}): JSX.Element {
  return (
    <article className="rounded-md border border-border p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{hook.description}</div>
        <div className="flex items-center gap-1">
          <EditButton
            disabled={editing}
            onClick={() => {
              const description = window.prompt('伏笔描述', hook.description)?.trim();
              if (description !== undefined && description.length > 0 && description !== hook.description) {
                onEdit({ kind: 'plot-hook', hookId: hook.id, description });
              }
            }}
          />
          <DeleteButton
            disabled={deleting}
            onDelete={onDelete}
            target={{ kind: 'plot-hook', hookId: hook.id }}
            confirmMessage={`确认删除伏笔「${hook.description}」？`}
          />
          {hook.status !== 'confirmed' && (
            <ConfirmButton
              disabled={confirming}
              onConfirm={onConfirm}
              target={{ kind: 'plot-hook', hookId: hook.id }}
            />
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">{hook.state} · {hook.status}</div>
      <SourceList sources={hook.sources} />
    </article>
  );
}

function EmptyState({ bible }: { bible: StoryBibleDto | undefined }): JSX.Element | null {
  if (bible === undefined) return null;
  const empty = bible.entities.length === 0 && bible.timelineEvents.length === 0 && bible.relations.length === 0 && bible.plotHooks.length === 0;
  if (!empty) return null;
  return <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">暂无事实。可先执行“抽取本章事实”或“补抽全书事实”。</div>;
}

export function StoryBibleDrawer({
  open: openProp,
  onOpenChange,
}: {
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
} = {}): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [query, setQuery] = useState('');
  const { bible, loading, confirming, editing, deleting, merging, error, confirmationMessage, refresh, confirmFact, editFact, deleteFact, mergeEntities } = useStoryBible(open);

  const filteredEntities = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (bible === undefined) return [];
    if (q.length === 0) return bible.entities;
    return bible.entities.filter((entity) =>
      entity.canonicalName.toLowerCase().includes(q) ||
      entity.aliases.some((alias) => alias.toLowerCase().includes(q)),
    );
  }, [bible, query]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!controlled && (
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">Story Bible</Button>
        </SheetTrigger>
      )}
      <SheetContent side="right" className="w-[520px] max-w-[90vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Story Bible</SheetTitle>
          <SheetDescription>
            当前事实库视图：{bible?.latestVersion ?? '暂无版本'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center gap-2 px-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="过滤人物/别名…"
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={refresh}>
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </div>

        {error !== undefined && (
          <div className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-sm text-destructive">
            {error}
          </div>
        )}
        {confirmationMessage !== undefined && (
          <div className="mx-4 mt-3 rounded-md border border-border bg-muted px-2 py-1 text-sm text-muted-foreground">
            {confirmationMessage}
          </div>
        )}

        <div className="space-y-5 px-4 py-4">
          <EmptyState bible={bible} />

          <section>
            <h3 className="mb-2 text-sm font-semibold">实体（{filteredEntities.length}）</h3>
            <div className="space-y-2">
              {filteredEntities.map((entity) => (
                <EntityCard
                  key={entity.id}
                  entity={entity}
                  entities={bible?.entities ?? []}
                  confirming={confirming}
                  editing={editing}
                  deleting={deleting}
                  merging={merging}
                  onConfirm={confirmFact}
                  onEdit={editFact}
                  onDelete={deleteFact}
                  onMerge={mergeEntities}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">时间线（{bible?.timelineEvents.length ?? 0}）</h3>
            <div className="space-y-2">
              {bible?.timelineEvents.map((event) => (
                <TimelineItem
                  key={event.id}
                  event={event}
                  confirming={confirming}
                  editing={editing}
                  deleting={deleting}
                  onConfirm={confirmFact}
                  onEdit={editFact}
                  onDelete={deleteFact}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">关系（{bible?.relations.length ?? 0}）</h3>
            <div className="space-y-2">
              {bible?.relations.map((relation) => (
                <RelationItem
                  key={relation.id}
                  relation={relation}
                  confirming={confirming}
                  editing={editing}
                  deleting={deleting}
                  onConfirm={confirmFact}
                  onEdit={editFact}
                  onDelete={deleteFact}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">伏笔（{bible?.plotHooks.length ?? 0}）</h3>
            <div className="space-y-2">
              {bible?.plotHooks.map((hook) => (
                <PlotHookItem
                  key={hook.id}
                  hook={hook}
                  confirming={confirming}
                  editing={editing}
                  deleting={deleting}
                  onConfirm={confirmFact}
                  onEdit={editFact}
                  onDelete={deleteFact}
                />
              ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
