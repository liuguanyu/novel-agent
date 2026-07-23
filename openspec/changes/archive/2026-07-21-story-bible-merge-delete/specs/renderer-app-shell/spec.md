## MODIFIED Requirements

### Requirement: React 三轴外壳落地
Renderer MUST 用 React 落地左导航轴、中正文轴、右对话轴三区并存的可运行外壳，含底部仪表盘抽屉与 Cmd+K 覆盖层，且严守 Renderer 无业务逻辑边界。Renderer SHOULD 提供 Story Bible 查看入口，用只读 DTO 展示事实库当前态，并 SHOULD 提供确认 inferred/conflicting 事实的受限操作入口。Renderer MAY 提供受限事实编辑、删除与实体合并入口，相关请求 MUST 通过 Main 验证并写入。

#### Scenario: Story Bible 面板删除/合并事实
- **WHEN** 作者删除 Story Bible 中一条事实或把某实体合并进另一实体
- **THEN** Renderer MUST 经受限桥发送 `delete-story-bible-fact` 或 `merge-story-bible-entities` 命令
- **AND** 成功后 SHOULD 刷新 Story Bible DTO
- **AND** Renderer MUST NOT 自行修改本地事实状态作为事实来源
- **AND** Renderer MUST NOT 发送任意 SQL 或 raw JSON payload
