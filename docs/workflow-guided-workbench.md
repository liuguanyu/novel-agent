# 工作流引导式工作台 (workflow-guided-workbench)

> 本文档由 `workflow-guided-workbench` change 落定（tasks 11.1），记录工作流核心语义、
> 两套内置模板、人工门与 standalone 兼容路径，以及 smoke fixture 的覆盖分工。
> 权威契约见 `src/core/workflow/`、`src/shared/ipc/workflow-messages.ts` 与对应 OpenSpec specs。

---

## 1. `workflowId` / `runId` 语义

| 标识 | 生命周期 | 说明 |
|------|----------|------|
| `workflowId` | 长生命周期 | 一个项目的一次「书目整理」全程（跨全部阶段、跨多次 run）。每个项目同一时刻至多一个 active workflow（`WorkflowRepository.getActive`）。 |
| `stageId` | 属于 workflow | 实例化阶段 id：`${workflowId}:${templateStageId}`；章节/issue 循环实例追加 `:${chapterId|issueId}:${instanceKey}` 后缀，`templateStageId` 保持模板阶段 id（Renderer 据此取中文 label）。 |
| `runId` | 单次执行 | 一次专家召唤 / 系统任务 / 质量门运行。run 经 `attach-run`（或 `start-stage` 携带）挂到当前阶段，`stage.runIds` **只追加不清空**——重试、多轮召唤都保留完整历史（Renderer 上层跨 run 历史不清空的依据）。 |
| `WorkflowRef` | 随命令传递 | `{ workflowId, stageId, issueId? }`：summon/事实抽取/审计等命令据此把 run 归属到阶段；issue-scoped 阶段必须带 `issueId`，且改写 run 需先经 `workflow-select-issue` 登记（issue.refactorRunIds）。 |

并发与幂等：workflow 聚合带乐观并发 `version`（命令必须携带 `expectedVersion`）与
`operationId` 幂等去重（`appliedOperationIds`）；重复投递同一 operation 不产生第二次状态迁移。

问题（issue）侧的 run 关联：`WorkflowIssueRecord` 记录 `sourceAuditRunId`（发现来源）、
`refactorRunIds`（历轮修复）、`verificationRunIds`（历轮针对性复检）与 `checkpointIds`（写回证据），
全链可追溯，指纹 = type + 排序锚点 + 规范化 description（同指纹复发走 reopen 而非新建）。

## 2. 两套内置模板（`src/core/workflow/templates.ts`）

### new-book-creation v1（新书创作，12 阶段）

`concept → worldbuilding → character-design → book-outline → chapter-plan → scene-outline →
draft-writing → fact-extraction → automatic-review → author-review → chapter-finalization →
whole-book-audit`

- 章节循环：`chapter-finalization` 上有 `continue-loop`（回 `chapter-plan`，按新章实例化循环组）
  与 `finish-loop`（进 `whole-book-audit`）两条显式转移；循环决策永远是作者显式选择。
- 策划信息（立意/世界观/人物/大纲等）落入版本化创作资产（`CreativeAssetRepository`）。

### legacy-book-revision v1（老书重建与修订，11 阶段）

`import-book → fact-backfill → initial-audit → issue-triage → locate-source → generate-rewrite →
hunk-review → apply-checkpoint → targeted-verification → close-issue → final-audit`

- issue 循环：`close-issue` 的 `continue-loop` 回 `issue-triage` 处理下一问题（issue-scoped 阶段按
  issue 实例化）；`targeted-verification` 的 `quality-failed` 回 `generate-rewrite` 重新改写。
- `final-audit` 的 `issues-found` 回 `issue-triage`（新发现/复发问题继续修）。
- 所有正文写入必须经 `locate-source → 局部 diff → 逐 hunk 裁决 → checkpoint 落盘`，绝无整篇覆写。

## 3. 人工门（human gates）

| 门 | 机制 |
|----|------|
| 作者确认门 | `completionGate: author-confirmation` 的阶段在 run 成功后停在 `awaiting-confirmation`，必须 `workflow-confirm-stage`（留下 `author-confirmation` 完成证据）才推进；绝不自动跳过。 |
| 质量门 | `completionGate: quality` 的阶段必须收到 `quality-gate-result` 证据；失败按 `blockingOnFailure`/`quality-failed` 转移处理。 |
| 最终复检确认门 | `final-audit` 质量通过后**不**直接 completed，而是停 `awaiting-confirmation`，作者确认（且无 finalization 阻塞问题）后 workflow 才 completed（tasks 7.6）。 |
| 资产变更确认 | 专家产出的资产变更一律先成为 candidate（含 baseVersion/change set/provenance），作者逐条确认/拒绝后 Main 才落库版本化资产；多目标歧义时下发 `asset-target-selection-required`，由作者选定 `targetAssetId`（零副作用）。 |
| 资产影响分流 | 资产版本推进产生的下游影响（stage `impactStatus`: stale/needs-review/conflicting）由作者分流：立即处理 / 记入待办 / 继续当前阶段；`conflicting` 阻断该阶段 start/confirm。 |
| hunk 裁决 | 改写 diff 逐 hunk 由作者接受/拒绝，接受集应用后生成 checkpoint 并关联 issue。 |

## 4. standalone 兼容路径

- 无 `workflowRef` 的召唤（单次专家 run）保持既有语义：不登记阶段证据、不受阶段门限制。
- Renderer `useWorkflowSnapshot` 无 projectId 或查询失败时保持 standalone；`ExpertWorkbench` 在
  workflow 为 null 时回退到活动态摘要 / 轨迹观察（`workbench-view-contracts.ts` 的
  `activitySummary`/`observationSummary`），既有单次视图不回退。
- IPC DTO 全部为可选新增字段，老客户端/standalone 路径不受破坏（`src/shared/ipc/workflow-messages.ts`）。

## 5. smoke fixture 分工

| fixture | 覆盖 |
|---------|------|
| `src/main/workflow-smoke.ts`（`npm run smoke:workflow`） | 纯状态机：模板/人工门/循环转移/非法迁移不落地/run 历史只追加/issue 生命周期。 |
| `src/main/workflow-integration-smoke.ts`（同上） | SQLite + `WorkflowApplicationService`：两套模板全阶段推进、阶段 run 证据、乐观并发与幂等、规划资产落库。 |
| `src/main/orchestration-smoke.ts`（`npm run smoke:orchestration`） | 运行时全链（按 task 编号断言）：新书主路径 6.7、资产澄清分流 6.8、老书主路径 7.7（单 workflow 单 issue 串联）、锚点失效阻塞 7.3、多范围复检 7.5、最终确认门 7.6、Renderer 纯契约 8.7/9.6/10.11 与 Renderer 静态隔离扫描（无 DB/LLM/fs/Main import）。 |
| `src/main/persistence-smoke.ts` / `src/main/extraction-smoke.ts` | 既有持久化 / 事实抽取回归。 |
