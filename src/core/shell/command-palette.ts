/**
 * 命令面板（Cmd+K）+ 架构看板 (electron-shell-ui command-palette tasks 2.1, 2.2, 2.3；design D3、D6)
 *
 * spec: command-palette——Cmd+K 唤起命令面板覆盖层，作为召唤三入口之一，产出 on-demand-summon 的
 * 统一召唤命令（agent/scope/anchor/mode/instruction），MUST NOT 自造另一套命令结构;命令面板 MUST
 * 可查阅 architect 维护的看板（时间线轴 / 并行情节线 / 核心人设集），看板数据来自后端、Renderer
 * MUST NOT 自行计算;划词气泡、Cmd+K、侧边栏工具箱三入口 MUST 产出同一命令、协议归 on-demand-summon。
 *
 * 本文件为类型契约（无 I/O、无 UI）。召唤命令直接复用 summon 的 SummonCommand（不再定义）;
 * 看板视图直接复用 story-bible 的 Timeline / PlotHook / Entity（后端产出，前端只呈现）。
 */

import type { SummonCommand } from '../summon/summon-command.js';
import type { Timeline } from '../story-bible/timeline.js';
import type { PlotHook } from '../story-bible/plot-hook.js';
import type { Entity } from '../story-bible/entity.js';

/**
 * 召唤三入口标识 (task 2.3 / spec「三入口产出同一命令」、design D6)。
 * 三者是入口、非命令:均产出同一 SummonCommand，后端不依赖来源（见 summon 的 SUMMON_ENTRYPOINT_AGNOSTIC）。
 */
export type SummonEntrypoint =
  | 'selection-bubble' // 正文轴划词气泡
  | 'command-palette' // Cmd+K 命令面板
  | 'sidebar-toolbox'; // 侧边栏工具箱

/**
 * 命令面板一次召唤的产物 (tasks 2.1, 2.3)。
 * 直接复用 on-demand-summon 的统一 SummonCommand;此处仅标注其来源入口（供遥测/调试，后端不据此分支）。
 * MUST NOT 自造另一套命令结构（spec「MUST NOT 自造」）。
 */
export interface PaletteSummon {
  /** 产出的统一召唤命令（协议归 on-demand-summon） */
  readonly command: SummonCommand;
  /** 来源入口（仅记录;后端处理不依赖，见 SUMMON_ENTRYPOINT_AGNOSTIC） */
  readonly from: SummonEntrypoint;
}

/**
 * architect 维护的架构看板视图 (task 2.2 / spec「查阅架构看板」)。
 * 数据全部来自后端（story-bible）:时间线轴 / 并行情节线 / 核心人设集;
 * Renderer MUST NOT 自行计算，仅呈现。复用既有模型，不另立结构。
 */
export interface ArchitectBoardView {
  /** 时间线轴 */
  readonly timeline: Timeline;
  /** 并行情节线（伏笔/情节钩子） */
  readonly plotHooks: ReadonlyArray<PlotHook>;
  /** 核心人设集 */
  readonly entities: ReadonlyArray<Entity>;
}

/**
 * Cmd+K 唤起命令面板覆盖层原则 (task 2.1 / spec「Cmd+K 命令面板」)。
 * 系统 MUST 提供 Cmd+K（或对应快捷键）唤起命令面板覆盖层。此常量为该交互入口的显式契约标记。
 */
export const CMD_K_OPENS_COMMAND_PALETTE = true as const;

/**
 * 统一召唤命令原则 (tasks 2.1, 2.3 / spec「产出统一命令」)。
 * 命令面板产出的召唤 MUST 是 on-demand-summon 的统一 SummonCommand，MUST NOT 自造另一套结构。
 * 此常量为该约束的显式契约标记（与 summon 的 SUMMON_ENTRYPOINT_AGNOSTIC 对应）。
 */
export const PALETTE_USES_UNIFIED_SUMMON_COMMAND = true as const;

/**
 * 看板数据来自后端原则 (task 2.2 / spec「呈现后端看板数据」)。
 * 时间线轴/情节线/人设集 MUST 来自后端（story-bible）;Renderer MUST NOT 自行计算或推导看板数据。
 * 此常量为该边界的显式契约标记。
 */
export const BOARD_DATA_FROM_BACKEND = true as const;
