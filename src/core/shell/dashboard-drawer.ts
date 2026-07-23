/**
 * 质量仪表盘抽屉 (electron-shell-ui layout-skeleton task 1.4；design D5)
 *
 * spec: layout-skeleton「仪表盘抽屉」——底部抽屉 MUST 承载 global-audit 的健康度评分与按严重度分级的
 * 红黄牌问题列表;点击问题 MUST 经稳定标识符定位并使正文轴滚动至对应节点（一键跳章、防漂移）。
 *
 * 本文件为类型契约（无 I/O、无 UI）。仪表盘数据直接复用 global-audit 的 QualityDashboard/DashboardIssue
 * （不另立模型）;跳章锚点复用 NodeRef;跳章为「上报意图 → 正文轴滚动」，业务定位在后端/编辑层。
 */

import type { NodeRef } from '../manuscript/node-id.js';
import type { QualityDashboard, DashboardIssue } from '../audit/dashboard.js';

/**
 * 抽屉承载的体检结果视图 (task 1.4 / spec「承载体检结果」)。
 * 直接复用 global-audit 的 QualityDashboard（健康度评分 + 按严重度排序的红黄牌列表）;
 * Renderer 只呈现，MUST NOT 重新评分或重排。
 */
export type DashboardDrawerView = QualityDashboard;

/**
 * 一键跳章意图 (task 1.4 / spec「承载体检结果并跳章」)。
 * 点击某问题 → 以其定位锚点（DashboardIssue.jumpTo，稳定标识符）请求正文轴滚动至对应节点。
 * 锚点为 NodeRef（防漂移）;jumpTo 为空的问题不可跳章。
 */
export interface JumpToChapterIntent {
  /** 触发跳章的问题项 */
  readonly issue: DashboardIssue;
  /** 目标节点稳定标识符（取自 issue.jumpTo） */
  readonly target: NodeRef;
}

/**
 * 从仪表盘问题项构造跳章意图 (task 1.4)。纯函数。
 * jumpTo 存在则产出意图，否则返回 null（该问题无可定位锚点，UI 不提供跳章）。
 */
export function toJumpIntent(issue: DashboardIssue): JumpToChapterIntent | null {
  if (issue.jumpTo === null) return null;
  return { issue, target: issue.jumpTo };
}

/**
 * 一键跳章经稳定标识符定位原则 (task 1.4 / spec「点击问题一键跳章」)。
 * 点击问题 MUST 经稳定标识符（NodeRef）定位并使正文轴滚动至对应节点;
 * MUST NOT 以裸文本位置定位（编辑后失效）。此常量为该约束的显式契约标记。
 */
export const JUMP_TO_CHAPTER_VIA_STABLE_ID = true as const;
