# model-adapter Specification

## Purpose
TBD - created by archiving change bootstrap-foundation. Update Purpose after archive.
## Requirements
### Requirement: 统一模型调用接口
系统 MUST 提供统一的 `ModelAdapter` 接口，封装不同 provider 的鉴权、请求格式与流式协议差异，
对上层 agent 透明。

#### Scenario: provider 差异对上层透明
- **WHEN** 某 agent 通过 `ModelAdapter` 发起一次调用
- **THEN** 该 agent MUST NOT 依赖任何特定 provider 的请求/响应细节
- **AND** 切换底层 provider MUST NOT 要求修改 agent 逻辑

#### Scenario: 输入输出契约稳定
- **WHEN** 调用 `ModelAdapter`
- **THEN** 输入 MUST 至少包含消息序列与调用选项（temperature、maxTokens、AbortSignal）
- **AND** 输出 MUST 支持流式 token 与最终结果两种消费方式

### Requirement: 能力档位声明与运行时映射
系统 MUST 允许 agent 按“能力档位”（如 prose / reasoning / cheap-fast）声明模型需求，
并在运行时由用户配置将档位映射到具体 provider 与模型；MUST NOT 在代码中硬编码具体模型。

#### Scenario: agent 只声明档位
- **WHEN** 定义某个 agent 对模型的需求
- **THEN** 该 agent MUST 以能力档位声明，而非直接引用具体模型名

#### Scenario: 运行时按配置解析模型
- **WHEN** 某能力档位在运行时被使用
- **THEN** 系统 MUST 依据用户配置将其解析为具体 provider+model
- **AND** 用户 MUST 能为每个 agent 单独覆盖其档位到模型的映射

#### Scenario: 更换模型无需改代码
- **WHEN** 用户希望更换某档位使用的模型
- **THEN** 该更换 MUST 仅通过配置完成，不需修改源码

### Requirement: 流式输出与可中断
系统 MUST 支持模型调用的流式输出，并支持通过 `AbortSignal` 即时中断以停止生成、节省 token。

#### Scenario: 流式消费
- **WHEN** 一次模型调用被发起
- **THEN** 调用方 MUST 能在生成过程中逐步接收 token

#### Scenario: 通过 AbortSignal 中断
- **WHEN** 调用方在生成过程中触发关联的 `AbortSignal`
- **THEN** 该次模型请求 MUST 被中止
- **AND** 系统 SHOULD 尽快断开与 provider 的连接以停止计费

### Requirement: 结构化输出边界校验
系统 MUST 对来自模型的非结构化输出在进入系统前进行 schema 校验并转为强类型，禁止未校验的 `any` 穿透。

#### Scenario: 非结构化输出经校验转型
- **WHEN** agent 期望模型返回结构化数据（如 bug 列表、事实条目）
- **THEN** 原始输出 MUST 先经 schema 校验
- **AND** 仅当校验通过后其强类型结果方可进入后续流程

