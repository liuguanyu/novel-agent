/**
 * 左导航轴 (walking-skeleton task 5.3, 6.1 → I8 visual-design：token 化 + 卷可折叠
 *   → task-centric-workbench 3.3：任务驱动的多上下文切换)
 *
 * 顶部上下文切换条在「章节 / 问题 / 人物 / 故事线 / 任务产物」间切换：
 * - 章节：真实卷/章层级树，卷可折叠（默认展开），点击章节触发正文轴加载；
 * - 其余四类：后端投影派生的扁平清单（问题来自审校结果、人物/故事线来自事实库、
 *   产物来自任务活动流），点击项复用既有回调（定位章节 / 打开事实库 / 打开任务中心）。
 * Renderer 无业务逻辑：只消费已有投影 DTO 与既有回调，绝不访问 DB/LLM/fs。
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ChapterTreeDto, ChapterTreeNodeDto } from '../../shared/ipc/index.js';

/** 左栏五类上下文标识。 */
export type NavContextId = 'chapters' | 'issues' | 'characters' | 'storylines' | 'artifacts';

/** 非章节上下文的扁平清单条目（由 App 从投影 DTO 预派生 + 绑定既有回调）。 */
export interface NavListEntry {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  /** 右侧徽标（严重度 / 状态 / 产物类别）。 */
  readonly badge?: string;
  readonly badgeTone?: 'critical' | 'warning' | 'info' | 'muted';
  /** 是否当前选中（如已选审校问题）。 */
  readonly active?: boolean;
  /** 点击回调（定位章节 / 打开抽屉 / 打开任务中心）。 */
  readonly onClick: () => void;
}

interface NavAxisProps {
  tree: ChapterTreeDto | undefined;
  selectedNodeId: string | undefined;
  onSelect: (nodeId: string) => void;
  /** 当前上下文（受控）；不传则默认 'chapters' 并内部自管。 */
  readonly activeContext?: NavContextId;
  readonly onContextChange?: (context: NavContextId) => void;
  /** 四类扁平上下文清单（由 App 派生）。 */
  readonly issues?: ReadonlyArray<NavListEntry>;
  readonly characters?: ReadonlyArray<NavListEntry>;
  readonly storylines?: ReadonlyArray<NavListEntry>;
  readonly artifacts?: ReadonlyArray<NavListEntry>;
}

const CONTEXT_TABS: ReadonlyArray<{ readonly id: NavContextId; readonly label: string }> = [
  { id: 'chapters', label: '章节' },
  { id: 'issues', label: '问题' },
  { id: 'characters', label: '人物' },
  { id: 'storylines', label: '故事线' },
  { id: 'artifacts', label: '产物' },
];

const CONTEXT_EMPTY: Readonly<Record<Exclude<NavContextId, 'chapters'>, string>> = {
  issues: '暂无审校发现的问题。发起审校或全书总检后，问题会汇集到这里。',
  characters: '事实库还没有确认的人物。完成事实核对后，人物会出现在这里。',
  storylines: '事实库还没有登记的伏笔或故事线。',
  artifacts: '当前任务还没有产出可查阅的产物。',
};

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

function badgeClass(tone: NavListEntry['badgeTone']): string {
  switch (tone) {
    case 'critical':
      return 'bg-destructive/15 text-destructive';
    case 'warning':
      return 'bg-amber-500/15 text-amber-600';
    case 'info':
      return 'bg-primary/15 text-primary';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function ListRow({ entry }: { readonly entry: NavListEntry }): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={entry.onClick}
        className={[
          'flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          entry.active ? 'bg-accent font-medium text-accent-foreground' : '',
        ].join(' ')}
      >
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
          {entry.badge !== undefined && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${badgeClass(entry.badgeTone)}`}>
              {entry.badge}
            </span>
          )}
        </div>
        {entry.subtitle !== undefined && entry.subtitle.length > 0 && (
          <span className="truncate text-xs text-muted-foreground">{entry.subtitle}</span>
        )}
      </button>
    </li>
  );
}

export function NavAxis({
  tree,
  selectedNodeId,
  onSelect,
  activeContext,
  onContextChange,
  issues = [],
  characters = [],
  storylines = [],
  artifacts = [],
}: NavAxisProps): JSX.Element {
  const [internalContext, setInternalContext] = useState<NavContextId>('chapters');
  const context = activeContext ?? internalContext;
  const setContext = onContextChange ?? setInternalContext;

  const listByContext: Readonly<Record<Exclude<NavContextId, 'chapters'>, ReadonlyArray<NavListEntry>>> = {
    issues,
    characters,
    storylines,
    artifacts,
  };

  return (
    <nav className="flex h-full flex-col overflow-hidden border-r border-border bg-card">
      <div className="border-b border-border px-3 py-2 font-semibold text-foreground">
        {tree?.title ?? '加载中…'}
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
        {CONTEXT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setContext(tab.id)}
            className={[
              'rounded px-2 py-0.5 text-xs transition-colors',
              context === tab.id
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {context === 'chapters' ? (
          <ul>
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
        ) : listByContext[context].length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{CONTEXT_EMPTY[context]}</p>
        ) : (
          <ul className="space-y-0.5 px-1">
            {listByContext[context].map((entry) => (
              <ListRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
