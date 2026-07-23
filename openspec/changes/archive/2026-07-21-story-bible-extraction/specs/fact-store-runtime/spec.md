## MODIFIED Requirements

### Requirement: 事实版本增量写入
系统 MUST 以增量方式记录事实库变更，保留版本历史并可关联 checkpoint；事实抽取批次写入 MUST 可追踪来源与去重身份。

#### Scenario: 追加事实版本
- **WHEN** 一次事实写入发生
- **THEN** 系统 MUST 创建新的 fact version 记录
- **AND** MUST 追加 fact changes 记录本次新增或修改
- **AND** MUST NOT 覆盖或删除旧版本历史

#### Scenario: 关联 checkpoint
- **WHEN** 事实写入发生在某 checkpoint 上下文中
- **THEN** fact version 与 fact changes SHOULD 记录对应 checkpoint id

#### Scenario: 重启后读回
- **WHEN** 应用关闭并重新打开同一数据库
- **THEN** 事实版本、变更与实体数据 MUST 能被读回

#### Scenario: 记录抽取批次与去重键
- **WHEN** 事实由自动抽取写入
- **THEN** 系统 SHOULD 记录抽取来源章节、候选 kind、identityKey 与 provenance 摘要
- **AND** 后续对同一来源重复抽取时 MUST 能据此去重或更新
