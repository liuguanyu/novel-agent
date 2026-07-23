## MODIFIED Requirements

### Requirement: supervisor 路由与专家节点
编排图 MUST 以 supervisor 为入口路由，将请求按当前动作/意图分发到专家节点（writer、reviewer、
fact-checker、scene-generator、plagiarism-checker、editor、style-editor、architect、character-generator、worldbuilding 等）。

#### Scenario: 按动作路由
- **WHEN** 图收到带 `currentAction`/意图的请求
- **THEN** supervisor MUST 依据该动作将执行路由到对应专家节点

#### Scenario: 专家节点可扩展
- **WHEN** 需要新增一类专家 agent
- **THEN** 系统 MUST 允许以新节点接入图，而不破坏既有节点

#### Scenario: 召唤命名的 agent 驱动路由
- **WHEN** 一次召唤命令携带 `agent`（如 `fact-checker`）且该 agent 有对应动作
- **THEN** 运行层 MUST 依据被召唤的 agent 推导出对应 `currentAction`（如 `fact-check`），使 supervisor 路由到该专家节点
- **AND** 当被召唤 agent 无专属动作时，MUST 回退到按 `mode` 推导（diagnose→review / mutate→write）
- **AND** MUST NOT 仅凭 `mode` 决定路由而忽略 `agent`

#### Scenario: fact-checker 为已落地专家节点
- **WHEN** 作者以 diagnose 模式召唤 `fact-checker` 对已有正文做事实/逻辑/世界一致性核查
- **THEN** 图 MUST 路由到已落地的 fact-checker 节点，该节点 MUST 产出统一 `ConsistencyIssue[]` 写入 activeBugs
- **AND** 存在需人工裁决的问题时 MUST 经 awaitDecision 条件性挂起，否则收敛 END
- **AND** fact-checker MUST NOT 直接改写正文（diagnose 只读诊断）

#### Scenario: scene-generator 为已落地写作类节点
- **WHEN** 作者以 mutate 模式召唤 `scene-generator` 生成某分场景正文
- **THEN** 图 MUST 路由到已落地的 scene-generator 节点，该节点 MUST 产出 currentDraft 并转入审校（reviewer）
- **AND** 审校产出可自动修的问题且循环未到上限时 MUST 能回到写作节点迭代修订
- **AND** 存在需人工裁决的问题时 MUST 经 awaitDecision 条件性挂起

#### Scenario: plagiarism-checker 为已落地审校类节点
- **WHEN** 作者以 diagnose 模式召唤 `plagiarism-checker` 对已有正文做原创性/雷同风险核查
- **THEN** 图 MUST 路由到已落地的 plagiarism-checker 节点，该节点 MUST 产出统一 `ConsistencyIssue[]` 写入 activeBugs
- **AND** 存在需人工裁决的问题时 MUST 经 awaitDecision 条件性挂起，否则收敛 END
- **AND** plagiarism-checker MUST NOT 直接改写正文（diagnose 只读诊断）
