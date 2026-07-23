## ADDED Requirements

### Requirement: 增量非覆盖写入
事实库写入 MUST 为增量并带版本标记，MUST NOT 覆盖历史，以保留“何时由何来源引入某事实”。

#### Scenario: 写入保留历史
- **WHEN** 一条事实被新增或修改
- **THEN** 系统 MUST 以增量方式记录该变更并附版本标记
- **AND** MUST NOT 直接覆盖或抹除此前的事实记录

#### Scenario: 可追溯引入时点
- **WHEN** 需要查询某事实是何时、由哪个来源引入
- **THEN** 事实库 MUST 能依据版本历史给出答案

### Requirement: 与 checkpoint 对齐
事实库版本 MUST 可关联编排 checkpoint 标识，并能按某 checkpoint 还原出该时刻的一致事实视图。

#### Scenario: 事实版本关联 checkpoint
- **WHEN** 一次事实库写入发生在某编排 checkpoint 上下文中
- **THEN** 该写入的版本 MUST 可关联到对应的 checkpoint 标识

#### Scenario: 随回滚还原视图
- **WHEN** 正文或运行 time-travel 回滚到某 checkpoint
- **THEN** 事实库 MUST 能呈现该 checkpoint 时刻的事实视图
- **AND** 该视图 MUST NOT 包含回滚点之后才引入的事实

### Requirement: 一致性视图查询
系统 MUST 支持在给定版本/ checkpoint 下读取事实库的一致视图，供正向与反向检查使用。

#### Scenario: 按版本读取
- **WHEN** 检查逻辑请求某版本下的事实视图
- **THEN** 事实库 MUST 返回该版本对应的一致事实集合，不掺入其他版本的中间状态
