/**
 * 审校卡片 → 原文连线覆盖层 (review-findings-ui)
 *
 * 绝对定位、穿透点击的 SVG 层：测量当前选中审校卡片（data-finding-id）右缘与正文高亮文本
 * （data-review-highlight）左缘的视口坐标，画一条按严重度着色的二次贝塞尔曲线连接二者。
 * 随任一侧滚动/窗口尺寸变化经 rAF 节流重算；任一端缺失即不渲染（不画悬空线）。
 */

import { useEffect, useState } from 'react';
import type { ConsistencyIssueDto } from '../../shared/ipc/index.js';
import { findingCardId } from './FindingsPanel.js';

/** 严重度 → 连线颜色（取语义 token，明暗自适应）。 */
const SEVERITY_STROKE: Record<ConsistencyIssueDto['severity'], string> = {
  critical: 'var(--destructive)',
  warning: 'oklch(0.7 0.16 65)',
  info: 'var(--muted-foreground)',
};

interface ConnectorGeometry {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export function FindingConnector({
  runId,
  index,
  severity,
}: {
  /** 当前选中问题的 runId（无选中则传 undefined）。 */
  runId: string | undefined;
  index: number | undefined;
  /** 选中问题的严重度（决定连线颜色）。 */
  severity: ConsistencyIssueDto['severity'] | undefined;
}): JSX.Element | null {
  const [geo, setGeo] = useState<ConnectorGeometry | null>(null);

  useEffect(() => {
    if (runId === undefined || index === undefined) {
      setGeo(null);
      return;
    }

    let raf = 0;
    let retries = 0;
    const measure = (): void => {
      const card = document.querySelector(`[data-finding-id="${findingCardId(runId, index)}"]`);
      const target = document.querySelector('[data-review-highlight="true"]');
      if (card === null || target === null) {
        setGeo(null);
        // 高亮 DOM 可能晚一两帧才绘制（App effect 后置 dispatch），短重试兼底。
        if (target === null && retries < 20) {
          retries += 1;
          raf = requestAnimationFrame(measure);
        }
        return;
      }
      retries = 0;
      const c = card.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      // 卡片在右栏、原文在中栏：从卡片左缘连到高亮右缘。
      setGeo({
        x1: c.left,
        y1: c.top + c.height / 2,
        x2: t.right,
        y2: t.top + t.height / 2,
      });
    };
    const schedule = (): void => {
      cancelAnimationFrame(raf);
      retries = 0;
      raf = requestAnimationFrame(measure);
    };

    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true); // 捕获阶段接所有滚动容器
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      ro.disconnect();
    };
  }, [runId, index]);

  if (geo === null || severity === undefined) return null;

  const stroke = SEVERITY_STROKE[severity];
  // 二次贝塞尔控制点：取两端中点并向外拱，形成柔和横向连线。
  const midX = (geo.x1 + geo.x2) / 2;
  const path = `M ${geo.x1} ${geo.y1} C ${midX} ${geo.y1}, ${midX} ${geo.y2}, ${geo.x2} ${geo.y2}`;

  return (
    <svg
      className="pointer-events-none fixed inset-0 z-40 h-full w-full"
      aria-hidden
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeDasharray="5 4" opacity={0.85} />
      <circle cx={geo.x1} cy={geo.y1} r={3.5} fill={stroke} />
      <circle cx={geo.x2} cy={geo.y2} r={3.5} fill={stroke} />
    </svg>
  );
}
