/**
 * Cmd+K 命令面板 (walking-skeleton task 6.5 → I10-A：目录驱动 → I10-C：架构看板查阅入口)
 *
 * 召唤三入口之一（core/shell/command-palette.ts）。产出 core/summon 的统一 SummonCommand 语义，
 * 经对话轴的 summon 通道下发（后端不依赖来源入口）。召唤项由**权威 agent 目录**（core/shell/agent-catalog）
 * 驱动，覆盖 orchestration 已落地的全部专家节点——MUST NOT 硬编码子集而遗漏已落地 agent（见 command-palette spec）。
 * 另提供「架构看板」查阅入口（查阅、非召唤，不产 SummonCommand；看板数据经后端投影查询）。
 */

import { useEffect, useState } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  AGENT_CATEGORY_LABELS,
  AGENT_CATEGORY_ORDER,
  agentsByCategory,
  type AgentCatalogEntry,
} from '../../core/shell/agent-catalog.js';
import { resolveAgentIcon } from '../lib/agent-icons.js';
import type { SummonRequest } from '../hooks/useDialogue.js';

interface CommandPaletteProps {
  /** 当前选中的章节节点 id（作为 node scope 的锚点）。 */
  selectedNodeId: string | undefined;
  /** 发起召唤（收敛为统一 SummonRequest → SummonCommand）。 */
  onSummon: (request: SummonRequest) => void;
  /** 打开架构看板（查阅、非召唤，不产 SummonCommand）。 */
  onOpenBoard: () => void;
}

/** 据目录条目 + 当前锚点构造统一召唤请求；要求锚点却无选中章节时返回 undefined（禁用）。 */
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

export function CommandPalette({ selectedNodeId, onSummon, onOpenBoard }: CommandPaletteProps): JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const run = (entry: AgentCatalogEntry): void => {
    const request = buildRequest(entry, selectedNodeId);
    if (request === undefined) return;
    onSummon(request);
    setOpen(false);
  };

  const openBoard = (): void => {
    onOpenBoard();
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="命令面板" description="召唤专家 agent">
      <CommandInput placeholder="输入以搜索专家…" />
      <CommandList>
        <CommandEmpty>无匹配项。</CommandEmpty>
        <CommandGroup heading="查阅">
          <CommandItem value="架构看板 board 时间线 情节线 人设" onSelect={openBoard}>
            <div className="flex flex-col">
              <span>架构看板</span>
              <span className="text-xs text-muted-foreground">查阅时间线轴 / 并行情节线 / 核心人设集（数据来自后端）</span>
            </div>
          </CommandItem>
        </CommandGroup>
        {AGENT_CATEGORY_ORDER.map((category) => {
          const entries = agentsByCategory(category);
          if (entries.length === 0) return null;
          return (
            <CommandGroup key={category} heading={AGENT_CATEGORY_LABELS[category]}>
              {entries.map((entry) => {
                const disabled = buildRequest(entry, selectedNodeId) === undefined;
                const Icon = resolveAgentIcon(entry.icon);
                return (
                  <CommandItem
                    key={entry.agent}
                    value={`${entry.label} ${entry.agent} ${entry.description}`}
                    disabled={disabled}
                    onSelect={() => run(entry)}
                  >
                    <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                    <div className="flex flex-col">
                      <span>
                        {entry.label}
                        {disabled && (
                          <span className="ml-2 text-xs text-muted-foreground">（需先选中章节）</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{entry.description}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
