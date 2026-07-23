/**
 * 导入解析契约 (story-workspace tasks 3.1–3.4)
 *
 * spec: project-import——两种起点收敛为同一工作区模型；导入保真（逐字保留原文）；
 * 基于标题层级/文件组织推断卷/章边界；歧义或失败降级为人工确认（不静默猜测）；
 * 记录来源路径以便回溯与再导入。
 *
 * 本文件为类型契约（无 I/O；实际扫描/解析由 worker 执行，见 shared/workers）。
 * 以 `津门余味`（卷=目录、章=文件、章内首行 H1「第X章：标题」）为验收参考用例。
 */

import type { NodeKind } from '../manuscript/node-id.js';
import type { ImportAmbiguity } from './import-ambiguity.js';

/** 导入来源根目录及扫描选项。 */
export interface ImportRequest {
  /** 既有小说所在根目录 */
  sourceDir: string;
  /** 仅扫描的文件扩展名（默认 ['.md']） */
  includeExtensions?: ReadonlyArray<string>;
}

/**
 * 单个源文件的记录——来源路径 MUST 保留（spec「记录来源」），
 * 用于回溯、再导入与手改后重建映射。
 */
export interface SourceFileRef {
  /** 相对 sourceDir 的路径（人类可读、可 diff） */
  relativePath: string;
  /** 绝对路径（回溯用） */
  absolutePath: string;
}

/**
 * 边界推断的依据类型——记录“为何判定为卷/章”，供人工确认时向用户解释。
 * - 'directory'：目录层级 → 卷
 * - 'filename'：文件名前缀（第X章）→ 章
 * - 'heading'：文件内 Markdown 标题层级 → 章/场景
 */
export type BoundaryEvidence = 'directory' | 'filename' | 'heading';

/**
 * 推断出的一个候选节点（尚未落为正式 NodeId——导入确认后由存储层分配稳定 id）。
 * 保真：`content` 为源文件正文逐字副本，MUST NOT 在导入阶段改写。
 */
export interface InferredNode {
  /** 推断层级 */
  kind: NodeKind;
  /** 推断标题（取自标题行或文件名，保留原文） */
  title: string;
  /** 解析出的序号（中文数字 → 整数）；无法解析为 null */
  ordinal: number | null;
  /** 推断依据（可多重佐证） */
  evidence: ReadonlyArray<BoundaryEvidence>;
  /** 正文逐字副本（仅章/场景有；卷为 null） */
  content: string | null;
  /** 来源文件（卷可能来自目录，故可选） */
  source?: SourceFileRef;
  /** 子节点（卷→章，章→场景） */
  children: ReadonlyArray<InferredNode>;
}

/** 一次导入解析的结构化产物（未确认前的推断树 + 待办歧义）。 */
export interface ImportParseResult {
  /** 来源根目录 */
  sourceDir: string;
  /** 推断出的顶层节点（卷或章） */
  roots: ReadonlyArray<InferredNode>;
  /** 需人工确认的歧义项（非空时 MUST 先请用户确认，不得静默采用） */
  ambiguities: ReadonlyArray<ImportAmbiguity>;
  /** 无法归类为正文的辅助文件（如 `自省报告.md`），保留供用户处置 */
  unclassified: ReadonlyArray<SourceFileRef>;
}
