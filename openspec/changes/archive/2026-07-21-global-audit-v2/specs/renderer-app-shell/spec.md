## MODIFIED Requirements

### Requirement: 仪表盘抽屉与一键跳章落地
底部抽屉 MUST 呈现 global-audit 的健康度评分与红黄牌列表，点击问题经 toJumpIntent 触发正文轴一键跳章。

#### Scenario: 呈现体检结果并跳章
- **WHEN** 仪表盘抽屉展开（本波数据可为后端初始空态或已有总检结果）
- **THEN** 其 MUST 呈现 QualityDashboard 的健康度评分与按严重度分级的问题列表
- **AND** 点击问题 MUST 经 electron-shell-ui 的 toJumpIntent 以稳定标识符定位、使正文轴滚动至对应节点

#### Scenario: 手动运行全书总检
- **WHEN** 作者在仪表盘抽屉点击运行全书总检
- **THEN** Renderer MUST 经受限 IPC 桥发送 `run-global-audit` 命令
- **AND** Renderer MUST 展示 started/progress/completed/failed 控制事件
- **AND** Renderer MUST NOT 直接读取事实库、正文文件或调用 LLM

#### Scenario: 中断全书总检
- **WHEN** 总检正在运行且作者点击停止
- **THEN** Renderer MUST 发送既有 `abort-run` 命令
- **AND** 后端 SHOULD 以 global-audit-failed(category=aborted) 结束该运行
