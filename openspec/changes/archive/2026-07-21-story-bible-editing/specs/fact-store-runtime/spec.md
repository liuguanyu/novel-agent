## MODIFIED Requirements

### Requirement: 事实版本增量写入
系统 MUST 以增量方式记录事实库变更，保留版本历史并可关联 checkpoint；事实抽取批次写入 MUST 可追踪来源与去重身份。作者确认事实 MUST 创建新的 fact version，并把目标事实状态更新为 confirmed。作者编辑事实 MUST 通过受限字段操作创建新的 fact version，并把编辑后的目标事实标记为 confirmed。

#### Scenario: 作者编辑事实
- **WHEN** 作者在 Story Bible 中编辑受支持的事实字段
- **THEN** Main MUST 验证目标事实存在且新值合法
- **AND** MUST 创建新的 fact version 写入更新后的事实
- **AND** SHOULD 将被编辑事实标记为 confirmed
- **AND** MUST NOT 让 Renderer 直接写 SQLite 或提交任意 JSON payload

#### Scenario: 编辑失败不部分写入
- **WHEN** 作者提交不存在目标、不合法字段或空值
- **THEN** Main MUST 返回结构化失败事件
- **AND** MUST NOT 部分写入
