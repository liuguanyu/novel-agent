/**
 * agent 节点契约 (agent-orchestration tasks 3.1–3.3)
 *
 * spec: agent-node-contract——每个节点仅「组 prompt → 调模型 → 解析校验 → 写状态」，
 * MUST NOT 直接持久化/发 IPC/操作 UI；模型输出 MUST 经 schema 校验转强类型后方可写状态；
 * 产出一致性问题的节点（reviewer/fact-checker）MUST 遵循 story-bible 一致性问题模型（见 design D3）。
 *
 * 本文件为类型契约（无 I/O；节点实现由运行层装配，调用 model-adapter 与 prompt-loader）。
 */

import type { NovelState } from './novel-state.js';
import type { CapabilityTier } from '../model/capability-tier.js';
import type { ValidationResult } from '../model/output-validation.js';

/**
 * 节点对共享状态的「部分更新」——节点只返回它写入的字段，由编排框架按 reducer 合并。
 * 精确类型（Partial<NovelState>），禁 any。
 */
export type NovelStateUpdate = Partial<NovelState>;

/**
 * 节点执行的上下文（由运行层注入）。节点通过它取模型适配器与提示词，
 * 但 MUST NOT 拿到持久化/IPC/UI 句柄（职责边界，task 3.1）。
 */
export interface NodeRunContext {
  /** 该节点声明的能力档位（经 model-adapter 解析到具体模型） */
  readonly tier: CapabilityTier;
  /** 该节点使用的提示词模板名（由 prompt-loader 加载） */
  readonly promptName: string;
}

/**
 * agent 节点契约 (task 3.1)。
 * 输入当前状态 + 运行上下文，输出对状态的部分更新（异步，因内部 await 模型调用）。
 * 契约层面即约束职责：签名只允许「读状态 → 产状态更新」，无持久化/IPC/UI 出口。
 */
export interface AgentNode {
  /** 节点名（对应 graph-topology 的 NodeName） */
  readonly name: string;
  /** 声明的能力档位 */
  readonly tier: CapabilityTier;
  /** 执行：组 prompt→调模型→解析校验→产出状态更新 */
  run(state: NovelState, ctx: NodeRunContext): Promise<NovelStateUpdate>;
}

/**
 * 输出 schema 校验点 (task 3.2)：
 * 节点内模型原始输出（unknown）MUST 经此校验转强类型后方可写入状态；
 * 失败走既定失败处理（返回 ValidationErr），MUST NOT 写入 any（复用 model 层的 ValidationResult）。
 * 此别名把「节点输出校验」显式绑定到统一校验结果契约。
 */
export type NodeOutputValidation<T> = ValidationResult<T>;
