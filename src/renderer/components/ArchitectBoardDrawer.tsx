/**
 * 架构看板抽屉 (I10-C architect-board-viz tasks 4.2)
 *
 * 三栏呈现 architect 维护的看板：时间线轴（后端按 tick 排序）/ 并行情节线（伏笔，按状态分组）/ 核心人设集。
 * 数据全部来自后端投影（useArchitectBoard → getArchitectBoard），Renderer 只呈现，MUST NOT 自行计算或排序。
 * 受控组件：open 状态由 App 持有，供顶栏入口与命令面板共享打开。
 */

import { useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useArchitectBoard } from '../hooks/useArchitectBoard.js';
import type {
  StoryBibleEntityDto,
  StoryBiblePlotHookDto,
  StoryBibleTimelineEventDto,
} from '../../shared/ipc/index.js';

interface ArchitectBoardDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const PLOT_STATE_LABEL: Record<StoryBiblePlotHookDto['state'], string> = {
  planted: '已埋设',
  pending: '待回收',
  paid_off: '已回收',
  abandoned: '已作废',
};

const PLOT_STATE_ORDER: ReadonlyArray<StoryBiblePlotHookDto['state']> = [
  'planted',
  'pending',
  'paid_off',
  'abandoned',
];

function TimelineLane({ events }: { events: ReadonlyArray<StoryBibleTimelineEventDto> }): JSX.Element {
  if (events.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无时间线事件。</p>;
  }
  return (
    <ol className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="rounded-md border border-border p-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{event.label}</span>
            <span className="text-xs text-muted-foreground">t{event.tick}</span>
          </div>
          <p className="mt-1 text-foreground">{event.description}</p>
          {event.relatedEntityIds.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              关联：{event.relatedEntityIds.length} 个实体
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function PlotLane({ hooks }: { hooks: ReadonlyArray<StoryBiblePlotHookDto> }): JSX.Element {
  if (hooks.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无情节线。</p>;
  }
  return (
    <div className="space-y-3">
      {PLOT_STATE_ORDER.map((state) => {
        const inState = hooks.filter((hook) => hook.state === state);
        if (inState.length === 0) return null;
        return (
          <section key={state}>
            <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
              {PLOT_STATE_LABEL[state]}（{inState.length}）
            </h4>
            <ul className="space-y-1.5">
              {inState.map((hook) => (
                <li key={hook.id} className="rounded-md border border-border p-2 text-sm">
                  {hook.description}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function EntityLane({ entities }: { entities: ReadonlyArray<StoryBibleEntityDto> }): JSX.Element {
  if (entities.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无人设。</p>;
  }
  return (
    <ul className="space-y-2">
      {entities.map((entity) => (
        <li key={entity.id} className="rounded-md border border-border p-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{entity.canonicalName}</span>
            <span className="text-xs text-muted-foreground">{entity.type}</span>
          </div>
          {entity.aliases.length > 1 && (
            <div className="mt-1 text-xs text-muted-foreground">
              别名：{entity.aliases.filter((a) => a !== entity.canonicalName).join('、')}
            </div>
          )}
          {entity.attributes.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {entity.attributes.slice(0, 4).map((attr) => `${attr.key}=${attr.value}`).join(' · ')}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ArchitectBoardDrawer({ open, onOpenChange }: ArchitectBoardDrawerProps): JSX.Element {
  const { board, loading, error, refresh } = useArchitectBoard();

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[34rem]">
        <SheetHeader>
          <SheetTitle>架构看板</SheetTitle>
          <SheetDescription>
            结构师维护的时间线轴 / 并行情节线 / 核心人设集，数据来自后端 Story Bible 投影。
            {board?.latestVersion !== null && board?.latestVersion !== undefined
              ? ` 版本：${board.latestVersion}`
              : ' 暂无事实版本'}
          </SheetDescription>
        </SheetHeader>

        {error !== undefined && (
          <div className="mx-4 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && board === undefined ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">加载看板中…</div>
        ) : (
          <div className="grid min-h-0 grid-cols-3 gap-4 px-4 pb-4">
            <div className="flex min-h-0 flex-col">
              <h3 className="mb-2 text-sm font-semibold">时间线轴</h3>
              <ScrollArea className="h-[24rem] rounded-md border border-border p-2">
                <TimelineLane events={board?.timeline ?? []} />
              </ScrollArea>
            </div>
            <div className="flex min-h-0 flex-col">
              <h3 className="mb-2 text-sm font-semibold">并行情节线</h3>
              <ScrollArea className="h-[24rem] rounded-md border border-border p-2">
                <PlotLane hooks={board?.plotHooks ?? []} />
              </ScrollArea>
            </div>
            <div className="flex min-h-0 flex-col">
              <h3 className="mb-2 text-sm font-semibold">核心人设集</h3>
              <ScrollArea className="h-[24rem] rounded-md border border-border p-2">
                <EntityLane entities={board?.entities ?? []} />
              </ScrollArea>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
