## Why

I10 子阶段 A（agent-summon-catalog）已补齐全部 10 个专家 agent 的 UI 可召唤性，但**对话轴无法呈现是哪个专家在发言**：

- 后端节点确有把 `DialogueMessage.author`（如 `architect`）写入 orchestration-state 的 chatHistory；
- 但流式协议（`stream-start`/`stream-chunk`/`stream-end`）**不携带 author**，`useDialogue` 的 `DialogueTurn` 也**无 agent 字段**；
- 结果：`DialogueAxis` 的助手气泡一律写死「助手」，作者分不清是审校、写手还是结构师在说话；召唤运行也未标注目标 agent。

本 change 为 I10 子阶段 B：**让对话轴按发言专家（名 + 类别徽标）呈现助手消息**。采用 renderer-only 最小实现——`summon` 发起时已知 `request.agent`，把它记在该次运行的助手 `DialogueTurn` 上，对话轴据权威 `AGENT_CATALOG` 查名与类别徽标。不触碰 IPC 契约、运行层与图（真正的按发出节点归属留作后续 Path B 迭代）。

## What Changes

- `src/renderer/hooks/useDialogue.ts`：`DialogueTurn` 增加可选 `agent?: string`；`summon` 构造助手 turn 时写入 `request.agent`（用户 turn 不需要）。
- `src/renderer/components/DialogueAxis.tsx`：`TurnView` 对助手 turn 据 `AGENT_CATALOG` 查目录条目，呈现中文名 + 类别徽标（`AGENT_CATEGORY_LABELS`）；解析不到（未登记/未知 agent）时回退「助手」，不臆造类别。用户 turn 仍为「作者」。
- `src/core/shell/agent-catalog.ts`：新增纯 helper `resolveAgentEntry(agent: string): AgentCatalogEntry | undefined`（据 id 安全解析目录条目，未知返回 undefined），供 renderer 呈现层复用，避免在 renderer 侧对 `AGENT_CATALOG` 做不安全下标。

## Impact

- Affected specs: `renderer-app-shell`（新增 Requirement「对话轴标注发言专家 agent」——助手消息 MUST 据权威目录呈现发言专家名与类别徽标，未知 agent MUST 回退通用「助手」而不臆造）。
- Affected code: `src/core/shell/agent-catalog.ts`（新增纯 helper）、`src/renderer/hooks/useDialogue.ts`、`src/renderer/components/DialogueAxis.tsx`。
- 依赖 I10 子阶段 A（`AGENT_CATALOG` 已归档）。
- 兼容性：renderer-only + core 纯 helper，不改 IPC 流式协议、不改运行层、不改图。build/lint/tsc 保持绿。此为 Path A（呈现召唤目标 agent）；真正按图中发出节点（writer→reviewer 同 runId 内交接）归属需扩流式协议携带 author，属后续更重迭代。
