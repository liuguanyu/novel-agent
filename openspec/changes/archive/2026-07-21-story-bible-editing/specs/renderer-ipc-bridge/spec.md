## MODIFIED Requirements

### Requirement: 受限强类型 IPC 桥
preload MUST 经 contextBridge 暴露受限、强类型的收发 API，Renderer 经此与后端通信，MUST NOT 暴露原始 ipcRenderer 或 Node/Electron 能力。Story Bible 查看 MUST 通过受限只读查询桥完成；Story Bible 确认与编辑 MUST 通过既有 sendCommand 控制命令完成。

#### Scenario: Story Bible 编辑命令
- **WHEN** Renderer 请求编辑某条 Story Bible 事实
- **THEN** preload MUST 仅通过 `sendCommand()` 转发 `edit-story-bible-fact` 命令
- **AND** MUST NOT 暴露 SQLite、任意 SQL、任意文件、任意 IPC 通道或 raw JSON 写入能力
