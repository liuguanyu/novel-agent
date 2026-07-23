# quality-dashboard Specification

## MODIFIED Requirements

### Requirement: 健康度评分与红黄牌
系统 MUST 产出全局故事健康度评分与按严重度分级的问题列表。

#### Scenario: 评分与分级列表
- **WHEN** 总检完成
- **THEN** 系统 MUST 给出全局健康度评分与按 severity 分级的问题列表（CRITICAL 红牌 / WARNING 黄牌 / 其他）
- **AND** 每条问题 MUST 含定位锚点

#### Scenario: 评分可解释
- **WHEN** 呈现健康度评分
- **THEN** 评分 MUST 可由问题数量与严重度加权解释，MUST NOT 是黑盒魔数
- **AND** 权重 MAY 可配置

#### Scenario: 仪表盘呈现最新结果
- **WHEN** 作者打开质量仪表盘
- **THEN** Renderer SHOULD 展示最近一次总检的运行状态、健康分、按严重度分组的问题列表和评分解释
- **AND** Renderer MUST NOT 直接访问 SQLite、LLM 或文件系统

#### Scenario: 事实变化后体检结果标记过期
- **WHEN** 一次总检已完成后，事实底座发生变化（事实抽取完成并携带新的 factVersion，或确认/编辑/删除某条事实、或合并实体落库）
- **THEN** Renderer SHOULD 将已完成的体检结果标记为过期（stale），并以非阻塞方式提示作者重新运行总检
- **AND** Renderer MUST NOT 因事实变化自动重跑 LLM 总检（避免昂贵的 map-reduce 被隐式触发）
- **AND** 当作者重新运行总检或新一次总检完成时，Renderer MUST 清除过期标记
