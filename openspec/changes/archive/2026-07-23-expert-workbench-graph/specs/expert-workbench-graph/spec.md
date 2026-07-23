## ADDED Requirements

### Requirement: 编排活图据静态图数据同源渲染

专家工作台 MUST 呈现一张编排活图：以 `supervisor` 为中心路由节点、各专家节点按类别环绕，节点与边 MUST 源自与 `graph-topology`（`EXPERT_NODES` / `ACTION_ROUTING`）同源派生的静态图数据（`WORKBENCH_GRAPH`），MUST NOT 在渲染层另写一份会与图拓扑漂移的节点/边清单。core 图数据 MUST NOT 依赖 React / 图标组件库（图标以名称字符串建模）。

#### Scenario: 活图节点与边覆盖编排拓扑
- **WHEN** 专家工作台展开渲染活图
- **THEN** 活图 MUST 呈现 `supervisor` 中心节点与 `EXPERT_NODES` 全部专家节点
- **AND** 节点与边 MUST 源自 `WORKBENCH_GRAPH`（与路由表同源）
- **AND** MUST NOT 出现图拓扑已登记而活图遗漏的专家节点

#### Scenario: 图数据不与拓扑漂移
- **WHEN** 图拓扑新增或删除一个专家节点
- **THEN** `WORKBENCH_GRAPH` 节点集 MUST 随之增删（编译期绑定）
- **AND** MUST NOT 只改其一而漂移

### Requirement: 节点据运行状态实时染色

活图 MUST 据当前运行状态给节点着色，区分至少「空闲 / 运行中 / 完成 / 出错 / 待裁决」，并 MUST 对运行中的节点呈现活动指示（如脉冲）。染色数据 MUST 以可容纳多个节点同时具态的模型（节点 id → 活动态映射）承载，MUST NOT 写死为「只能点亮单一节点」的结构，以便后续接入逐节点事件时画布无需重写。

#### Scenario: 召唤运行时点亮对应节点
- **WHEN** 作者发起一次召唤且该运行进行中
- **THEN** 活图 MUST 把该运行对应的专家节点着为「运行中」并呈现活动指示
- **AND** 运行正常结束后 MUST 转为「完成」，出错时 MUST 转为「出错」

#### Scenario: 待裁决态如实反映
- **WHEN** 某运行因一致性问题挂起等待作者裁决
- **THEN** 活图 MUST 把对应节点着为「待裁决」
- **AND** 作者裁决恢复或终止后 MUST 相应更新节点态

#### Scenario: 染色模型容纳多节点
- **WHEN** 活动态数据模型承载运行信息
- **THEN** 其 MUST 为「节点 id → 活动态」的映射结构，可同时表达多个节点具态
- **AND** MUST NOT 以「当前唯一节点」的单值结构建模
