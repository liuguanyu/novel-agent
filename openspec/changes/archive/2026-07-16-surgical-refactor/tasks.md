## 1. 片段圈定

- [x] 1.1 定义从选区/节点范围裁出待修片段（只喂坏片段）
- [x] 1.2 明确重构 agent 看不到片段外“好的部分”
- [x] 1.3 定义片段锚点（稳定标识符 + 偏移）记录、片段与上下文强类型

## 2. diff 引擎

- [x] 2.1 定义原片段 vs 改写的最小差异与 hunk 拆分
- [x] 2.2 定义 hunk 携带锚点/原文/改写、强类型
- [x] 2.3 明确差异仅在片段范围内、越界不产生 hunk
- [x] 2.4 明确 diff 计算在 utilityProcess

## 3. hunk 评审

- [x] 3.1 定义逐 hunk accept/reject、精确拼回、未接受不动
- [x] 3.2 明确无整章覆盖路径
- [x] 3.3 定义锚点稳定与编辑期偏移修正、无法映射即失效
- [x] 3.4 定义接受变更作为可回滚步进入 checkpointer/事实版本

## 4. 校验

- [x] 4.1 `openspec validate surgical-refactor --strict` 通过
- [x] 4.2 确认与 story-workspace/human-in-the-loop/on-demand-summon/electron-shell-ui 契约一致
- [x] 4.3 用第四章“7 天时序断流”用例验证局部重构只改冲突段、不动市井对白
