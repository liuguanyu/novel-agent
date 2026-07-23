/**
 * 上下文引用（事实/素材以引用进入状态） (agent-orchestration task 1.4)
 *
 * spec: orchestration-state「上下文以引用进入状态」——事实库与素材库 MUST 以引用（版本/作用域）
 * 进入状态，MUST NOT 将整库内容塞入状态；由节点按需检索（见 design D1、Risks「状态膨胀」）。
 *
 * 本文件为类型契约（无 I/O）。复用 story-bible 的版本标识与 corpus 的作用域，避免重复定义。
 */

import type { FactVersionId } from '../story-bible/versioning.js';
import type { CorpusScope } from '../corpus/corpus-scope.js';

/**
 * 事实库上下文引用：仅携带「读哪个版本」的指针，节点据此按需检索一致视图，
 * 不把 FactView 整体塞进状态。
 */
export interface FactContextRef {
  /** 目标事实库版本（story-bible 的一致视图入口） */
  version: FactVersionId;
}

/**
 * 素材库上下文引用：仅携带检索作用域，节点据此在该作用域内语义检索，
 * 不把素材条目整体塞进状态。
 */
export interface CorpusContextRef {
  /** 检索作用域限定（work/project/global） */
  scope: CorpusScope;
}

/** 汇总的上下文引用槽（进入 NovelState，均为轻量指针）。 */
export interface ContextRefs {
  /** 事实库引用（无则 null） */
  facts: FactContextRef | null;
  /** 素材库引用（无则 null） */
  corpus: CorpusContextRef | null;
}
