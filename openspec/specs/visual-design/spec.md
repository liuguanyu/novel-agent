# visual-design Specification

## Purpose
TBD - created by archiving change visual-design. Update Purpose after archive.
## Requirements
### Requirement: 主题三态持久与解析
应用 MUST 支持「浅色 / 深色 / 跟随系统」三态主题偏好，并在顶栏提供三态切换控件。主题偏好 MUST 持久化（localStorage），下次启动 MUST 恢复上次偏好；「跟随系统」时 MUST 依据 `prefers-color-scheme` 解析实际明暗并在系统偏好变化时实时跟随。已解析的明暗 MUST 通过根元素 `.dark` class 生效于全部设计 token。主题解析（偏好 + 系统明暗 → 实际明暗）与三态循环 MUST 由 core 纯函数承担，MUST NOT 依赖 React/DOM。

#### Scenario: 三态切换与持久化
- **WHEN** 作者在顶栏切换主题为「深色」
- **THEN** 根元素 MUST 应用 `.dark` 并使全部 token 切换为深墨配色
- **AND** 该偏好 MUST 写入 localStorage，下次启动 MUST 恢复为「深色」

#### Scenario: 跟随系统实时解析
- **WHEN** 偏好为「跟随系统」且系统由浅色切为深色
- **THEN** 应用 MUST 无需刷新即解析为深色并应用 `.dark`
- **AND** 解析逻辑 MUST 由 core 纯函数（偏好 + 系统明暗 → 实际明暗）给出

#### Scenario: 主题解析为纯函数
- **WHEN** 以 `(preference, systemPrefersDark)` 求实际明暗或求下一个循环偏好
- **THEN** core MUST 提供纯函数完成，MUST NOT 读取 DOM 或依赖 React

### Requirement: agent 拟人图标全覆盖
权威 agent 目录（agent-catalog）中每个专家 agent MUST 携带一个拟人化图标标识（图标名字符串），覆盖已落地的全部专家节点，遗漏 MUST 在编译期暴露。呈现层（对话轴、命令面板）MUST 在展示某 agent 处一并呈现其图标。core 目录 MUST NOT 直接依赖图标组件库（lucide/React），图标以名称字符串建模、由 renderer 映射为组件；未知图标名 MUST 有兜底组件而非崩溃。

#### Scenario: 目录每个 agent 都有图标
- **WHEN** 遍历权威目录条目
- **THEN** 每个条目 MUST 有非空图标名
- **AND** 新增/删除专家而漏配图标 MUST 触发编译期错误（Record 穷尽）

#### Scenario: 呈现层显示 agent 图标
- **WHEN** 对话轴渲染某专家助手消息或命令面板列出某召唤项
- **THEN** 其 MUST 在名称旁呈现该 agent 的拟人图标
- **AND** 图标名未知时 MUST 回退兜底图标，MUST NOT 崩溃

### Requirement: 章节导航可折叠
左导航轴的卷（非章节的层级节点）MUST 可折叠/展开，提供明确的展开/收起指示；折叠某卷 MUST 隐藏其子章节、展开 MUST 复现。章节叶节点 MUST 仍可点击并触发正文加载。导航轴 MUST 使用统一设计 token，MUST NOT 残留硬编码颜色。

#### Scenario: 折叠与展开卷
- **WHEN** 作者点击某卷的折叠指示
- **THEN** 该卷下的章节 MUST 隐藏且指示变为「已收起」
- **AND** 再次点击 MUST 复现其章节

#### Scenario: 章节点击不受折叠逻辑干扰
- **WHEN** 作者点击某已展开卷下的章节
- **THEN** 其 MUST 触发正文加载并标记为选中
- **AND** 卷标题点击 MUST 只切换折叠、MUST NOT 被误当作章节选中

### Requirement: 中文阅读排版
正文轴 MUST 采用阅读级中文排版：衬线阅读字体栈、适于长文阅读的行高与段距、段落首行缩进，并遵循 CJK 标点排布。正文轴 MUST 使用设计 token，MUST NOT 残留硬编码背景/文字色。排版 MUST 在明暗两主题下均清晰可读。

#### Scenario: 正文应用阅读级排版
- **WHEN** 正文轴渲染某章节正文
- **THEN** 其 MUST 应用衬线阅读字体、阅读级行高/段距与首行缩进
- **AND** MUST 使用设计 token 而非硬编码 `bg-white`/`gray-*`

### Requirement: 动效尊重 reduced-motion
界面过渡与状态反馈（抽屉/面板过渡、流式指示、加载态、红黄牌与中断强调）MAY 使用动效，但 MUST 在 `prefers-reduced-motion: reduce` 下收敛为无非必要动画。动效 MUST NOT 成为获取信息的唯一通道（信息 MUST 另有静态呈现）。

#### Scenario: 减少动效偏好被尊重
- **WHEN** 系统设置 `prefers-reduced-motion: reduce`
- **THEN** 非必要过渡/动画 MUST 被禁用或大幅弱化
- **AND** 对应状态信息 MUST 仍通过静态样式可得

### Requirement: 品牌与设计 token 一致性
应用外壳 MUST 呈现统一品牌标识（顶栏标识而非裸文字），并采用一致的「宣纸墨色 + 朱砂点缀」设计 token。各抽屉/面板/命令面板 MUST 收敛到同一 token 体系，MUST NOT 残留与主题漂移的硬编码调色板；空状态 MUST 有明确文案与样式。

#### Scenario: 外壳与面板统一 token
- **WHEN** 审视顶栏、导航、正文、对话与各抽屉
- **THEN** 其配色 MUST 源自统一设计 token 并随主题切换
- **AND** MUST NOT 残留独立于主题的硬编码调色板

