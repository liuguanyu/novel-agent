/**
 * 素材库作用域与挂载 (corpus-library task 1.4)
 *
 * spec: corpus-model「作用域与挂载」——
 * 素材库 MUST 支持跨项目全局仓库，项目 MUST 能选择性挂载；
 * 检索作用域可限定为单篇（work）/项目（project）/全局（global）。
 * 条目可单篇引用或全局引用（见 proposal）。
 *
 * 本文件为类型契约 + Zod 校验 schema（core 层允许纯 schema，无 I/O）。
 * 注：ProjectId/WorkId 为 corpus 内部作用域锚点，与存储层实际标识在实现阶段对接。
 */

import { z } from 'zod';

/** 项目标识（跨项目作用域锚点）。品牌类型避免与普通 string 混用。 */
export type CorpusProjectId = string & { readonly __brand: 'CorpusProjectId' };

/** 单篇作品标识（单篇作用域锚点）。品牌类型避免与普通 string 混用。 */
export type CorpusWorkId = string & { readonly __brand: 'CorpusWorkId' };

/** 将已知为合法项目 id 的字符串标记为 CorpusProjectId（纯类型收窄）。 */
export function asCorpusProjectId(raw: string): CorpusProjectId {
  return raw as CorpusProjectId;
}

/** 将已知为合法作品 id 的字符串标记为 CorpusWorkId（纯类型收窄）。 */
export function asCorpusWorkId(raw: string): CorpusWorkId {
  return raw as CorpusWorkId;
}

/**
 * 条目的归属（residence）：决定其可见性范围。
 * - `global`：进跨项目全局仓库，可被挂载它的任意项目引用。
 * - `project`：项目私有，仅属主项目可见。
 */
export type CorpusResidence =
  | { scope: 'global' }
  | { scope: 'project'; projectId: CorpusProjectId };

/**
 * 检索作用域层级（见 spec「限定检索作用域」）。
 * - `work`：仅单篇作品内的素材
 * - `project`：整个项目内的素材
 * - `global`：跨项目全局仓库（含项目挂载的部分）
 */
export type CorpusScopeLevel = 'work' | 'project' | 'global';

/**
 * 一次检索的作用域限定。系统 MUST 仅在该作用域内返回结果（见 spec）。
 * - `level='global'`：projectId/workId 均可为 null。
 * - `level='project'`：projectId MUST 有值，workId 为 null。
 * - `level='work'`：projectId 与 workId MUST 有值。
 * 以 `| null` 承载「不适用」，与既有 core 契约的风格一致（不用可选属性）。
 */
export interface CorpusScope {
  level: CorpusScopeLevel;
  /** 项目锚点（project/work 层级需要，global 层级为 null） */
  projectId: CorpusProjectId | null;
  /** 单篇锚点（仅 work 层级需要，其余为 null） */
  workId: CorpusWorkId | null;
}

/**
 * 项目对全局素材库的挂载配置（见 spec「跨项目复用」）。
 * 项目 MUST 能选择性挂载全局库或仅用项目私有素材。
 */
export interface CorpusMount {
  /** 挂载方项目 */
  projectId: CorpusProjectId;
  /** 是否挂载全局仓库（false 时仅用项目私有素材） */
  mountsGlobal: boolean;
  /**
   * 可选：将全局挂载范围收窄到特定标签子集（为空/缺省表示全部全局素材）。
   * 用于「只借鉴某类风格样本」等场景，不改变弱参考语义。
   */
  includeTags?: ReadonlyArray<string>;
}

/** 归属 Zod schema（discriminated union，unknown → 强类型）。 */
export const corpusResidenceSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global') }).strict(),
  z.object({ scope: z.literal('project'), projectId: z.string().min(1) }).strict(),
]);

/** 检索作用域 Zod schema（校验来自 UI/IPC 的检索请求作用域）。 */
export const corpusScopeSchema = z
  .object({
    level: z.enum(['work', 'project', 'global']),
    projectId: z.string().min(1).nullable(),
    workId: z.string().min(1).nullable(),
  })
  .strict();

/** 挂载配置 Zod schema。 */
export const corpusMountSchema = z
  .object({
    projectId: z.string().min(1),
    mountsGlobal: z.boolean(),
    includeTags: z.array(z.string()).optional(),
  })
  .strict();
