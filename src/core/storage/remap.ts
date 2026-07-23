/**
 * 手改后的映射重建契约 (story-workspace task 4.3)
 *
 * spec: project-storage「标识符持久化与鲁棒映射」——
 * 用户在系统外手工移动/重命名正文文件，导致 id↔文件映射受影响时，
 * 打开工作区 MUST 能检测并提供重建途径，MUST NOT 静默丢失或错配已有 id 引用。
 *
 * 本文件为类型契约（无 I/O；检测/重建由 main 侧实现层执行）。
 */

/** 单条映射失配的类型。 */
export type RemapIssueKind =
  | 'missing-file' // 清单登记的文件在磁盘上不存在（被删/移动/改名）
  | 'orphan-file' // 磁盘上存在正文文件但清单无对应 id
  | 'hash-moved'; // 文件内容 hash 命中另一路径（疑似被移动/改名）

/**
 * 一条待处理的映射失配。带足够信息按内容（contentHash）而非路径重连，
 * 保护既有 id 引用不错配。
 */
export interface RemapIssue {
  kind: RemapIssueKind;
  /** 受影响的清单节点 id（orphan-file 情形可能为 null） */
  nodeId: string | null;
  /** 清单记录的旧相对路径（若有） */
  expectedPath?: string;
  /** 磁盘上实际发现的相对路径（若有） */
  actualPath?: string;
  /** 人类可读说明，供 UI 呈现确认 */
  message: string;
}

/** 打开工作区时的映射体检结果。 */
export interface RemapDetection {
  /** 是否完全一致（true 时无需干预） */
  consistent: boolean;
  /** 检出的失配项（非空时向用户提供重建途径） */
  issues: ReadonlyArray<RemapIssue>;
}

/**
 * 用户/系统对某条失配的重建决定。
 * 优先按 contentHash 自动重连；无法确定时降级为用户手动指认。
 */
export interface RemapResolution {
  /** 对应 issue 下标 */
  issueIndex: number;
  /** 将该 id 重新绑定到的相对路径（用户确认或按 hash 自动建议） */
  rebindToPath: string;
}
