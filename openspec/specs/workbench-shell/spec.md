# workbench-shell Specification

## Purpose
TBD - created by archiving change workflow-guided-workbench. Update Purpose after archive.
## Requirements
### Requirement: 应用外壳以书目上下文和工作流进展为主线

Renderer MUST 将主界面组织为稳定的产品外壳：第一行显示产品标识与目标/显示入口，第二行显示“书架 / 当前书目”面包屑及面向作者的工作流名称，其下显示可实时更新的业务工作流 Graph；主体保持左侧书目导航、中部正文/工作面板、右侧专家对话三栏，窗口底部显示后台任务实时进展。主界面 MUST NOT 将作者目标、内部 stage 列表、事实抽取技术指标和专家运行轨迹同时常驻堆叠在正文上方。

#### Scenario: 打开进行中的书目整理
- **WHEN** 作者打开存在 active `legacy-book-revision` 工作流的书目
- **THEN** 顶部 MUST 显示“书架 / 当前书目”和面向作者的“书目整理”名称
- **AND** 工作流 Graph MUST 标识已完成、当前与待处理阶段
- **AND** 正文三栏主体 MUST 保留可用的纵向空间

#### Scenario: 工作流名称展示目标摘要
- **WHEN** 作者 hover 或聚焦“书目整理”入口
- **THEN** Renderer MUST 以 tooltip 或等价可访问浮层展示当前目标与作者要求摘要
- **AND** tooltip MUST 只用于查看摘要，编辑 MUST 通过明确的目标弹层完成

### Requirement: 作者目标通过独立弹层随时维护

顶部 MUST 提供“设定目标”入口。目标弹层 MUST 区分长期 objective 与可重复作者要求清单；每条要求 MUST 独立选择“保留”“提取”或“去掉或修复”，并可添加、修改、删除，同类要求 MUST 支持多条。工作流执行中保存目标 MUST 使用 Main 的乐观并发与幂等写入，不得直接改变当前阶段、阶段状态或正文；保存成功后 MUST 说明现有诊断可能过期以及下一次诊断将使用最新版要求。

#### Scenario: 作者为多个位置设置要求
- **WHEN** 作者分别添加两个保留要求、三个人物提取要求和多个修复要求
- **THEN** 弹层 MUST 将每条要求作为独立记录提交并在再次打开时完整恢复
- **AND** MUST NOT 将同类要求压缩为单一固定输入框

#### Scenario: 运行中更新目标
- **WHEN** 作者在事实回填或诊断之后更新 objective 或作者要求
- **THEN** Main MUST 产生 workflow 新版本并保持 `currentStageId` 与各阶段状态不变
- **AND** Renderer MUST 提示重新运行受影响的诊断
- **AND** 后续诊断 MUST 消费最新版目标/要求，旧诊断历史 MUST 保留

### Requirement: 工作流 Graph 呈现业务进展并消费真实运行状态

工作流 Graph MUST 以面向作者的中文业务节点展示长期阶段，不得暴露 stage id、actor 枚举、operation id、版本号或 impact 内部值。Graph MUST 根据持久化 workflow snapshot 更新阶段状态，并可将当前运行的章节、进度、发现数量等短摘要附着于当前节点；真实 LangGraph 节点事件仍属于运行详情，MUST NOT 被伪造成业务阶段。

#### Scenario: 事实回填实时更新当前节点
- **WHEN** 事实回填开始处理第三章且总计二十五章
- **THEN** Graph 的“建立事实底稿”节点 MUST 标识为进行中
- **AND** 当前节点 SHOULD 显示“正在处理第三章 · 3/25”或等价摘要
- **AND** 章节切换后摘要 MUST 随后端事件更新

#### Scenario: 阶段完成后推进 Graph
- **WHEN** Main 提交事实回填完成并激活全书诊断阶段
- **THEN** Graph MUST 将事实底稿节点显示为完成并将全书诊断显示为当前节点
- **AND** Renderer MUST NOT 依赖本地计时器伪造推进

### Requirement: 应用提供互斥的工作台、读书与对话专注模式

Renderer MUST 使用单一判别状态表示 `workbench`、`reading` 与 `conversation` 三种互斥视图模式，MUST NOT 通过可产生冲突组合的多个全屏布尔值表达。模式切换只改变视图，不得中断后台事实抽取、诊断或专家运行，并 MUST 保留当前书目、章节和适用的专家上下文。

#### Scenario: 进入读书模式
- **WHEN** 作者从工作台进入读书模式
- **THEN** 应用 MUST 隐藏工作流 Graph、左侧导航、右侧专家对话、Hero 连线和常驻工作面板
- **AND** MUST 以适合人类连续阅读的宽度、行高和段落间距全屏呈现当前正文
- **AND** MUST 提供返回工作台、当前书目/章节以及上一章/下一章导航

#### Scenario: 进入对话专注模式
- **WHEN** 作者从右侧对话栏选择全屏对话
- **THEN** 应用 MUST 隐藏左侧导航、中部正文、工作流 Graph 与 Hero 连线
- **AND** MUST 保留当前专家、当前任务和当前章节上下文
- **AND** MUST 提供返回工作台与召唤/切换专家入口

#### Scenario: 模式切换不停止后台任务
- **WHEN** 事实回填进行中且作者进入读书或对话专注模式
- **THEN** Main 的运行 MUST 继续
- **AND** 返回工作台后 MUST 显示最新进度而不是进入模式前的本地快照

### Requirement: 专家召唤属于对话与底部快捷入口

显式“召唤专家”入口 MUST 位于专家对话区域；全局快捷键提示 MAY 位于窗口底部角落，顶部产品栏 MUST NOT 常驻显示“⌘K 召唤”。作者 MUST 能在对话输入中使用 `@专家`，也能通过对话区域的选择器召唤或切换专家。

#### Scenario: 从对话框召唤专家
- **WHEN** 作者点击右侧对话栏的“召唤专家”
- **THEN** Renderer MUST 在对话上下文中展示专家选择入口
- **AND** 选择结果 MUST 继续通过既有召唤 IPC 发送，Renderer MUST NOT 自行执行 agent

#### Scenario: 使用全局快捷键
- **WHEN** 作者按下平台对应的召唤快捷键
- **THEN** 应用 MUST 打开与对话框相同的专家选择体验
- **AND** 底部角落 MAY 显示快捷键提示，但顶部产品栏 MUST 保持简洁

### Requirement: 底部状态栏提供可理解的实时进展

工作台底部 MUST 固定显示当前后台任务的面向作者摘要，例如“正在核对第三章事实 · 已处理 3/25 章 · 找出 3 个问题”。摘要 MUST 由真实控制事件或持久化快照更新；正常运行时 MUST 优先显示任务、当前章节、进度和需要作者关心的结果，不得默认暴露候选对象、分块、无效项、跳过项等技术指标。点击进展 MAY 打开对应详细面板。

#### Scenario: 实时显示当前章节
- **WHEN** Main 下发包含稳定 `chapterId`、`index` 和 `total` 的事实抽取开始事件
- **THEN** Renderer MUST 使用章节树将 `chapterId` 映射为真实章节路径
- **AND** 底部状态 MUST 显示当前章节和进度
- **AND** 映射失败时 MAY 降级显示稳定 id，但 MUST NOT 猜测章节名称

#### Scenario: 事实冲突需要裁决
- **WHEN** 事实回填因冲突中断
- **THEN** 底部状态 MUST 明确显示“需要作者裁决”及受影响章节
- **AND** MUST 提供打开事实底稿并定位冲突的动作
- **AND** MUST NOT 让运行在无可见反馈的情况下静默停滞

#### Scenario: 沉浸模式只保留极简状态
- **WHEN** 作者处于读书模式且后台任务继续运行
- **THEN** Renderer MAY 仅显示不遮挡正文的极简状态标记
- **AND** MUST NOT 自动将作者踢回工作台
- **AND** 必须裁决的冲突 MUST 以非破坏性提示呈现，由作者主动打开处理

### Requirement: 事实底稿按需打开而非常驻

事实底稿面板 MUST 作为按需工作面板或抽屉存在，默认不得常驻占用正文上方空间。作者 MUST 能从工作流 Graph 的“建立事实底稿”节点、底部实时进展或看板入口打开它。面板 MUST 优先展示当前章节、总体进度、人物/事件/关系/时间线/伏笔摘要与待裁决冲突；候选数、分块、无效和跳过等抽取技术详情 MUST 默认折叠。

#### Scenario: 正常事实回填不打断作者
- **WHEN** 事实回填正常处理章节且没有冲突
- **THEN** 事实底稿面板 MUST 保持作者此前选择的开闭状态
- **AND** 系统 MUST 通过底部状态栏更新进展，不得每章自动抢占主工作区

#### Scenario: 作者按需查看事实底稿
- **WHEN** 作者点击 Graph 当前节点或底部进展
- **THEN** 应用 MUST 打开事实底稿并定位当前章节
- **AND** MUST 展示已识别事实、稳定出处和需要裁决的冲突

#### Scenario: 事实底稿与 Story Bible 职责分离
- **WHEN** 作者查看事实底稿或 Story Bible
- **THEN** 事实底稿 MUST 表达证据、抽取结果和冲突裁决
- **AND** Story Bible MUST 表达整理后的已确认知识视图
- **AND** 两者 MUST NOT 作为两个内容重复的常驻面板

### Requirement: 模型任务会话与专家对话分离

事实抽取、全书诊断、针对性复检和改写方案生成等自动模型运行 MUST 记录为独立的模型任务会话，不得复用或写入作者主动发起的专家对话历史。模型任务会话 MUST 以结构化活动记录展示当前阶段、当前章节、证据摘要、结构化结果、冲突和错误；MUST NOT 展示模型隐藏思维链或未经确认的内部推理。任务会话应从底部实时进展、事实底稿或相关工作面板按需打开，不得作为常驻第四栏。

作者可以在任务会话中提交受控补充要求，但补充要求 MUST 明确作用域（仅当前章节、后续未处理章节或加入书目整理目标），默认作用域 MUST 为当前章节，且一次性补充不得自动成为长期作者要求。补充要求 MUST 触发新的任务活动或新的任务尝试，并由 Main 校验其 workflow/run/stage/chapter scope；作者不得通过自由文本直接覆盖已确认事实。

任务会话 MUST 绑定 `runId`、任务类型、工作流引用（如有）、阶段引用（如有）及章节引用（如有）。重试或根据补充要求重新抽取 MUST 创建新的 attempt 并保留旧 attempt 的活动记录、结果和失败原因。冲突 MUST 以结构化候选与裁决动作呈现，只有作者明确确认后才能写入已确认事实。

#### Scenario: 事实抽取模型运行显示独立活动
- **WHEN** 工作流自动开始抽取第三章事实
- **THEN** 事实底稿或任务会话 MUST 显示“读取章节”“模型抽取”“规则校验”“入库/冲突”等结构化活动及当前章节
- **AND** 这些活动 MUST 不出现在专家聊天历史中
- **AND** 界面 MUST 只显示可解释的阶段、证据和结果摘要，不显示隐藏思维链

#### Scenario: 作者补充当前章节的抽取要求
- **WHEN** 作者在任务会话中提交“重点检查顾长风在本章中的称谓变化”且未选择其他作用域
- **THEN** Main MUST 将补充要求按“仅当前章节”处理
- **AND** MUST 创建新的抽取尝试或等价的可追踪任务活动，不覆盖旧结果
- **AND** MUST NOT 自动修改长期书目整理目标或直接修改已确认事实

#### Scenario: 作者要求应用于后续章节
- **WHEN** 作者选择“后续未处理章节”并提交补充要求
- **THEN** Main MUST 将其绑定到后续未处理章节的任务范围
- **AND** 当前已完成章节的既有结果 MUST 保持不变
- **AND** Renderer MUST 清楚显示该作用域及其不会影响既有结果的边界

#### Scenario: 任务重试保留历史尝试
- **WHEN** 作者请求重试失败的第三章事实抽取
- **THEN** Main MUST 创建新的 `attemptId`
- **AND** 旧 attempt 的活动、结构化结果和失败原因 MUST 可查询
- **AND** 新 attempt MUST 继续绑定相同任务的适用 workflow/run/stage/chapter scope

#### Scenario: 冲突等待作者裁决
- **WHEN** 模型候选事实与已确认事实发生冲突
- **THEN** 任务会话 MUST 展示冲突双方、证据出处和结构化允许动作
- **AND** 系统 MUST 等待作者确认或拒绝后再改变 confirmed 事实
- **AND** 自由文本补充 MUST NOT 被当作确认动作

### Requirement: Hero 连线只服务非全屏工作台

问题卡片到正文的 Hero 连线 MAY 在三栏工作台中呈现，以辅助定位和修订；读书模式与对话专注模式 MUST 禁用或卸载 Hero 连线，避免无目标元素、视觉干扰和无意义的坐标计算。

#### Scenario: 对话全屏隐藏 Hero 连线
- **WHEN** 视图模式切换为 `conversation`
- **THEN** 当前 Hero 连线 MUST 不再渲染
- **AND** 返回 `workbench` 后 MAY 根据仍有效的问题选择和正文锚点恢复

