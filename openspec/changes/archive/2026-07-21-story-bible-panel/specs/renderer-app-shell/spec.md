## MODIFIED Requirements

### Requirement: React 三轴外壳落地
Renderer MUST 用 React 落地左导航轴、中正文轴、右对话轴三区并存的可运行外壳，含底部仪表盘抽屉与 Cmd+K 覆盖层，且严守 Renderer 无业务逻辑边界。Renderer SHOULD 提供 Story Bible 查看入口，用只读 DTO 展示事实库当前态。

#### Scenario: 三轴外壳渲染
- **WHEN** 应用启动、Renderer 挂载
- **THEN** 界面 MUST 以 React 渲染左导航轴、中正文轴、右对话轴三区并存
- **AND** MUST 含底部可展开的质量仪表盘抽屉与 Cmd+K 命令面板覆盖层
- **AND** 各区承载的能力入口 MUST 依 electron-shell-ui 的 layout 契约（AXIS_CAPABILITIES）呈现
- **AND** 样式 MUST 用 Tailwind CSS 仅保证结构可用（分区/滚动/覆盖层），MUST NOT 做视觉设计

#### Scenario: 正文轴显示真实章节
- **WHEN** 作者在导航轴选中某章
- **THEN** 中正文轴 MUST 经桥向 Main 请求该章真实正文并在 TipTap 中显示
- **AND** MUST NOT 使用 mock/占位文本

#### Scenario: Story Bible 面板展示当前事实
- **WHEN** 作者打开 Story Bible 面板
- **THEN** Renderer SHOULD 经受限桥请求当前事实库 DTO
- **AND** 面板 SHOULD 展示实体、别名、属性、时间线、关系、伏笔与 provenance quote
- **AND** 无事实时 SHOULD 显示空态与刷新入口
- **AND** Renderer MUST NOT 直接访问 SQLite、LLM 或文件系统

#### Scenario: Renderer 不承载业务逻辑
- **WHEN** 用户触发召唤/控制/跳章/审批/事实抽取/Story Bible 查看等操作
- **THEN** Renderer MUST 仅收集意图并经 IPC 桥上报或请求只读 DTO
- **AND** MUST NOT 在 Renderer 执行 agent 编排、持久化、diff 计算、事实抽取或正文写入
