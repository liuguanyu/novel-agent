## MODIFIED Requirements

### Requirement: 受限强类型 IPC 桥
preload MUST 经 contextBridge 暴露受限、强类型的收发 API，Renderer 经此与后端通信，MUST NOT 暴露原始 ipcRenderer 或 Node/Electron 能力。Story Bible 查看 MUST 通过受限只读查询桥完成。

#### Scenario: 暴露受限收发 API
- **WHEN** preload 初始化
- **THEN** 其 MUST 经 contextBridge 暴露受限的发命令与订阅流 API，面向 shared/ipc 契约强类型化
- **AND** MUST NOT 暴露原始 ipcRenderer 对象、任意通道名或 Node/Electron 能力

#### Scenario: Story Bible 只读查询
- **WHEN** Renderer 请求 Story Bible 当前视图
- **THEN** preload MUST 通过受限 `getStoryBible()` 方法调用 Main 的查询通道
- **AND** MUST NOT 暴露 DB、fs、LLM 或任意通道调用能力

#### Scenario: 上行命令走既有契约
- **WHEN** Renderer 发起一次命令（启动运行/召唤/手刹控制）
- **THEN** 命令 MUST 序列化为既有 FrontendCommandMessage 并携带 runId
- **AND** 控制类命令 MUST 经 controlEvent 通道，MUST NOT 新增未定义通道

#### Scenario: 下行消息强类型收窄
- **WHEN** Renderer 收到后端下行消息
- **THEN** 其 MUST 按 BackendStreamMessage / 控制事件的 type 判别收窄
- **AND** 对 unknown 入口 MUST 经 Zod 校验后方可使用，MUST NOT 使用 any
