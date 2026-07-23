## ADDED Requirements

### Requirement: 上下文组装运行时
`context-assembly` 契约 MUST 在本波落地为运行时组装器：按 agent + scope 装配作用范围内正文、事实库结构化召回结果（以引用）、近期 chatHistory；各 agent 声明各自组装策略，统一组装器依声明执行、不为每 agent 硬编码分支。

#### Scenario: 按声明组装不硬编码
- **WHEN** 不同专家 agent 被召唤
- **THEN** 统一组装器 MUST 依据各 agent 声明的策略装配上下文
- **AND** MUST NOT 为每个 agent 硬编码分支，MUST NOT 将整库塞入上下文

#### Scenario: 密集组装归 utilityProcess
- **WHEN** 组装涉及 CPU 密集的检索或大文本处理
- **THEN** 该计算 MUST 可在 utilityProcess 执行，主进程事件循环 MUST NOT 被阻塞
