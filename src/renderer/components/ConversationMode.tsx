/**
 * 对话专注模式 (workflow-guided-workbench task 10.9)
 *
 * 全屏专家对话视图：顶部保留当前专家、当前章节上下文与返回工作台入口，
 * 主体复用工作台右栏的对话轴（召唤/追问/@切换专家/冲突裁决全部可用）。
 * 切换到本模式不中断任何后台任务，也不重置对话状态。
 */

import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './ui/button.js';

interface ConversationModeProps {
  /** 当前会话专家展示名（如「审校 · 诊断」的展示 label）。 */
  expertLabel: string;
  /** 当前章节路径（可空：未选章节时不显示）。 */
  chapterPath: string | undefined;
  onExit: () => void;
  /** 对话主体（由外壳传入 DialogueAxis，避免重复接线 20+ 个 props）。 */
  children: ReactNode;
}

export function ConversationMode({
  expertLabel,
  chapterPath,
  onExit,
  children,
}: ConversationModeProps): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          <ArrowLeft className="size-4" aria-hidden />
          返回工作台
        </Button>
        <div className="min-w-0 text-center text-sm text-muted-foreground">
          正在与 <span className="font-medium text-foreground">{expertLabel}</span> 对话
          {chapterPath !== undefined && (
            <>
              <span className="mx-2 opacity-60">·</span>
              <span className="truncate">{chapterPath}</span>
            </>
          )}
        </div>
        <span className="w-28 shrink-0" aria-hidden />
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">{children}</div>
    </div>
  );
}
