## ADDED Requirements

### Requirement: 人类可读的本地存储布局
系统 MUST 以人类可读、可在编辑器外手工修改、且对版本控制友好的形式在本地存储工作区。

#### Scenario: 正文以 Markdown 落盘
- **WHEN** 持久化正文
- **THEN** 正文 MUST 以 Markdown 文本形式存储
- **AND** 用户 MUST 能在本系统之外直接查看与手工编辑该正文

#### Scenario: 结构与元数据可读
- **WHEN** 持久化章节树与元数据
- **THEN** 其 MUST 以显式、可读的文本形式存储，避免不可读的二进制黑盒

#### Scenario: 版本控制友好
- **WHEN** 工作区被纳入版本控制（如 Git）
- **THEN** 存储布局 SHOULD 产生清晰、可 diff 的文本变更

### Requirement: 标识符持久化与鲁棒映射
稳定标识符 MUST 被持久化，且其与文件的映射对用户的手工文件改动尽量鲁棒，必要时可重建映射。

#### Scenario: 标识符持久保存
- **WHEN** 工作区被保存并重新打开
- **THEN** 各节点的稳定标识符 MUST 被完整保留

#### Scenario: 手工改动后可重建映射
- **WHEN** 用户在系统之外手工移动或重命名了正文文件，导致标识符映射受影响
- **THEN** 系统 MUST 能在打开工作区时检测并提供重建映射的途径
- **AND** MUST NOT 因此静默丢失或错配已有标识符引用
