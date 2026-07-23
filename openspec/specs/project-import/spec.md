# project-import Specification

## Purpose
TBD - created by archiving change story-workspace. Update Purpose after archive.
## Requirements
### Requirement: 两种创作起点
系统 MUST 同时支持“全新创作”（空工作区）与“导入既有小说”两种起点，二者最终收敛为同一工作区模型。

#### Scenario: 全新创作
- **WHEN** 用户选择从零开始创作
- **THEN** 系统 MUST 创建一个仅含元数据、章节树为空或含占位的工作区

#### Scenario: 导入既有小说
- **WHEN** 用户选择导入一批既有 Markdown 章节
- **THEN** 系统 MUST 将其解析为符合 manuscript-model 的章节树与正文
- **AND** 生成的工作区 MUST 与全新创作的工作区在结构上一致，下游能力无需区分来源

### Requirement: 导入解析保真
导入解析 MUST 保留原始正文内容，不得在导入阶段擅自改写、润色或修复。

#### Scenario: 原文保真
- **WHEN** 导入解析一份既有章节
- **THEN** 解析后的正文内容 MUST 与原文逐字一致
- **AND** MUST NOT 进行任何自动润色、纠错或结构改写

#### Scenario: 记录来源
- **WHEN** 一份文件被导入
- **THEN** 系统 MUST 记录其来源路径，以便回溯与再导入

### Requirement: 边界识别与歧义人工确认
导入 MUST 基于 Markdown 标题层级与文件组织推断卷/章边界；在歧义或识别失败时 MUST 请求用户确认，
而非静默猜测。

#### Scenario: 依据结构推断边界
- **WHEN** 导入一批 Markdown 文件
- **THEN** 系统 MUST 依据标题层级与文件/目录组织推断卷、章及标题

#### Scenario: 歧义时降级为人工确认
- **WHEN** 边界或标题存在歧义，或结构无法可靠识别
- **THEN** 系统 MUST 向用户呈现推断结果并请求确认或手工调整
- **AND** MUST NOT 在不告知用户的情况下静默采用不确定的推断

#### Scenario: 大文档在 utilityProcess 解析
- **WHEN** 导入的文档体量较大，解析属 CPU 密集操作
- **THEN** 解析 MUST 在 utilityProcess/worker 中执行，不得阻塞主进程事件循环

