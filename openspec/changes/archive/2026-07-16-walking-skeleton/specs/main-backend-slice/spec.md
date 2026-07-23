## ADDED Requirements

### Requirement: Main 真读小说文件
Main MUST 真实读取项目内 津门余味/ 的卷/章文件，构造章节树与正文，供 Renderer 显示。

#### Scenario: 读取章节树
- **WHEN** Renderer 请求章节树
- **THEN** Main MUST 扫描 津门余味/ 目录（卷=子目录、章=.md 文件）构造章节树
- **AND** 每个节点 MUST 带 story-workspace 的稳定标识符（NodeRef），MUST 排除非正文文件（如 自省报告.md）

#### Scenario: 读取章节正文
- **WHEN** Renderer 以 NodeRef 请求某章正文
- **THEN** Main MUST 读取对应 .md 文件内容并回传
- **AND** Renderer MUST 在 TipTap 正文轴显示该真实内容

### Requirement: 单 agent 直调 LLM 流式回推
Main MUST 处理对话/召唤：组 prompt、调用真实 LLM adapter、经 IPC 流式回推，本波不引 LangGraph 编排。

#### Scenario: 发起召唤并流式回推
- **WHEN** Renderer 经桥发起一次对话/召唤命令（携 runId）
- **THEN** Main MUST 组装 prompt、按档位解析模型、调用 adapter.stream()
- **AND** MUST 将增量经 manuscriptStream/dialogueStream 通道分片回推（BackendStreamMessage）
- **AND** 本波 MUST 单 agent 直调，MUST NOT 依赖 LangGraph 多智能体编排

#### Scenario: 手刹中断
- **WHEN** Renderer 经桥发起 abort（针对某 runId）
- **THEN** Main MUST 触发该运行的 AbortController，使 adapter 断连
- **AND** MUST 回推 aborted 语义，MUST NOT 影响其他并发运行

### Requirement: 进程边界
LLM 调用/读盘/prompt 组装 MUST 在 Main，MUST NOT 在 Renderer。

#### Scenario: 业务在 Main
- **WHEN** 执行读盘、prompt 组装、LLM 调用
- **THEN** 这些 MUST 在 Main 进程执行
- **AND** Renderer MUST NOT 承载 LLM 调用、读盘或 prompt 组装逻辑
