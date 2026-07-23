## MODIFIED Requirements

### Requirement: 人类可读的本地存储布局
系统 MUST 以人类可读、可在编辑器外手工修改、且对版本控制友好的形式在本地存储工作区；SQLite MAY 用于运行态/索引态数据，但 MUST NOT 取代正文与结构清单的可读文件存储。

#### Scenario: 正文以 Markdown 落盘
- **WHEN** 持久化正文
- **THEN** 正文 MUST 以 Markdown 文本形式存储
- **AND** 用户 MUST 能在本系统之外直接查看与手工编辑该正文
- **AND** 正文本体 MUST NOT 仅存储在 SQLite 中

#### Scenario: 结构与元数据可读
- **WHEN** 持久化章节树与元数据
- **THEN** 其 MUST 以显式、可读的文本形式存储，避免不可读的二进制黑盒
- **AND** 稳定 id 与文件路径映射 MUST 能从可读 manifest 中恢复

#### Scenario: 版本控制友好
- **WHEN** 工作区被纳入版本控制（如 Git）
- **THEN** 存储布局 SHOULD 产生清晰、可 diff 的文本变更
