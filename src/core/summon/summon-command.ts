/**
 * 统一召唤命令协议 (on-demand-summon tasks 1.1–1.4)
 *
 * spec: summon-command——入口无关的统一召唤命令：agent + scope + anchor(可空) + mode(diagnose|mutate)
 * + 可选 instruction；scope ∈ {selection,node,document,project} 且复用 story-workspace 稳定标识符锚定；
 * 三入口产出同一命令、后端不依赖来源；经 IPC 携带 runId（见 design D1、D2、D6）。
 *
 * 本文件为类型契约 + Zod schema（无 I/O）。scope 与 anchor 建模为判别联合，
 * 使「selection 必带偏移、node 必带节点锚、document/project 无节点锚」在类型层强制成立。
 */

import { z } from 'zod';
import type { NodeRef } from '../manuscript/node-id.js';
import type { RunId } from '../../shared/ipc/stream-messages.js';

/** 执行模式 (design D5)：diagnose 只读诊断；mutate 走局部 diff 写入。 */
export type SummonMode = 'diagnose' | 'mutate';

/** 选区在正文内的位置偏移（ProseMirror 位置，附加于稳定标识符锚点之上，见 design D2）。 */
export interface SelectionRange {
  /** 起始位置 */
  from: number;
  /** 结束位置（> from） */
  to: number;
}

/**
 * 作用范围 + 锚点的统一判别联合 (task 1.2 / spec「作用范围 scope」)。
 * `scope` 判别；selection/node 复用 story-workspace 稳定标识符（NodeRef）定位，
 * selection 附加选区偏移；document 为当前全文；project 为跨项目（仅素材类 agent 有意义）。
 */
export type SummonTarget =
  | { scope: 'selection'; anchor: NodeRef; selection: SelectionRange }
  | { scope: 'node'; anchor: NodeRef }
  | { scope: 'document' }
  | { scope: 'project' };

/** 作用范围层级（从 SummonTarget 投影，供路由/组装按级分派）。 */
export type SummonScope = SummonTarget['scope'];

/**
 * 统一召唤命令 (task 1.1)。三入口（划词气泡 / Cmd+K / 侧边栏）产出同一结构，
 * 后端 MUST NOT 依赖来源入口分支（task 1.3）。
 */
export interface SummonCommand {
  /** 关联运行（经 IPC 携带，task 1.4） */
  runId: RunId;
  /** 目标专家 agent 标识（对应 graph-topology 的 NodeName） */
  agent: string;
  /** 作用范围 + 锚点 */
  target: SummonTarget;
  /** 执行模式 */
  mode: SummonMode;
  /** 可选：作者自然语言指令 */
  instruction?: string;
}

const nodeRefSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['volume', 'chapter', 'scene']),
  })
  .strict();

const summonTargetSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('selection'),
      anchor: nodeRefSchema,
      selection: z
        .object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() })
        .strict()
        .refine((s) => s.to > s.from, { message: 'selection.to MUST be greater than selection.from' }),
    })
    .strict(),
  z.object({ scope: z.literal('node'), anchor: nodeRefSchema }).strict(),
  z.object({ scope: z.literal('document') }).strict(),
  z.object({ scope: z.literal('project') }).strict(),
]);

/**
 * 召唤命令 Zod schema (task 1.1)：校验来自任一入口经 IPC 下发的 unknown 命令。
 * 强类型化，禁 any；三入口产出同一 schema（spec「三入口产出同一种命令」）。
 */
export const summonCommandSchema = z
  .object({
    runId: z.string().min(1),
    agent: z.string().min(1),
    target: summonTargetSchema,
    mode: z.enum(['diagnose', 'mutate']),
    instruction: z.string().optional(),
  })
  .strict();

/**
 * 三入口无关原则 (task 1.3)：后端处理 MUST 只依据命令结构，不依赖产生它的入口。
 * 此常量为该原则的显式契约标记。
 */
export const SUMMON_ENTRYPOINT_AGNOSTIC = true as const;
