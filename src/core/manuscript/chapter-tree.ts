/**
 * 章节树结构与草稿内容 (story-workspace tasks 2.1, 2.3)
 *
 * spec: manuscript-model「章节树结构」「章节草稿内容」——
 * 卷(可选)→章(必需)→场景(可选)；章是唯一必需层级、章为基本存储单元；
 * 场景为章内逻辑切分；每章(及可选场景)维护可读写的正文草稿。
 *
 * 本文件为类型契约（无 I/O）。
 */

import type { NodeId } from './node-id.js';

/** 所有节点共有的稳定属性。 */
interface NodeBase {
  /** 稳定唯一 id（见 node-id.ts；解耦于标题/顺序/内容） */
  id: NodeId;
  /** 展示标题（可变，不影响 id） */
  title: string;
  /**
   * 同级顺序键。用于确定手足节点排列；调整顺序改 order 而非 id。
   * 与 id 解耦：排序变化 MUST NOT 改变 id。
   */
  order: number;
}

/** 章内场景（可选层级，章内逻辑切分）。 */
export interface SceneNode extends NodeBase {
  kind: 'scene';
  /** 该场景的正文草稿（场景级切分时承载正文片段） */
  draft: ChapterDraft;
}

/**
 * 章（唯一必需层级，正文的基本存储单元）。
 * - 未切分场景时：正文置于本章 `draft`，`scenes` 为空。
 * - 切分场景时：正文逻辑上由 `scenes` 承载；`draft` 可作为整章合并视图/回退。
 */
export interface ChapterNode extends NodeBase {
  kind: 'chapter';
  /** 整章正文草稿（基本存储单元） */
  draft: ChapterDraft;
  /** 可选的场景切分；为空表示本章仅到章级 */
  scenes: ReadonlyArray<SceneNode>;
}

/** 卷（可选层级，章之上的分组）。 */
export interface VolumeNode extends NodeBase {
  kind: 'volume';
  /** 卷下属章 */
  chapters: ReadonlyArray<ChapterNode>;
}

/**
 * 章节树顶层：手足节点可为卷或章。
 * - 分卷作品：顶层为若干 VolumeNode。
 * - 不分卷作品：章 MAY 直接置于顶层（见 spec「章是唯一必需层级」）。
 */
export type TopLevelNode = VolumeNode | ChapterNode;

/** 一本书的完整章节树。 */
export interface ChapterTree {
  /** 顶层节点（卷或章的混合序列，按 order 排列） */
  roots: ReadonlyArray<TopLevelNode>;
}

/**
 * 章/场景的正文草稿内容。
 * spec「章节草稿内容」：经稳定 id 定位、可读可更新、更新后可持久化。
 */
export interface ChapterDraft {
  /** 正文文本（Markdown 落盘，见 project-storage） */
  content: string;
  /**
   * 内容修订计数或时间戳锚点（供 diff/time-travel 参考）。
   * 具体语义由存储/版本层定义；此处仅预留字段。
   */
  revision?: number;
}
