## MODIFIED Requirements

### Requirement: 编排活图据静态图数据同源渲染

专家工作台 MUST 呈现当前或最近一次运行的工作目标、目标专家与真实执行路径。执行路径 MUST 按后端 `graph-node-activated` 事件的实际到达顺序展示，每次节点 `enter` MUST 追加一个步骤，`exit` MUST 结算对应步骤；MUST NOT 以静态中心放射拓扑代替时间顺序。节点名称与图标 MUST 复用 `WORKBENCH_GRAPH` 同源目录，MUST NOT 在 Renderer 另写一份会漂移的专家清单。

#### Scenario: 目标与目标专家明确
- **WHEN** 作者发起一次专家召唤
- **THEN** 工作台 MUST 显示该运行对应的用户目标与目标专家
- **AND** 运行完成后 MUST 保留本轮目标和最终路径，直到新运行开始

#### Scenario: 路径按实际顺序追加
- **WHEN** 运行依次经过 supervisor、writer、reviewer
- **THEN** 工作台 MUST 按该顺序显示步骤 1、2、3
- **AND** MUST NOT 仅以从中心辐射的连线表达“参与过”

#### Scenario: 循环节点不覆盖
- **WHEN** 一次运行再次进入此前经过的同名节点
- **THEN** 工作台 MUST 追加一个新的步骤实例
- **AND** MUST 保留此前同名节点步骤，不得以节点 id Map 覆盖时间线历史

### Requirement: 节点据运行状态实时染色

每个执行步骤 MUST 区分「运行中 / 完成 / 出错 / 待裁决」，并 MUST 对运行中的步骤呈现活动指示。状态数据 MUST 来自真实后端控制事件：enter→运行中、exit→完成、interrupt→待裁决、stream-error→出错。新运行 MUST 清除上一轮步骤并开始本轮路径，MUST NOT 混叠不同 runId。

#### Scenario: 实时进入与完成
- **WHEN** 某节点收到 enter 后尚未收到 exit
- **THEN** 对应最新步骤 MUST 显示运行中
- **WHEN** 随后收到 exit
- **THEN** 同一步骤 MUST 转为完成

#### Scenario: 新运行重置
- **WHEN** 新 runId 的 stream-start 或首个节点事件到达
- **THEN** 工作台 MUST 清除上一轮步骤并认领新运行
- **AND** MUST NOT 因 React activeRunId 更新时序丢弃新运行首批事件
