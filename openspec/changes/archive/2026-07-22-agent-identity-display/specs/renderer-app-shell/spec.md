## ADDED Requirements

### Requirement: 对话轴标注发言专家 agent
右对话轴 MUST 为每条助手消息标注其发言专家 agent（中文名 + 类别徽标），据权威 agent 目录（agent-catalog）呈现，使作者可区分是审校/写手/结构师等哪一位专家在发言；用户消息 MUST 标注「作者」。当某助手消息的 agent 未知或未在目录登记时，对话轴 MUST 回退呈现通用「助手」，MUST NOT 臆造名称或类别。Renderer MUST NOT 自行维护一份与目录漂移的 agent 名称/类别清单。

#### Scenario: 助手消息标注发言专家
- **WHEN** 一次召唤运行产生助手消息且其目标 agent 在权威目录中登记
- **THEN** 对话轴 MUST 据目录条目呈现该专家的中文名与类别徽标
- **AND** MUST NOT 在 Renderer 侧硬编码或臆造该 agent 的名称/类别

#### Scenario: 用户消息标注作者
- **WHEN** 对话轴渲染一条用户发起的消息
- **THEN** 其 MUST 标注「作者」
- **AND** MUST NOT 为用户消息附加专家类别徽标

#### Scenario: 未知 agent 回退通用助手
- **WHEN** 某助手消息未携带 agent 或其 agent 未在权威目录登记
- **THEN** 对话轴 MUST 回退呈现通用「助手」
- **AND** MUST NOT 臆造名称或类别
