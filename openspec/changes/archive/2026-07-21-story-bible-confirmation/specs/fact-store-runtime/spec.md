## MODIFIED Requirements

### Requirement: 事实版本增量写入
系统 MUST 以增量方式记录事实库变更，保留版本历史并可关联 checkpoint；事实抽取批次写入 MUST 可追踪来源与去重身份。作者确认事实 MUST 创建新的 fact version，并把目标事实状态更新为 confirmed。

#### Scenario: 追加事实版本
- **WHEN** 一次事实写入发生
- **THEN** 系统 MUST 创建新的 fact version 记录
- **AND** MUST 追加 fact changes 记录本次新增或修改
- **AND** MUST NOT 覆盖或删除旧版本历史

#### Scenario: 作者确认事实
- **WHEN** 作者在 Story Bible 中确认一条 inferred 或 conflicting 事实
- **THEN** Main MUST 在新的 fact version 中将该事实状态更新为 confirmed
- **AND** MUST 追加 fact change 记录本次确认
- **AND** MUST NOT 让 Renderer 直接写 SQLite

#### Scenario: 不支持的确认目标结构化失败
- **WHEN** 作者请求确认不存在或当前版本不支持定位的事实
- **THEN** Main MUST 返回结构化失败事件
- **AND** MUST NOT 部分写入或静默忽略
