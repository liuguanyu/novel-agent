## 1. 规格与组件边界

- [x] 1.1 将 `expert-workbench-graph` 收口为“目标 + 有序执行链”，明确循环节点不覆盖
- [x] 1.2 将三排工具入口从流程工作台组件职责中拆出，保持目录与回调不变

## 2. 流程工作台常驻化

- [x] 2.1 精简 `ExpertWorkbench`：只呈现标题、目标、目标专家、实时路径与状态摘要
- [x] 2.2 在 `App.tsx` 将流程工作台放到三轴内容区上方并默认可见
- [x] 2.3 保持 `WorkbenchGraph` / `useWorkbenchActivities` 的有序轨迹与运行终态

## 3. 工具入口底部抽屉

- [x] 3.1 新增 `ToolboxDrawer`，承载 Agent / 看板 / 动作三排
- [x] 3.2 默认收起，底部常驻展开入口；既有锚点禁用规则、目录与回调不变
- [x] 3.3 删除 `ExpertWorkbench` 中重复的工具 UI，避免双入口/双职责

## 4. 事实抽取状态区精简

- [x] 4.1 空闲时隐藏事实抽取区域，手动入口只保留在底部工具抽屉
- [x] 4.2 运行、失败与冲突状态按需出现，保留中断、重试与裁决动作
- [x] 4.3 完成摘要短暂显示后自动退出

## 5. 对话专家路由

- [x] 5.1 后续输入默认保持最近专家，不再隐式切到审校
- [x] 5.2 支持 `@中文名` / `@agent-id` 显式路由与未知专家拦截
- [x] 5.3 输入 `@` 自动展示、过滤并通过鼠标或键盘补全专家

## 6. 校验

- [x] 6.1 node/web TypeScript 通过
- [x] 6.2 eslint 通过
- [x] 6.3 `npm run smoke:orchestration` 通过
- [x] 6.4 `electron-vite build` 通过
- [x] 6.5 `openspec validate workbench-layout-separation --strict` 通过
