## 1. Specification

- [x] 1.1 command-palette delta：新增 Requirement「召唤目录覆盖全部专家 agent」——命令面板召唤项 MUST 由权威 agent 目录驱动，覆盖 orchestration 已落地的全部专家节点；MUST NOT 硬编码子集而遗漏已落地 agent。

## 2. 权威目录（core）

- [x] 2.1 `src/core/shell/agent-catalog.ts`：`AgentCatalogEntry` 类型 + `AGENT_CATALOG`（`Record<(typeof EXPERT_NODES)[number], …>` 编译期穷尽）+ 纯 helper（如按类别分组、取默认诊断 agent）。
- [x] 2.2 `src/core/shell/index.ts`：导出 `agent-catalog`。

## 3. UI 接线（renderer）

- [x] 3.1 `CommandPalette.tsx`：遍历目录渲染召唤项（按类别分组），据条目默认 mode/scope/锚点要求构造 `SummonRequest`；保留需锚点时的禁用逻辑。
- [x] 3.2 `App.tsx`：对话轴自由提问 `ask` 的默认 agent 由写死 `writer` 改为目录默认诊断 agent。

## 4. Validation

- [x] 4.1 Run node and web TypeScript checks.
- [x] 4.2 Run ESLint.
- [x] 4.3 Run OpenSpec strict validation.
- [x] 4.4 Run production build.
