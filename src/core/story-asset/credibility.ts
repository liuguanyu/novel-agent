/**
 * 故事资产 — 信息可信度与证据模型 (Roadmap §3.3)
 *
 * 每条提炼结论必须区分可信度等级，保留证据来源，不能悄悄升级为既定事实。
 * 本文件为纯类型定义，无 I/O 逻辑。
 */

/** 可信度等级（从严到松） */
export type CredibilityLevel =
  /** 原文明确：正文或已有设定直接说明 */
  | 'explicit'
  /** 合理推断：根据人物言行、事件和上下文归纳 */
  | 'inferred'
  /** 待作者确认：存在冲突、歧义或多种解释 */
  | 'pending-confirmation'
  /** 待补充设计：现有素材不足，新版大纲需要补齐 */
  | 'pending-design';

/** 资产生命周期状态（Roadmap §10.3 约束 3：草案/作者确认/正式） */
export type AssetStatus =
  /** 草案：模型提炼产出，尚未经作者审阅 */
  | 'draft'
  /** 已确认：作者已审阅并确认 */
  | 'confirmed'
  /** 正式：已采纳为当前正式资产，可被大纲生成和改写消费 */
  | 'formal';

/** 原文证据来源 */
export interface Evidence {
  /** 关联的大纲情节节点 ID */
  readonly plotNodeId?: string;
  /** 关联的章节标题（人话展示） */
  readonly chapterTitle?: string;
  /** 原文引用片段 */
  readonly quote: string;
}

/**
 * 带可信度的结论：故事资产的每一条信息都由值 + 可信度 + 证据组成。
 * 不允许裸值直接进入正式资产——必须经过提炼并标注来源。
 */
export interface CredibleClaim<T> {
  readonly value: T;
  readonly credibility: CredibilityLevel;
  readonly evidence: ReadonlyArray<Evidence>;
  /** 作者补充的说明（裁决理由、修正依据等） */
  readonly authorNote?: string;
}

/** 快速构造一个原文明确的结论 */
export function explicitClaim<T>(value: T, quote: string, plotNodeId?: string): CredibleClaim<T> {
  return { value, credibility: 'explicit', evidence: [{ quote, ...(plotNodeId !== undefined ? { plotNodeId } : {}) }] };
}

/** 快速构造一个合理推断的结论 */
export function inferredClaim<T>(value: T, evidence: ReadonlyArray<Evidence>): CredibleClaim<T> {
  return { value, credibility: 'inferred', evidence };
}

/** 快速构造一个待确认的结论 */
export function pendingConfirmationClaim<T>(value: T, evidence: ReadonlyArray<Evidence>): CredibleClaim<T> {
  return { value, credibility: 'pending-confirmation', evidence };
}

/** 快速构造一个待补充设计的结论 */
export function pendingDesignClaim<T>(value: T): CredibleClaim<T> {
  return { value, credibility: 'pending-design', evidence: [] };
}
