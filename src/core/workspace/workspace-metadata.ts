/**
 * 工作区元数据模型 (story-workspace tasks 1.2)
 *
 * spec: workspace-model「工作区元数据」——必填书名/体裁/语言，其余可选且可扩展。
 * 本文件为类型契约 + Zod 校验 schema（core 层允许纯 schema，无 I/O）。
 */

import { z } from 'zod';

/**
 * 工作区元数据。
 * - 必填：书名、体裁、语言（见 spec「必填元数据存在」）。
 * - 可选可扩展：简介、目标读者、基调……新增可选字段 MUST NOT 破坏既有工作区
 *   （见 spec「元数据可扩展」）。
 */
export interface WorkspaceMetadata {
  /** 书名（必填） */
  title: string;
  /** 体裁（必填，如 '历史'、'悬疑'、'言情'） */
  genre: string;
  /** 语言（必填，BCP-47 或自由文本，如 'zh-CN'） */
  language: string;
  /** 一句话/一段简介（可选） */
  synopsis?: string;
  /** 目标读者（可选） */
  targetAudience?: string;
  /** 整体基调（可选，如 '冷峻'、'诙谐'） */
  tone?: string;
  /**
   * 面向未来的可扩展槽位：未预置的额外元数据以键值对承载，
   * 值限定为可读的标量，避免塞入不可 diff 的黑盒结构。
   */
  extra?: Readonly<Record<string, string | number | boolean>>;
}

/** 元数据 Zod schema：装载/导入既有工作区时用于校验持久化内容（unknown → 强类型）。 */
export const workspaceMetadataSchema = z
  .object({
    title: z.string().min(1),
    genre: z.string().min(1),
    language: z.string().min(1),
    synopsis: z.string().optional(),
    targetAudience: z.string().optional(),
    tone: z.string().optional(),
    extra: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();
