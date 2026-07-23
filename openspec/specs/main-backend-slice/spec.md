# main-backend-slice Specification

## Purpose
TBD - created by archiving change walking-skeleton. Update Purpose after archive.
## Requirements
### Requirement: Main 真读小说文件
Main MUST 真实读取工作区 manifest 指向的卷/章文件，构造章节树与正文，供 Renderer 显示。

#### Scenario: 读取章节树
- **WHEN** Renderer 请求章节树
- **THEN** Main MUST 从工作区 manifest 构造章节树
- **AND** 每个节点 MUST 带 story-workspace 的稳定标识符（NodeRef），MUST 排除非正文文件（如 自省报告.md）
- **AND** 若工作区尚未初始化，Main MAY 从现有 `津门余味/` 目录导入生成 manifest 后再返回章节树

#### Scenario: 读取章节正文
- **WHEN** Renderer 以 NodeRef 请求某章正文
- **THEN** Main MUST 经 manifest 将稳定 id 解析为对应 Markdown 文件
- **AND** MUST 读取对应 `.md` 文件内容并回传
- **AND** Renderer MUST 在 TipTap 正文轴显示该真实内容

#### Scenario: 防目录穿越
- **WHEN** manifest 中的 relativePath 被用于读取正文
- **THEN** Main MUST 校验解析后的路径仍位于工作区允许的内容根内
- **AND** MUST 拒绝越界路径

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

### Requirement: 进程边界
LLM 调用/读盘/prompt 组装 MUST 在 Main，MUST NOT 在 Renderer。

#### Scenario: 业务在 Main
- **WHEN** 执行读盘、prompt 组装、LLM 调用
- **THEN** 这些 MUST 在 Main 进程执行
- **AND** Renderer MUST NOT 承载 LLM 调用、读盘或 prompt 组装逻辑

