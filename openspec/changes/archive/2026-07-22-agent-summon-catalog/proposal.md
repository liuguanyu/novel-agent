## Why

I9（agent-roster-expansion，A–E）已把 **10 个专家 agent** 全部接成真图节点（writer、scene-generator、reviewer、fact-checker、plagiarism-checker、editor、style-editor、architect、character-generator、worldbuilding），召唤路由与外置提示词运行时齐备。但 **UI 侧严重滞后**：

- `CommandPalette` 硬编码 3 个动作，仅覆盖 editor/writer/architect 三者；
- 对话轴自由提问 `ask` 写死 `agent:'writer'`；
- 结果：fact-checker/scene-generator/plagiarism-checker/style-editor/character-generator/worldbuilding **6 个已落地 agent 无法从 UI 召唤**。

这是 I10 `ui-overhaul` 的最高价值、最内聚一刀。本 change 为 I10 子阶段 A：建立**权威 agent 召唤目录**，命令面板与对话轴改为**目录驱动**，一次补齐全部专家的 UI 可召唤性。

## What Changes

- 新增 `src/core/shell/agent-catalog.ts`：权威 `AGENT_CATALOG`，以 `Record<(typeof EXPERT_NODES)[number], AgentCatalogEntry>` 强制**编译期穷尽**覆盖 I9 全部 10 个专家（新增/删除专家而漏登记即 TS 报错，drift 守卫）。每个条目含：中文名、职责描述、类别（写作/审校/重构/策划）、默认 mode（diagnose|mutate）、适用 scope 集（node/document/…）、是否需锚点。纯数据 + 纯 helper（无 React、无 I/O）。
- `src/core/shell/index.ts`：导出 `agent-catalog`。
- `CommandPalette.tsx`：改为**遍历目录**渲染召唤项（按类别分组），据条目的默认 mode/scope/锚点要求构造统一 `SummonRequest`；保留"需先选中章节"的禁用逻辑（据 scope 是否要锚点）。
- 对话轴自由提问：`App.tsx` 的 `ask` 增加 agent 选择（默认沿用当前语义），或由目录提供默认诊断 agent——本子阶段最小改动：`ask` 默认 agent 从写死 `writer` 改为目录中的默认诊断 agent，避免继续误导。

## Impact

- Affected specs: `command-palette`（新增 Requirement「召唤目录覆盖全部专家 agent」——命令面板召唤项 MUST 由权威目录驱动、覆盖 orchestration 已落地的全部专家节点，MUST NOT 硬编码子集而遗漏已落地 agent）。
- Affected code: 新增 `src/core/shell/agent-catalog.ts`；`src/core/shell/index.ts`、`src/renderer/components/CommandPalette.tsx`、`src/renderer/App.tsx`。
- 依赖 I9（专家节点全部落地，已归档）。`AGENT_CATALOG` 的 key 集与 `graph-topology.ts` 的 `EXPERT_NODES` 编译期绑定，二者唯一事实源不漂移。
- 兼容性：仅扩充 UI 可召唤面 + 新增 core 纯数据；不改召唤命令协议、不改运行层、不改图。build/lint/tsc 保持绿。本 change 是 I10 的第一子阶段。
