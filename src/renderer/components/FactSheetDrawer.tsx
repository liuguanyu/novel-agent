/**
 * 「事实底稿」按需面板 (workflow-guided-workbench task 10.5)
 *
 * 事实抽取从常驻顶部条迁移为按需抽屉：从 Graph 事实阶段芯片、底部实时进展和看板入口打开。
 * 内含既有 FactExtractionPanel（任务会话、结构化冲突裁决、补充要求；技术指标默认折叠），
 * 外加全书事实库（Story Bible）的查阅入口。空闲时展示占位说明，不打扰创作。
 */

import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { FactExtractionPanel } from './FactExtractionPanel.js';

interface FactSheetDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 打开全书事实库（Story Bible 抽屉）。 */
  readonly onOpenBible: () => void;
  /** 既有事实抽取面板的全部属性（状态/裁决/任务会话）。 */
  readonly panelProps: ComponentProps<typeof FactExtractionPanel>;
}

export function FactSheetDrawer({ open, onOpenChange, onOpenBible, panelProps }: FactSheetDrawerProps): JSX.Element {
  const idle = panelProps.state.status === 'idle';
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>事实底稿</SheetTitle>
          <SheetDescription>
            系统从正文核对出的人物、事件、关系与伏笔。冲突需要你裁决后才会写入事实库。
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {idle ? (
            <p className="rounded border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              当前没有进行中的事实核对任务。可以在工具箱里对当前章节或全书发起核对。
            </p>
          ) : (
            <FactExtractionPanel {...panelProps} />
          )}
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={onOpenBible}>
              查看全书事实库
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
