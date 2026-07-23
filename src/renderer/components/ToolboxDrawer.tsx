/** 独立工具抽屉：承载专家召唤、看板与动作入口，不承载实时执行流程。 */

import { ChevronUp, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AGENT_CATALOG_ENTRIES,
  type AgentCatalogEntry,
} from '../../core/shell/agent-catalog.js';
import {
  TOOLBOX_BOARD_ITEMS,
  TOOLBOX_ACTION_ITEMS,
  type ToolboxBoardId,
  type ToolboxActionId,
} from '../../core/shell/toolbox-catalog.js';
import { resolveIcon } from '../lib/agent-icons.js';
import type { SummonRequest } from '../hooks/useDialogue.js';

interface ToolboxDrawerProps {
  readonly selectedNodeId: string | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSummon: (request: SummonRequest) => void;
  readonly onOpenBoard: (id: ToolboxBoardId) => void;
  readonly onAction: (id: ToolboxActionId) => void;
}

function buildRequest(
  entry: AgentCatalogEntry,
  selectedNodeId: string | undefined,
): SummonRequest | undefined {
  if (entry.requiresAnchor) {
    if (selectedNodeId === undefined) return undefined;
    return {
      agent: entry.agent,
      mode: entry.defaultMode,
      scope: entry.defaultScope,
      anchorNodeId: selectedNodeId,
    };
  }
  return { agent: entry.agent, mode: entry.defaultMode, scope: entry.defaultScope };
}

function BarRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <span className="w-10 shrink-0 pt-1.5 text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

export function ToolboxDrawer({
  selectedNodeId,
  open,
  onOpenChange,
  onSummon,
  onOpenBoard,
  onAction,
}: ToolboxDrawerProps): JSX.Element {
  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-t border-border bg-card/70 px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <ChevronUp className="size-3.5" aria-hidden />
          工具抽屉
        </span>
        <span className="flex items-center gap-1.5">
          <Wrench className="size-3" aria-hidden />
          召唤专家 · 查阅看板 · 发起动作
        </span>
      </button>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[55vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>工具抽屉</SheetTitle>
            <SheetDescription>召唤专家、查阅业务看板，或对当前内容发起后端操作。</SheetDescription>
          </SheetHeader>

          <div className="space-y-2 px-4 pb-4">
            <BarRow label="召唤">
              {AGENT_CATALOG_ENTRIES.map((entry) => {
                const request = buildRequest(entry, selectedNodeId);
                const disabled = request === undefined;
                const Icon = resolveIcon(entry.icon);
                return (
                  <Button
                    key={entry.agent}
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => request !== undefined && onSummon(request)}
                    title={disabled ? `${entry.label}（需先选中章节）` : `${entry.label} · ${entry.description}`}
                    className="h-7 gap-1 px-2"
                  >
                    <Icon className="size-3.5 text-primary" aria-hidden />
                    <span className="text-xs">{entry.label}</span>
                  </Button>
                );
              })}
            </BarRow>

            <BarRow label="看板">
              {TOOLBOX_BOARD_ITEMS.map((item) => {
                const Icon = resolveIcon(item.icon);
                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenBoard(item.id)}
                    title={item.description}
                    className="h-7 gap-1 px-2"
                  >
                    <Icon className="size-3.5 text-primary" aria-hidden />
                    <span className="text-xs">{item.label}</span>
                  </Button>
                );
              })}
            </BarRow>

            <BarRow label="动作">
              {TOOLBOX_ACTION_ITEMS.map((item) => {
                const disabled = item.requiresAnchor && selectedNodeId === undefined;
                const Icon = resolveIcon(item.icon);
                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onAction(item.id)}
                    title={disabled ? `${item.label}（需先选中章节）` : item.description}
                    className="h-7 gap-1 px-2"
                  >
                    <Icon className="size-3.5 text-primary" aria-hidden />
                    <span className="text-xs">{item.label}</span>
                  </Button>
                );
              })}
            </BarRow>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
