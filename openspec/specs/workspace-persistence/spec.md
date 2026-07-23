# workspace-persistence Specification

## Purpose
TBD - created by archiving change persistence-sqlite. Update Purpose after archive.
## Requirements
### Requirement: 工作区文件层持久化
系统 MUST 以可读文件形式持久化工作区元数据、章节结构与正文，保持正文可在系统外查看/编辑并对版本控制友好。

#### Scenario: 工作区文件存在
- **WHEN** 一个工作区被创建或从现有小说目录导入
- **THEN** 系统 MUST 写入 `workspace.json` 保存工作区元数据
- **AND** MUST 写入 `manuscript.json` 保存章节树、稳定 id 与 id↔文件路径映射
- **AND** 正文 MUST 继续作为 Markdown 文件存在，MUST NOT 仅存入 SQLite

#### Scenario: 重开工作区保持 id
- **WHEN** 用户重新打开一个已有工作区
- **THEN** 系统 MUST 从 `manuscript.json` 恢复章节树
- **AND** 章节稳定 id MUST 与上次保存时一致

### Requirement: 现有小说目录导入
系统 MUST 能把现有 `津门余味/` 目录导入为工作区 manifest，而不使用 mock 数据。

#### Scenario: 首次导入
- **WHEN** 应用首次启动且尚无工作区 manifest
- **THEN** Main MUST 扫描现有 `津门余味/` 卷/章 Markdown 文件
- **AND** MUST 为每个卷/章生成稳定 id 与 manifest entry
- **AND** MUST 为章节正文计算 contentHash

### Requirement: 外部文件改动 remap
系统 MUST 检测用户在系统外移动、重命名或修改正文文件造成的映射变化，并给出结构化 remap 结果。

#### Scenario: 路径变化但内容唯一匹配
- **WHEN** manifest 中记录的章节路径不存在
- **AND** 系统在工作区中找到 contentHash 唯一匹配的 Markdown 文件
- **THEN** 系统 SHOULD 将该条目标记为 moved
- **AND** MUST 保留原稳定 id

#### Scenario: 无法安全匹配
- **WHEN** manifest 记录无法与磁盘文件唯一匹配
- **THEN** 系统 MUST 返回 missing 或 ambiguous 等结构化状态
- **AND** MUST NOT 静默把旧 id 指向可能错误的文件

