# context-assembly Specification

## Purpose
TBD - created by archiving change on-demand-summon. Update Purpose after archive.
## Requirements
### Requirement: 按 agent 与 scope 自动组装上下文
系统 MUST 根据召唤命令的 `agent` 与 `scope` 自动组装调用上下文，输入以引用/检索结果进入，MUST NOT 塞整库。

#### Scenario: 装配四类来源
- **WHEN** 处理一次召唤
- **THEN** 组装器 MUST 按需装配：作用范围内正文文本、相关事实（story-bible 按作用域/版本引用检索）、
  相关素材（corpus-library 语义检索）、近期对话历史（orchestration-state 的 chatHistory）
- **AND** MUST NOT 将整个事实库或素材库内容复制进上下文

#### Scenario: 组装策略按 agent 声明
- **WHEN** 不同专家 agent（如审稿官 vs 写手）被召唤
- **THEN** 系统 MUST 允许各 agent 声明各自的上下文组装策略
- **AND** 统一组装器 MUST 依据声明执行，不为每个 agent 硬编码分支

#### Scenario: 引用而非整库
- **WHEN** 上下文需要事实或素材
- **THEN** 其 MUST 以版本/作用域引用或语义检索结果进入
- **AND** MUST 对齐 orchestration-state 的“上下文以引用进入状态”

### Requirement: 组装的进程归属
上下文组装若属 CPU 密集（如大规模语义检索/大文本装配）MUST 在 utilityProcess 执行。

#### Scenario: 密集组装不阻塞 UI
- **WHEN** 组装涉及 CPU 密集的检索或大文本处理
- **THEN** 该计算 MUST 在 utilityProcess/worker 执行
- **AND** 主进程事件循环与 UI/IPC MUST NOT 被阻塞

### Requirement: 上下文组装运行时
`context-assembly` 契约 MUST 在本波落地为运行时组装器：按 agent + scope 装配作用范围内正文、事实库结构化召回结果（以引用）、近期 chatHistory；各 agent 声明各自组装策略，统一组装器依声明执行、不为每 agent 硬编码分支。

#### Scenario: 按声明组装不硬编码
- **WHEN** 不同专家 agent 被召唤
- **THEN** 统一组装器 MUST 依据各 agent 声明的策略装配上下文
- **AND** MUST NOT 为每个 agent 硬编码分支，MUST NOT 将整库塞入上下文

#### Scenario: 密集组装归 utilityProcess
- **WHEN** 组装涉及 CPU 密集的检索或大文本处理
- **THEN** 该计算 MUST 可在 utilityProcess 执行，主进程事件循环 MUST NOT 被阻塞

#### Scenario: fact-checker 声明一致性核查策略
- **WHEN** 召唤 `fact-checker` 做事实/逻辑/世界一致性核查
- **THEN** 组装策略登记表 MUST 含 `fact-checker` 条目，声明其召回事实、实体与时间线（一致性核查需跨章事实与时序）
- **AND** 统一组装器 MUST 依该声明执行，MUST NOT 为 fact-checker 硬编码分支

