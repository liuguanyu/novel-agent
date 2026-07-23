## 1. Specification

- [x] 1.1 prompt-loading delta: 运行时 YAML 读盘器（读盘→解析→校验→缓存）+ 多路定位 + 回退契约。

## 2. 依赖与类型

- [x] 2.1 `js-yaml` 提升为 `package.json` 直接依赖（版本对齐已安装的 4.x）。
- [x] 2.2 补最小本地类型声明 `src/main/types/js-yaml.d.ts`（无 `@types/js-yaml`）。

## 3. 核心 helper（core，无 fs I/O）

- [x] 3.1 `prompt-loading.ts` 增 `parsePromptTemplate(raw: unknown): PromptTemplate`（Zod 校验 + 明确报错），供运行层读盘后调用。

## 4. 运行时读盘器（main）

- [x] 4.1 新增 `src/main/orchestration/prompt-loader.ts`：多路候选目录定位 + `readFileSync` + `js-yaml.load` + `parsePromptTemplate` + 模块级缓存。
- [x] 4.2 缺失/解析失败/校验失败 → 按 `MissingTemplatePolicy` 回退到传入的内置默认，并记录一次诊断（不静默、不抛未捕获）。

## 5. 外置 YAML 资产 + 接线

- [x] 5.1 新增 `src/main/orchestration/prompts/writer.yml`、`reviewer.yml`、`fact-checker.yml`（现有内联提示词等价中文化搬迁，含 settings.tier/maxTokens）。
- [x] 5.2 `prompt-registry.ts`：`FACT_CHECKER_PROMPT` 等改为「内置默认」，导出经加载器解析的模板 getter（首用即加载并缓存）。
- [x] 5.3 `graph.ts`：`WRITER_SYSTEM`/`REVIEWER_SYSTEM` 降级为回退默认，节点组 prompt 时经加载器取 `writer`/`reviewer` 模板的 `template`。

## 6. Validation

- [x] 6.1 Run node and web TypeScript checks.
- [x] 6.2 Run ESLint.
- [x] 6.3 Run OpenSpec strict validation.
- [x] 6.4 Run production build（确认 js-yaml 外置、prompts 资产可达）。
- [x] 6.5 Run `smoke:orchestration`（tsc+node 三态读盘不炸；YAML 缺失回退默认仍绿）。
