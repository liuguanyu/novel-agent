## MODIFIED Requirements

### Requirement: 事实版本增量写入
系统 MUST 以增量方式记录事实库变更，保留版本历史并可关联 checkpoint；事实抽取批次写入 MUST 可追踪来源与去重身份。作者确认事实 MUST 创建新的 fact version，并把目标事实状态更新为 confirmed。作者编辑事实 MUST 通过受限字段操作创建新的 fact version，并把编辑后的目标事实标记为 confirmed。作者删除误抽事实 MUST 通过受限定位器创建新的 fact version 并移除目标事实。作者合并重复实体 MUST 把源实体的别名/属性/关系并入目标实体后删除源实体，并创建新的 fact version。删除与合并 MUST 校验目标存在后再写入，MUST NOT 部分写入或悬挂关系外键。

#### Scenario: 作者删除误抽事实
- **WHEN** 作者在 Story Bible 中删除一条受支持的事实（实体、属性、别名、时间线事件、关系或伏笔）
- **THEN** Main MUST 先校验目标事实存在
- **AND** MUST 创建新的 fact version 并移除该事实
- **AND** 删除实体时 MUST 一并处理引用该实体的关系（迁移或移除），不得留下悬挂外键
- **AND** MUST NOT 让 Renderer 直接写 SQLite 或提交任意 JSON payload

#### Scenario: 作者合并重复实体
- **WHEN** 作者选定源实体合并进目标实体
- **THEN** Main MUST 校验源与目标实体均存在且互不相同
- **AND** MUST 把源实体的规范名/别名并入目标实体别名集合、迁移其属性、把引用源实体的关系改指目标实体
- **AND** MUST 删除源实体并创建新的 fact version
- **AND** MUST NOT 部分写入（校验失败时整体回滚）

#### Scenario: 删除或合并失败不部分写入
- **WHEN** 作者提交不存在目标、源与目标相同或非法定位器
- **THEN** Main MUST 返回结构化失败事件
- **AND** MUST NOT 部分写入
