## MODIFIED Requirements

### Requirement: 常驻三排工具条

应用 MUST 提供一个常驻可达的「专家工作台」承载召唤与常用能力，形态为**默认收起、有活动可展开的底部抽屉**（收起态 MUST 常驻一条状态条以呈现当前活动摘要并作为展开入口）。展开后 MUST 分三排提供入口：Agent 召唤排、看板查阅排、动作排。Agent 排 MUST 列出权威 agent 目录中的全部专家（拟人图标），点击即对当前上下文发起召唤；看板排 MUST 提供架构看板 / 事实库 / 质量仪表盘的查阅入口；动作排 MUST 提供事实抽取 / 全书回填 / 改写审阅 / 全书总检等对当前内容的操作入口。Renderer MUST NOT 在工作台内承载召唤/抽取/总检等业务，全部经既有 hook/IPC 委派后端。

#### Scenario: 工作台默认收起且可展开
- **WHEN** 应用主界面渲染
- **THEN** 专家工作台 MUST 默认收起并常驻可见其状态条
- **AND** 作者 MUST 能经状态条展开工作台
- **AND** 有活动时状态条 MUST 呈现当前活动摘要

#### Scenario: 三排入口在展开后可用
- **WHEN** 作者展开专家工作台
- **THEN** 其 MUST 呈现 Agent 排 / 看板排 / 动作排
- **AND** 各排条目 MUST 带可辨识的图标与名称

#### Scenario: Agent 排点击即召唤
- **WHEN** 作者点击 Agent 排某个专家
- **THEN** 其 MUST 产出与命令面板同构的召唤命令并经既有召唤通道下发
- **AND** Renderer MUST NOT 在本地执行该 agent 的编排或业务

#### Scenario: 看板与动作入口委派后端
- **WHEN** 作者点击看板排或动作排某入口
- **THEN** 其 MUST 打开对应查阅抽屉或经既有 hook/IPC 发起后端操作
- **AND** Renderer MUST NOT 自行计算看板数据或执行抽取/总检业务
