## Why

`prompt-loading` 至今只有类型契约 + Zod schema + 纯 `fillTemplate`，**没有运行时读盘器**。writer/reviewer/fact-checker 三个已建节点的提示词仍以**代码级常量**内联在 `graph.ts`（`WRITER_SYSTEM`/`REVIEWER_SYSTEM`）与 `prompt-registry.ts`（`FACT_CHECKER_PROMPT`）中，违背 spec「提示词与代码解耦、改 persona 只编辑 YAML 不改源码」。本 change（I9 子阶段 B）落地 YAML 运行时读盘 + 校验 + 回退，并把三个提示词外置为中文 YAML 资产，为后续 C–E 各专家节点提供统一的提示词来源。

关键约束：electron-vite 默认将 `dependencies` 外置（不打进 `out/main` 单包），故三态（`electron-vite dev`/`build`、`tsc`+`node` 跑的 smoke）都由 Node 运行时从 `node_modules` 解析 `js-yaml`，无 `?raw`/glob 打包坑。YAML 采用**本项目自有 schema**（对齐现有 `promptTemplateSchema`），非照搬 LibriScribe 英文格式。

## What Changes

- 新增运行时 YAML 读盘器：读盘 → `js-yaml` 解析 → `promptTemplateSchema` 校验 → 命中缓存；文件缺失/解析失败/校验失败按 `MissingTemplatePolicy` 回退到内置默认或报错，**不静默产错误 prompt**。
- `js-yaml` 提升为直接依赖（现仅 langchain 传递依赖，脆弱），并补最小本地类型声明（无 `@types/js-yaml`）。
- 新增外置中文 YAML 资产目录 `src/main/orchestration/prompts/`：`writer.yml`、`reviewer.yml`、`fact-checker.yml`（内容为现有内联提示词的等价中文化搬迁）。
- `graph.ts` / `prompt-registry.ts` 改为经加载器取模板；内置常量降级为「YAML 缺失时的回退默认」。
- 定位策略：候选目录多路探测（打包产物同级 `prompts/` → 源码树 `src/main/orchestration/prompts/`），三态可达。

## Impact

- Affected specs: `prompt-loading`（新增运行时加载/定位/缓存的 Requirement 与 Scenario）。
- Affected code: `src/core/orchestration/prompt-loading.ts`（加解析/校验/回退 helper，保持无 fs I/O）、新增 `src/main/orchestration/prompt-loader.ts`（fs 读盘 + 定位 + 缓存）、`src/main/orchestration/prompt-registry.ts`、`src/main/orchestration/graph.ts`、新增 `src/main/orchestration/prompts/*.yml`、`package.json`（js-yaml 直接依赖）、`src/main/types/js-yaml.d.ts`（最小声明）。
- 依赖 I9 子阶段 A（已归档，fact-checker 已建）。为 C–E 后续专家节点提供提示词来源。
- 兼容性：加载失败一律回退内置默认，行为与当前内联常量等价；smoke/build 保持绿。
