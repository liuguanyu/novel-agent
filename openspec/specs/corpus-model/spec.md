# corpus-model Specification

## Purpose
TBD - created by archiving change corpus-library. Update Purpose after archive.
## Requirements
### Requirement: 素材条目模型
素材库 MUST 以类型化条目存储素材，每条目含类型、内容、标签与可空来源；类型可扩展。

#### Scenario: 类型化条目
- **WHEN** 一条素材被存入素材库
- **THEN** 其 MUST 含 `type`（highlight/style-sample/plot-device/narrative-logic/spark 等，可扩展）、
  `content` 与 `tags`
- **AND** MAY 含 `source` 来源信息

### Requirement: 弱参考语义
素材条目 MUST NOT 构成约束、MUST NOT 进入一致性检查、MUST NOT 产生 bug；仅作为可取可不取的灵感输入。

#### Scenario: 素材不触发一致性检查
- **WHEN** 素材库中存在与当前正文不同的设定或写法
- **THEN** 系统 MUST NOT 因此产出任何一致性问题或 bug
- **AND** 素材 MUST 仅在被显式检索/引用时作为参考

### Requirement: 导入意图分流
导入外部素材时，系统 MUST 允许用户选择其归宿：本作正文、参考素材、或两者兼有。

#### Scenario: 选择素材归宿
- **WHEN** 用户导入一份外部素材
- **THEN** 系统 MUST 让用户选择将其作为本作正文（进 story-workspace/story-bible）、
  参考素材（进素材库）或两者
- **AND** 归宿选择 MUST 决定该素材进入哪个子系统

### Requirement: 作用域与挂载
素材库 MUST 支持跨项目全局仓库，项目 MUST 能选择性挂载；检索作用域可限定为单篇、项目或全局。

#### Scenario: 跨项目复用
- **WHEN** 作者在多个项目中希望复用同一批素材
- **THEN** 系统 MUST 支持一个跨项目的全局素材仓库
- **AND** 各项目 MUST 能选择性挂载该全局库或使用项目私有素材

#### Scenario: 限定检索作用域
- **WHEN** 检索素材时指定作用域（单篇/项目/全局）
- **THEN** 系统 MUST 仅在该作用域内返回结果

