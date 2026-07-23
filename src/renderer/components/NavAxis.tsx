/**
 * 左导航轴 (walking-skeleton task 5.3, 6.1 → I8 visual-design：token 化 + 卷可折叠)
 *
 * 按 core/shell/layout.ts 的 NAV_AXIS_ENTRIES 呈现导航轴入口；章节树显示真实卷/章层级，
 * 点击章节触发正文轴加载。卷（非章节层级节点）可折叠/展开（默认展开）。全部配色走设计 token。
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ChapterTreeDto, ChapterTreeNodeDto } from '../../shared/ipc/index.js';

interface NavAxisProps {
  tree: ChapterTreeDto | undefined;
  selectedNodeId: string | undefined;
  onSelect: (nodeId: string) => void;
}

function TreeNode({
  node,
  depth,
  selectedNodeId,
  onSelect,
}: {
  node: ChapterTreeNodeDto;
  depth: number;
  selectedNodeId: string | undefined;
  onSelect: (nodeId: string) => void;
}): JSX.Element {
  const isChapter = node.kind === 'chapter';
  const isSelected = node.id === selectedNodeId;
  const hasChildren = node.children.length > 0;
  // 卷（非章节层级节点）可折叠；默认展开。章节叶不涉及折叠。
  const [open, setOpen] = useState(true);
  const collapsible = !isChapter && hasChildren;

  const handleClick = (): void => {
    if (isChapter) {
      onSelect(node.id);
    } else if (collapsible) {
      setOpen((v) => !v);
    }
  };

  return (
    <li>
      <button
        type="button"
        disabled={!isChapter && !collapsible}
        onClick={handleClick}
        aria-expanded={collapsible ? open : undefined}
        className={[
          'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
          isChapter
            ? 'cursor-pointer hover:bg-accent hover:text-accent-foreground'
            : collapsible
              ? 'cursor-pointer font-semibold text-muted-foreground hover:bg-accent/60'
              : 'cursor-default font-semibold text-muted-foreground',
          isSelected ? 'bg-accent font-medium text-accent-foreground' : '',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {collapsible ? (
          open ? (
            <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
          )
        ) : (
          !isChapter && <span className="inline-block w-3.5 shrink-0" aria-hidden />
        )}
        <span className="truncate">{node.title}</span>
      </button>
      {hasChildren && open && (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function NavAxis({ tree, selectedNodeId, onSelect }: NavAxisProps): JSX.Element {
  return (
    <nav className="flex h-full flex-col overflow-y-auto border-r border-border bg-card">
      <div className="border-b border-border px-3 py-2 font-semibold text-foreground">
        {tree?.title ?? '加载中…'}
      </div>
      <ul className="flex-1 py-2">
        {tree?.roots.map((root) => (
          <TreeNode
            key={root.id}
            node={root}
            depth={0}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </nav>
  );
}
