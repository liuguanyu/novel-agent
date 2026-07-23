## 1. 中断与恢复

- [x] 1.1 定义节点内条件性 interrupt（有需要才挂起）与强类型 payload
- [x] 1.2 定义 resume 决策数据（批准/驳回/修改）及从挂起点继续、不重跑
- [x] 1.3 定义修改决策与 activeBugs 可覆写 reducer 的对接
- [x] 1.4 明确静态断点仅作调试兜底
- [x] 1.5 明确中断/恢复经 control-event 通道携带 runId

## 2. abort 控制

- [x] 2.1 定义 abort 经 AbortSignal 停止生成并断连
- [x] 2.2 定义未提交当前步天然丢弃、最近 checkpoint 为干净态
- [x] 2.3 定义 abort 针对特定 runId、不影响其他并发运行

## 3. time-travel

- [x] 3.1 定义 checkpoint 历史查询
- [x] 3.2 定义回退与分叉
- [x] 3.3 定义与 story-bible 事实版本联动回滚
- [x] 3.4 明确 abort 与 time-travel 的语义区分

## 4. 校验

- [x] 4.1 `openspec validate human-in-the-loop --strict` 通过
- [x] 4.2 确认依赖的 checkpointer/AbortSignal/control-event/fact-versioning 契约一致
