## Why

I4 已经完成 Main 侧事实抽取闭环：当前章节/manifest 补库命令、长章节分块、低风险事实自动入库、冲突经手刹裁决、进度/完成/失败事件均已走强类型 control-event。但 Renderer 目前还没有入口触发这些能力，作者无法在 UI 中为当前章节抽取事实、补抽全书，也无法看到抽取进度与结果。

本 change 只做 I4 能力的 UI 产品化接入：Renderer 收集意图并展示控制事件，不直接碰 DB/LLM/fs；事实库详情浏览与 inferred→confirmed 管理留给后续 `story-bible-panel`。

## What Changes

- 在 Renderer 增加事实抽取控制入口：当前章节“抽取本章事实”、全书“补抽全书事实”。
- 新增事实抽取状态 hook，订阅 `fact-extraction-started/completed/failed` 与 `interrupt-raised`，按 runId 维护进度、结果、失败与待裁决冲突。
- 抽取入口经 preload 桥发送既有 `extract-facts` / `backfill-facts` 命令，MUST NOT 在 Renderer 读正文、调模型或写事实库。
- 在正文轴或顶栏展示抽取状态：章节进度、分块数、候选数、自动入库数、冲突数、跳过数、失败原因。
- 对抽取冲突提供最小裁决 UI，复用 `resume-run` 发送 `accept-new` / `keep-existing` / `ignore-candidate` / `reject` 等决策。

## Non-Goals

- 不做完整 Story Bible 浏览/编辑面板。
- 不做手工编辑冲突事实 payload 的 `manual-edit` 复杂表单。
- 不新增 Main 侧事实查询 API。
- 不改变 I4 后端抽取/入库语义。

## Impact

- 修改 Renderer 组件与 hooks，主要接入 `FrontendCommandMessage` 与 `BackendControlEvent`。
- 复用既有 preload `sendCommand/onControlEvent`，不新增桥能力。
- 需要补 web/node typecheck、eslint、electron-vite build 与 `openspec validate fact-extraction-ui --strict`。
