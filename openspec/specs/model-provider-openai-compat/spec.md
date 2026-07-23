# model-provider-openai-compat Specification

## Purpose
TBD - created by archiving change walking-skeleton. Update Purpose after archive.
## Requirements
### Requirement: OpenAI 兼容 provider adapter
系统 MUST 提供一个实现 core/model 的 ModelProviderAdapter 的 OpenAI 兼容适配器，封装鉴权/请求/流式协议，对上层透明。

#### Scenario: 流式输出
- **WHEN** 上层以 ModelCallInput 调用 adapter 的 stream()
- **THEN** adapter MUST 以 POST {baseUrl}/chat/completions 且 stream:true 消费 SSE，逐 delta 产出文本
- **AND** stream() 产出的 AsyncIterable MUST 仅包含正文内容（delta.content）

#### Scenario: 一次性输出
- **WHEN** 上层调用 adapter 的 complete()
- **THEN** adapter MUST 聚合响应为 ModelResult（text/finishReason/可选 usage）
- **AND** finishReason MUST 映射自 provider 的结束原因（stop/length/aborted）

#### Scenario: 可中断
- **WHEN** ModelCallOptions.signal 被触发（abort）
- **THEN** adapter MUST 中止请求并尽快断连以省 token
- **AND** 对应消费方 MUST 收到 aborted 语义（不抛裸异常穿透）

### Requirement: reasoning 与正文分流
对推理型模型，adapter MUST 将思考过程（reasoning_content）与正文（content）分流，正文 MUST NOT 混入思考过程。

#### Scenario: 分流思考与正文
- **WHEN** provider 响应同时含 reasoning_content 与 content
- **THEN** adapter MUST 仅把 content 作为正文产出
- **AND** reasoning_content MUST 经独立旁路（可选回调/事件）提供，供对话轴折叠展示，MUST NOT 混入正文

### Requirement: 配置驱动、密钥安全
模型 MUST 由 config/models.json 配置驱动解析，换模型不改源码；密钥 MUST NOT 硬编码或写入日志。

#### Scenario: 按配置解析档位
- **WHEN** Main 启动加载 config/models.json
- **THEN** 系统 MUST 经 Zod 校验为 provider 表与 ModelResolutionConfig
- **AND** 档位 MUST 按 perAgent[agentId][tier] > defaults[tier] 解析到具体 provider+model
- **AND** 未识别的 $comment 等注释字段 MUST 被容忍忽略

#### Scenario: 密钥来源与错误处理
- **WHEN** apiKey 为 env:VAR_NAME 形式
- **THEN** 系统 MUST 从 process.env 读取对应环境变量
- **AND** 配置缺失/无效 MUST 结构化报错（经 IPC error 呈现），MUST NOT 崩溃或硬编码密钥
- **AND** 密钥 MUST NOT 出现在日志或前端

### Requirement: provider 无关与类型安全
adapter MUST 不引入特定 provider SDK，外部响应 MUST 经校验转强类型。

#### Scenario: 无 SDK 依赖
- **WHEN** 实现 HTTP/SSE 调用
- **THEN** adapter MUST 使用内置 fetch，MUST NOT 引入第三方 provider SDK

#### Scenario: 响应校验
- **WHEN** 解析 provider 响应
- **THEN** 响应 MUST 先以 unknown 承接再经 Zod 校验/收窄
- **AND** MUST NOT 使用 any

