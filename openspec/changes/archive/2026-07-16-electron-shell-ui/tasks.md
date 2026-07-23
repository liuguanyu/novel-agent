## 1. 布局骨架

- [x] 1.1 定义双轴布局（左导航/中正文/右对话）+ 仪表盘抽屉 + Cmd+K 覆盖层
- [x] 1.2 定义各区承载的能力入口、明确仅骨架级不含视觉
- [x] 1.3 定义对话轴手刹契约（映射 interrupt/resume/abort、经 control-event 携带 runId）
- [x] 1.4 定义仪表盘抽屉承载体检结果与一键跳章
- [x] 1.5 明确 Renderer 无业务逻辑、全部经 IPC

## 2. 命令面板

- [x] 2.1 定义 Cmd+K 唤起、产出 on-demand-summon 统一命令
- [x] 2.2 定义查阅 architect 看板（时间线/情节线/人设集）
- [x] 2.3 明确三入口产出同一命令、协议归 on-demand-summon

## 3. 编辑器标注

- [x] 3.1 定义 TipTap/ProseMirror 承载 bug 高亮/diff 双栏/hunk 控件
- [x] 3.2 定义 accept/reject 只上报意图、diff 与拼回在后端
- [x] 3.3 定义标注以稳定标识符 + ProseMirror 位置锚定、编辑防漂移、无法映射即失效

## 4. 校验

- [x] 4.1 `openspec validate electron-shell-ui --strict` 通过
- [x] 4.2 确认与 bootstrap-foundation/on-demand-summon/human-in-the-loop/surgical-refactor/global-audit/story-workspace 契约一致
- [x] 4.3 明确视觉设计（配色/排版/动效/主题）为后续独立迭代，不在本 change
