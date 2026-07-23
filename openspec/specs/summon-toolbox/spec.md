# summon-toolbox Specification

## Purpose
TBD - created by archiving change summon-toolbox. Update Purpose after archive.
## Requirements
### Requirement: 常驻三排工具条

应用 MUST 提供独立的底部工具抽屉承载 Agent 召唤排、看板查阅排与动作排。工具抽屉 MUST 默认收起，并常驻一个展开入口；它 MUST 与常驻的实时流程工作台分离，MUST NOT 再把流程画布与三排工具混装在同一个 Sheet。Agent、看板与动作条目 MUST 继续复用权威目录与既有 hook/IPC 回调。

#### Scenario: 工具抽屉默认收起
- **WHEN** 应用主界面渲染
- **THEN** 工具抽屉 MUST 默认收起并在底部提供展开入口
- **AND** 实时流程工作台 MUST 不因工具抽屉收起而隐藏

#### Scenario: 展开后保持三排能力
- **WHEN** 作者展开工具抽屉
- **THEN** MUST 呈现 Agent / 看板 / 动作三排
- **AND** 各入口的目录来源、锚点禁用规则和调用语义 MUST 与迁移前一致

### Requirement: 工具条与命令面板共用权威目录
工具条各排条目 MUST 源自权威目录：Agent 排复用 agent-catalog（`AGENT_CATALOG`），看板/动作排复用统一的工具条目录（toolbox-catalog）。工具条与命令面板 MUST NOT 各自维护一份会漂移的清单；新增/删除专家 agent MUST 同时反映在工具条与命令面板，MUST NOT 只改其一。core 目录 MUST NOT 依赖 React/图标组件库，图标以名称字符串建模、由 renderer 映射。

#### Scenario: 目录单一事实源
- **WHEN** 权威 agent 目录新增或删除一个专家
- **THEN** 工具条 Agent 排与命令面板 MUST 同步反映该增删
- **AND** MUST NOT 出现某一入口列出而另一入口遗漏

#### Scenario: 看板动作目录稳定唯一
- **WHEN** 渲染看板排与动作排
- **THEN** 其条目 MUST 源自统一 toolbox 目录且 id 唯一
- **AND** 每个条目 MUST 有非空名称与图标名

### Requirement: 需锚点召唤项在无选中章节时禁用
工具条 Agent 排中要求节点锚点的召唤项，在无选中章节时 MUST 禁用（与命令面板同规则），MUST NOT 在缺锚点时下发非法召唤命令。不需要锚点的召唤项（如面向全书/项目的策划类）MUST 始终可用。

#### Scenario: 无选中章节禁用需锚点项
- **WHEN** 当前无选中章节且某召唤项要求节点锚点
- **THEN** 该项 MUST 呈现为禁用且不可触发
- **AND** MUST NOT 下发缺锚点的非法召唤命令

#### Scenario: 无需锚点项始终可用
- **WHEN** 当前无选中章节但某召唤项不要求锚点
- **THEN** 该项 MUST 仍可点击并正常下发召唤命令

### Requirement: 对话后续意见保持专家亲和性

作者通过工具抽屉或命令面板明确召唤专家后，对话轴中的后续输入 MUST 默认继续发送给最近一次明确召唤的专家，MUST NOT 隐式切换到默认审校专家。界面 MUST 在发送前显示当前目标专家；仅当没有可识别的历史专家时，才可回退到默认诊断专家。

#### Scenario: 继续向人物设计师补充意见
- **WHEN** 作者召唤人物设计师并在其回复后输入人工意见
- **THEN** 新一轮任务的目标专家 MUST 仍为人物设计师
- **AND** 输入区 MUST 明示意见将发送给人物设计师
- **AND** 系统 MUST NOT 因普通对话输入自动切换到审校节点

#### Scenario: 首次自由提问回退默认专家
- **WHEN** 当前对话中从未出现可识别的目标专家
- **THEN** 自由提问 MAY 使用默认诊断专家
- **AND** 输入区 MUST 明示该默认专家

### Requirement: 对话支持 @专家显式路由与补全

对话输入 MUST 支持在开头通过 `@专家中文名` 或 `@agent-id` 显式指定本轮目标专家。输入 `@` 后 MUST 自动显示来自权威专家目录的候选列表，并随输入按中文名或 agent ID 过滤；候选 MUST 支持鼠标选择和键盘方向键、Enter/Tab 补全。有效 mention MUST 覆盖最近专家亲和性，并从发送给模型的自然语言指令中移除路由前缀；无法识别的 mention MUST 阻止发送并给出提示，MUST NOT 静默回退到其他专家。

#### Scenario: 输入 @ 展示并补全专家
- **WHEN** 作者在空白对话输入中键入 `@`
- **THEN** 输入区 MUST 立即展示全部可召唤专家
- **AND** 候选名称、agent ID、描述与图标 MUST 复用权威专家目录
- **WHEN** 作者继续输入中文名或 agent ID 片段
- **THEN** 候选 MUST 实时过滤
- **AND** 作者 MUST 能通过鼠标点击或方向键加 Enter/Tab 完成补全

#### Scenario: 中文名切换专家
- **WHEN** 作者输入 `@人物设计师 请补充人物弱点`
- **THEN** 本轮目标专家 MUST 为人物设计师
- **AND** 发送给专家的指令 MUST 为 `请补充人物弱点`
- **AND** 输入区 MUST 在发送前预览人物设计师为目标

#### Scenario: agent ID 切换专家
- **WHEN** 作者输入 `@fact-checker：核对年龄`
- **THEN** 本轮目标专家 MUST 为事实核查官
- **AND** 中文或英文常见分隔标点 MUST 被正确剥离

#### Scenario: 未知 mention 阻止误投
- **WHEN** 作者输入无法匹配权威专家目录的 `@名称`
- **THEN** 输入区 MUST 显示未找到专家的错误
- **AND** 发送动作 MUST 被禁用
- **AND** 系统 MUST NOT 将该消息交给最近专家或默认专家

