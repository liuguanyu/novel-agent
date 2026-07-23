# fact-extraction-ui 任务

> 五道门：node typecheck / web typecheck / eslint / electron-vite build / `openspec validate fact-extraction-ui --strict`。

## 1. OpenSpec 与契约确认

- [x] 1.1 创建 `fact-extraction-ui` change，明确只接 UI，不重开 I4 后端语义。
- [x] 1.2 确认复用既有 IPC：`extract-facts` / `backfill-facts` / `fact-extraction-*` / `interrupt-raised` / `resume-run`。

## 2. Renderer 状态与事件接入

- [x] 2.1 新增事实抽取 hook：发送当前章抽取、全书补库命令，生成 runId。
- [x] 2.2 hook 订阅 control-event，维护 started/completed/failed 摘要、进度 index/total、chunks 与 busy 状态。
- [x] 2.3 hook 捕获抽取冲突的 `interrupt-raised`，保留 issues 并提供 resume 裁决函数。
- [x] 2.4 支持 abort 当前抽取 run。

## 3. UI 入口与状态展示

- [x] 3.1 在当前章节上下文展示“抽取本章事实”按钮；无选中章节时禁用。
- [x] 3.2 提供“补抽全书事实”入口。
- [x] 3.3 展示抽取进度与结果：章节、进度、分块、候选、自动入库、冲突、跳过、失败原因。
- [x] 3.4 提供最小冲突裁决 UI：展示 issue 描述/证据/options，并经 `resume-run` 回传选择。

## 4. 边界与回归

- [x] 4.1 Renderer 只发命令/收事件，不读 DB/LLM/fs，不自行计算事实。
- [x] 4.2 `SummonRequest` 支持 `autoExtractFacts` 透传，writer 可从 UI 开启自动抽取。
- [x] 4.3 TypeScript 与 ESLint 无错误。
- [x] 4.4 electron-vite build 通过。
- [x] 4.5 OpenSpec strict validate 通过。
