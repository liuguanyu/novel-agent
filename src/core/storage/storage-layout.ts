/**
 * 本地存储布局契约 (story-workspace tasks 4.1–4.4)
 *
 * spec: project-storage——人类可读、可手改、版本控制友好；正文以 Markdown 落盘；
 * 结构与元数据以显式可读文本存储；稳定标识符持久化且对手改鲁棒、必要时可重建映射。
 *
 * 本文件为类型契约 + 布局常量（无 I/O；实际读写由 main 侧实现层完成）。
 */

/**
 * 工作区磁盘布局约定（相对工作区根目录）。
 * 设计原则：正文=可读 Markdown；元数据/映射=可读文本（JSON），三者均可 diff。
 */
export const WORKSPACE_LAYOUT = {
  /** 元数据文件（书名/体裁/语言等），可读 JSON */
  metadataFile: 'workspace.json',
  /** 章节树 + id↔文件映射清单，可读 JSON（见 ManuscriptManifest） */
  manifestFile: 'manuscript.json',
  /** 正文根目录：卷为子目录、章为 .md 文件（贴合 `津门余味` 习惯） */
  contentDir: 'content',
} as const;

/**
 * 清单中一个节点的持久化条目：把稳定 id 映射到磁盘位置与结构信息。
 * spec「标识符持久化与鲁棒映射」：id 完整保留；映射对手改尽量鲁棒。
 */
export interface ManifestEntry {
  /** 稳定唯一 id（持久化的锚点，重开后不变） */
  id: string;
  /** 层级 */
  kind: 'volume' | 'chapter' | 'scene';
  /** 展示标题 */
  title: string;
  /** 同级顺序 */
  order: number;
  /** 父节点 id（顶层为 null） */
  parentId: string | null;
  /**
   * 正文文件相对 contentDir 的路径（卷为目录、无正文文件时为 null）。
   * 手改移动/重命名文件后此路径可能失配 → 触发重建（见 RemapDetection）。
   */
  relativePath: string | null;
  /**
   * 内容指纹（如正文 hash）。用于手改后按内容而非路径重新定位，
   * 是“鲁棒映射/重建”的依据（spec「手工改动后可重建映射」）。
   */
  contentHash?: string;
}

/** 章节树 + 映射的完整清单（落为 manifestFile）。 */
export interface ManuscriptManifest {
  /** 清单结构版本，便于向后兼容演进 */
  version: number;
  /** 全部节点条目（含层级与映射） */
  entries: ReadonlyArray<ManifestEntry>;
}
