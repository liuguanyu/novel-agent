## Why

本项目是一个 human-in-the-loop 的“小说 IDE”，涉及 Electron 桌面壳、LangGraph.js 多智能体编排、
SQLite 事实库、本地向量库、多模型适配等多个子系统。这些子系统全部依赖一套统一的**工程地基**：
进程模型、进程间通信（IPC）契约、类型与代码规范、模型适配层接口。

如果没有先把地基定死，后续每个能力域（事实库、素材库、编排、召唤、重构、总检、UI）都会各自
假设一套进程归属和通信方式，导致 UI 卡顿、类型失控、模块耦合。因此需要一个先行 change 固化
这些横切关注点，让后续所有 change 在同一套契约上并行开发。

本 change **只定义地基与契约（spec 层面）**，不实现任何业务能力。

## What Changes

- 确立 **Electron 三类进程的职责边界**：Renderer（仅渲染/交互）、Main（协调 + 异步 I/O）、
  utilityProcess/worker（CPU 密集）。规定“Agent 逻辑绝不在 Renderer”“CPU 密集绝不阻塞主进程事件循环”。
- 定义 **IPC 通信契约**：三条正交的消息通道（正文流 / 对话流 / 控制事件），强类型 discriminated union，
  带 `runId` 关联，支持流式、中断、错误。
- 定义 **模型适配层接口**：per-agent 可配置的多 provider 统一调用接口，按能力档位（强文笔/强逻辑/廉价快速）
  声明需求，不在代码中硬编码具体模型；支持流式与 AbortSignal。
- 确立 **工程规范**：TypeScript strict、禁用 `any`、职责单一、功能正交、LLM 输出经 schema 校验转强类型。
- 确立 **项目目录/模块骨架约定**：各子系统的顶层模块边界与依赖方向。

## Capabilities

### New Capabilities
- `process-model`: Electron 进程职责边界与工作负载归属规则（防 UI 卡顿的进程分层）。
- `ipc-contract`: 前后端 IPC 消息契约（通道划分、强类型消息、流式/中断/错误语义）。
- `model-adapter`: 多 provider 模型适配层接口（能力档位、per-agent 配置、流式、可中断）。
- `engineering-standards`: 全局工程规范（类型安全、禁 any、职责单一、模块边界与依赖方向）。

### Modified Capabilities
<!-- 无。这是首个 change。 -->

## Impact

- 新增项目根骨架约定（源码分层目录、进程入口划分），后续所有 change 在此之上实现。
- 约束所有后续 change 的进程归属、通信方式、类型规范；是编排/事实库/素材库/召唤/重构/总检/UI 的共同前置依赖。
- 不引入业务逻辑，不产生用户可见功能；产出为契约、接口与规范定义。
