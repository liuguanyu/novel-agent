## MODIFIED Requirements

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
