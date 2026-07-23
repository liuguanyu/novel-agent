## MODIFIED Requirements

### Requirement: 单 agent 直调 LLM 流式回推
Main MUST 处理对话/召唤：将召唤命令注入长驻的有状态编排图以改变路由，由专家节点组 prompt、调用真实 LLM adapter、经 IPC 流式回推；MUST NOT 再走 walking-skeleton 的单 agent 直调，MUST NOT 为每次召唤新建单发图。

#### Scenario: 发起召唤并流式回推
- **WHEN** Renderer 经桥发起一次对话/召唤命令（携 runId）
- **THEN** Main MUST 向同一张持久化编排图注入命令改变下一跳路由
- **AND** 专家节点 MUST 组装 prompt、按档位解析模型、调用 adapter.stream()
- **AND** MUST 将增量经 dialogueStream 通道分片回推（BackendStreamMessage），Renderer 消息形状保持不变

#### Scenario: 手刹中断
- **WHEN** Renderer 经桥发起 abort（针对某 runId）
- **THEN** Main MUST 触发该运行的中断，使 adapter 断连
- **AND** MUST 回推 aborted 语义，MUST NOT 影响其他并发运行

#### Scenario: 接通恢复语义
- **WHEN** Renderer 经桥发起 resume-run（携 runId 与决策数据）
- **THEN** Main MUST 将决策传入编排图从挂起点继续
- **AND** MUST NOT 重跑已完成节点
