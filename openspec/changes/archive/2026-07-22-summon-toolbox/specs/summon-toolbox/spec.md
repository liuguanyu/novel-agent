## ADDED Requirements

### Requirement: 常驻三排工具条
应用 MUST 提供一个常驻可见的工具条，把召唤与常用能力摆在明面上，分三排：Agent 召唤排、看板查阅排、动作排。Agent 排 MUST 列出权威 agent 目录中的全部专家（拟人图标），点击即对当前上下文发起召唤；看板排 MUST 提供架构看板 / 事实库 / 质量仪表盘的查阅入口；动作排 MUST 提供事实抽取 / 全书回填 / 改写审阅 / 全书总检等对当前内容的操作入口。工具条 MAY 折叠。Renderer MUST NOT 在工具条内承载召唤/抽取/总检等业务，全部经既有 hook/IPC 委派后端。

#### Scenario: 三排常驻可见
- **WHEN** 应用主界面渲染
- **THEN** 工具条 MUST 常驻可见并呈现 Agent 排 / 看板排 / 动作排
- **AND** 各排条目 MUST 带可辨识的图标与名称

#### Scenario: Agent 排点击即召唤
- **WHEN** 作者点击 Agent 排某个专家
- **THEN** 其 MUST 产出与命令面板同构的召唤命令并经既有召唤通道下发
- **AND** Renderer MUST NOT 在本地执行该 agent 的编排或业务

#### Scenario: 看板与动作入口委派后端
- **WHEN** 作者点击看板排或动作排某入口
- **THEN** 其 MUST 打开对应查阅抽屉或经既有 hook/IPC 发起后端操作
- **AND** Renderer MUST NOT 自行计算看板数据或执行抽取/总检业务

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
