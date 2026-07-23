## 1. 进程模型与骨架约定

- [x] 1.1 确定源码分层目录约定：`main/`、`renderer/`、`workers/`、`shared/`、`core/`，并写入项目 README/约定文档
- [x] 1.2 定义 `shared/` 边界规则（仅类型与契约，无实现），并在约定文档中给出反例清单
- [x] 1.3 定义工作负载归属清单：将已知任务（LLM 调用、SQLite、文件 I/O、embedding、diff、Map-Reduce 总检、文档解析）逐项归类到 Main 或 utilityProcess
- [x] 1.4 定义 Main ↔ utilityProcess 的任务派发与结果回传约定（进程边界契约，不含实现）

## 2. IPC 契约

- [x] 2.1 定义三通道标识与用途（manuscript-stream / dialogue-stream / control-event）
- [x] 2.2 定义后端→前端流式消息类型（开始/分片/结束/错误），含 `runId` 与 `type` 判别字段
- [x] 2.3 定义前端→后端命令消息类型（发起运行、abort、resume 等占位），含 `runId`
- [x] 2.4 定义错误消息类型（作为一等控制事件，含 `runId` 与错误分类）
- [x] 2.5 在 `shared/` 中以 discriminated union 形式落定上述消息类型定义（类型定义，非业务实现）

## 3. 模型适配层接口

- [x] 3.1 定义 `ModelAdapter` 接口：输入（消息序列 + 选项：temperature/maxTokens/AbortSignal），输出（流式 token + 最终结果）
- [x] 3.2 定义能力档位枚举（prose / reasoning / cheap-fast，允许扩展）
- [x] 3.3 定义“档位 → provider+model”配置结构，支持全局默认与 per-agent 覆盖
- [x] 3.4 定义 provider 适配契约（鉴权/请求/流式协议由适配层内部封装，对上层透明）
- [x] 3.5 定义结构化输出的 schema 校验边界约定（Zod 校验点位置与失败处理策略）

## 4. 工程规范落定

- [x] 4.1 记录 TypeScript strict / noImplicitAny 与 ESLint no-explicit-any 规则要求
- [x] 4.2 记录“未知数据用 unknown + 收窄/Zod”的处理准则与示例
- [x] 4.3 记录职责单一与依赖方向规则（agent 节点/模型层/数据层/IPC 层各自的禁止事项）
- [x] 4.4 将上述规范汇总为项目约定文档，作为后续所有 change 的公共约束引用

## 5. 校验

- [x] 5.1 `openspec validate bootstrap-foundation --strict` 通过
- [x] 5.2 与后续 change（story-workspace、agent-orchestration 等）的前置依赖关系在路线图中标注一致
