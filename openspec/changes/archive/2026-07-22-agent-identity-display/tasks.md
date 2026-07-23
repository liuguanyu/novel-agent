## 1. Specification

- [x] 1.1 renderer-app-shell delta：新增 Requirement「对话轴标注发言专家 agent」——助手消息 MUST 据权威目录呈现发言专家名与类别徽标，未知 agent MUST 回退通用「助手」，用户消息标注「作者」。

## 2. 目录 helper（core）

- [x] 2.1 `src/core/shell/agent-catalog.ts`：新增纯 helper `resolveAgentEntry(agent: string): AgentCatalogEntry | undefined`（据 id 安全解析目录条目，未知返回 undefined）。

## 3. UI 接线（renderer）

- [x] 3.1 `useDialogue.ts`：`DialogueTurn` 增加可选 `agent?: string`；`summon` 构造助手 turn 时写入 `request.agent`（守卫 exactOptionalPropertyTypes）。
- [x] 3.2 `DialogueAxis.tsx`：`TurnView` 对助手 turn 据 `resolveAgentEntry` 呈现中文名 + 类别徽标，解析不到回退「助手」；用户 turn 仍为「作者」。

## 4. Validation

- [x] 4.1 Run node and web TypeScript checks.
- [x] 4.2 Run ESLint.
- [x] 4.3 Run OpenSpec strict validation.
- [x] 4.4 Run production build.
- [x] 4.5 Run orchestration smoke.
