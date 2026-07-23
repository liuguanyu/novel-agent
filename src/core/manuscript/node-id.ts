/**
 * 稳定唯一节点标识符 (story-workspace tasks 2.2, 2.4)
 *
 * spec: manuscript-model「稳定唯一标识符」——每个卷/章/场景节点拥有稳定且唯一的 id，
 * 与标题、顺序、正文内容解耦：重命名、调序、编辑正文 MUST NOT 改变 id。
 * 该 id 是 bug 定位、事实出处锚点、diff 目标、time-travel 的长期引用锚点。
 *
 * 本文件为类型契约 + 纯 helper（无 I/O）。
 */

/**
 * 节点稳定标识符（对外长期引用锚点）。
 * 以 opaque string 承载；生成策略（如 UUIDv4）由存储层实现，但一经分配即不可变。
 * 使用品牌类型避免与普通 string 混用。
 */
export type NodeId = string & { readonly __brand: 'NodeId' };

/** 节点在树中的层级类别。 */
export type NodeKind = 'volume' | 'chapter' | 'scene';

/**
 * 一个稳定引用锚点：定位到某节点。供 bug/事实/diff/time-travel 跨模块引用。
 * 仅含 id 与 kind——不含标题/顺序/内容，确保引用不因其变化而失效。
 */
export interface NodeRef {
  id: NodeId;
  kind: NodeKind;
}

/** 将已知为合法 id 的字符串标记为 NodeId（纯类型收窄，无副作用）。 */
export function asNodeId(raw: string): NodeId {
  return raw as NodeId;
}

/** 判断两个引用是否指向同一节点（按 id，忽略其它一切）。 */
export function isSameNode(a: NodeRef, b: NodeRef): boolean {
  return a.id === b.id;
}
