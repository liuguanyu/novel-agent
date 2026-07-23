# engineering-standards Specification

## Purpose
TBD - created by archiving change bootstrap-foundation. Update Purpose after archive.
## Requirements
### Requirement: 类型安全与禁用 any
代码库 MUST 启用 TypeScript strict 模式并禁用显式 `any`；未知数据 MUST 以 `unknown` 加类型收窄处理。

#### Scenario: strict 与 no-any 强制
- **WHEN** 编译或静态检查任意源码
- **THEN** TypeScript MUST 以 `strict: true` 与 `noImplicitAny: true` 运行
- **AND** ESLint MUST 将 `@typescript-eslint/no-explicit-any` 置为 error

#### Scenario: 未知数据用 unknown
- **WHEN** 处理类型未知的外部数据（如第三方库或模型返回）
- **THEN** 该数据 MUST 以 `unknown` 承接并经类型收窄或 schema 校验后使用
- **AND** MUST NOT 以 `any` 绕过类型系统

### Requirement: 职责单一
每个模块、类或函数 MUST 只承担单一职责、只有单一变更理由。

#### Scenario: agent 节点职责边界
- **WHEN** 实现一个 agent 节点
- **THEN** 该节点 MUST 仅负责“组装 prompt、调用模型、解析输出”
- **AND** MUST NOT 直接执行持久化、IPC 或 UI 相关逻辑

#### Scenario: 模型适配层无业务逻辑
- **WHEN** 实现模型适配层
- **THEN** 其 MUST 仅负责统一调用与 provider 切换
- **AND** MUST NOT 包含任何小说业务逻辑

### Requirement: 功能正交与依赖方向
各子系统 MUST 保持功能正交、边界清晰，且依赖方向单向，不得反向依赖 UI。

#### Scenario: 数据层不感知 UI
- **WHEN** 实现事实库、素材库或正文数据层
- **THEN** 这些模块 MUST NOT 依赖或感知任何 UI/渲染层

#### Scenario: IPC 层只做路由与序列化
- **WHEN** 实现 IPC 层
- **THEN** 其 MUST 仅负责消息路由与序列化
- **AND** MUST NOT 包含业务判断

#### Scenario: 依赖单向
- **WHEN** 任意业务模块引用其他模块
- **THEN** 依赖方向 MUST 单向（业务模块 → 契约/共享类型），业务模块 MUST NOT 反向依赖 Renderer/UI

