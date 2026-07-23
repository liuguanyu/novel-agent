## MODIFIED Requirements

### Requirement: React 三轴外壳落地
Renderer MUST 用 React 落地左导航轴、中正文轴、右对话轴三区并存的可运行外壳，含底部仪表盘抽屉与 Cmd+K 覆盖层，且严守 Renderer 无业务逻辑边界。Renderer SHOULD 提供 Story Bible 查看入口，用只读 DTO 展示事实库当前态，并 SHOULD 提供确认 inferred/conflicting 事实的受限操作入口。

#### Scenario: Story Bible 面板展示当前事实
- **WHEN** 作者打开 Story Bible 面板
- **THEN** Renderer SHOULD 经受限桥请求当前事实库 DTO
- **AND** 面板 SHOULD 展示实体、别名、属性、时间线、关系、伏笔与 provenance quote
- **AND** 无事实时 SHOULD 显示空态与刷新入口
- **AND** Renderer MUST NOT 直接访问 SQLite、LLM 或文件系统

#### Scenario: Story Bible 面板确认事实
- **WHEN** 作者点击确认某条 inferred 或 conflicting 事实
- **THEN** Renderer MUST 经受限桥发送 `confirm-story-bible-fact` 命令
- **AND** 成功后 SHOULD 刷新 Story Bible DTO
- **AND** Renderer MUST NOT 自行修改本地事实状态作为事实来源
