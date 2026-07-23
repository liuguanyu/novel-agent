/**
 * 工作区聚合与加载契约 (story-workspace tasks 1.1, 1.3)
 *
 * spec: workspace-model「项目工作区」——一本书=一个自包含工作区，含元数据、章节树、正文。
 * 打开/创建工作区 MUST 装载元数据与章节树，且标识符与结构与上次保存一致。
 *
 * 本文件为类型契约（无 I/O；实际读盘由 main + project-storage 实现层完成）。
 */

import type { ChapterTree } from '../manuscript/chapter-tree.js';
import type { WorkspaceMetadata } from './workspace-metadata.js';

/**
 * 工作区：承载单本书的自包含聚合。
 * 正文内容随章节树的各章 draft 一并装载（或按需惰性加载，由实现层决定）。
 */
export interface Workspace {
  /** 工作区在磁盘上的根目录（绝对路径） */
  rootDir: string;
  /** 元数据 */
  metadata: WorkspaceMetadata;
  /** 章节树（含各节点稳定 id 与正文草稿） */
  tree: ChapterTree;
}

/** 打开已有工作区的请求。 */
export interface OpenWorkspaceRequest {
  /** 工作区根目录 */
  rootDir: string;
}

/** 创建全新（空）工作区的请求。 */
export interface CreateWorkspaceRequest {
  /** 目标根目录（应为空或不存在） */
  rootDir: string;
  /** 初始元数据（至少含必填三项） */
  metadata: WorkspaceMetadata;
}

/**
 * 加载/创建的结构化结果（成功即得到符合契约的 Workspace）。
 * 失败作为一等结果返回，不抛裸异常穿透进程边界（遵循 engineering-standards）。
 */
export type WorkspaceLoadResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; reason: WorkspaceLoadError; message: string };

/** 加载失败分类。 */
export type WorkspaceLoadError =
  | 'not-found' // 目录不存在
  | 'invalid-metadata' // 元数据缺失/校验失败
  | 'invalid-structure' // 章节树/映射损坏
  | 'io'; // 读盘失败
