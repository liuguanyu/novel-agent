# renderer-ipc-bridge Specification

## Purpose
TBD - created by archiving change walking-skeleton. Update Purpose after archive.
## Requirements
### Requirement: 受限强类型 IPC 桥
preload MUST 经 contextBridge 暴露受限、强类型的收发 API，Renderer 经此与后端通信，MUST NOT 暴露原始 ipcRenderer 或 Node/Electron 能力。Story Bible 查看 MUST 通过受限只读查询桥完成；Story Bible 确认、编辑、删除与实体合并 MUST 通过既有 sendCommand 控制命令完成。

#### Scenario: Story Bible 删除/合并命令
- **WHEN** Renderer 请求删除某条 Story Bible 事实或合并两个实体
- **THEN** preload MUST 仅通过 `sendCommand()` 转发 `delete-story-bible-fact` 或 `merge-story-bible-entities` 命令
- **AND** MUST NOT 暴露 SQLite、任意 SQL、任意文件、任意 IPC 通道或 raw JSON 写入能力

