## ADDED Requirements

### Requirement: 从导入素材自动提炼候选条目
系统 MUST 支持从导入素材自动提炼候选素材条目（如高光对白、可复用桥段、叙事逻辑）。

#### Scenario: 自动提炼候选
- **WHEN** 一份外部素材被指定进入素材库
- **THEN** 系统 MUST 自动提炼候选条目，每项含类型、内容与建议标签
- **AND** 原始模型输出 MUST 经 schema 校验转强类型后方可作为候选条目

### Requirement: 提炼结果人工可改
用户 MUST 能对提炼出的候选条目进行修改、确认、打标签与删除；提炼结果不锁定。

#### Scenario: 人工修改候选
- **WHEN** 系统提炼出候选条目
- **THEN** 用户 MUST 能修改其内容、增删标签、确认收录或删除
- **AND** 未确认的候选 MUST 不影响已确认条目

### Requirement: 提炼计算的进程归属
提炼相关的 CPU 密集计算（如 embedding）MUST 在 utilityProcess 执行，不阻塞主进程。

#### Scenario: 提炼不阻塞 UI
- **WHEN** 提炼涉及 embedding 等 CPU 密集计算
- **THEN** 该计算 MUST 在 utilityProcess/worker 执行
- **AND** 主进程事件循环与 UI MUST NOT 被阻塞
