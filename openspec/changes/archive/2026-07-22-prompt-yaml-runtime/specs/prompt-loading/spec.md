## ADDED Requirements

### Requirement: 运行时 YAML 读盘与解析
提示词加载器 MUST 在运行时从外置 YAML 文件读盘、经 YAML 解析器反序列化、并以
`promptTemplateSchema` 校验后产出 `PromptTemplate`；解析或校验失败 MUST NOT 静默产出错误 prompt。

#### Scenario: 读盘并校验通过
- **WHEN** 加载器按 agent 名读取其外置 YAML（含 name/description/template/requiredVariables/settings）
- **THEN** 加载器 MUST 反序列化并以 `promptTemplateSchema` 校验
- **AND** 校验通过后 MUST 返回结构化 `PromptTemplate`，其 `settings.tier` 为 prose/reasoning/cheap-fast 之一

#### Scenario: 解析或校验失败不静默
- **WHEN** YAML 语法非法，或字段缺失/类型不符导致 schema 校验失败
- **THEN** 加载器 MUST 按既定回退策略处理（回退内置默认或报错）
- **AND** MUST 记录一次可诊断的失败信息，MUST NOT 返回一个字段残缺的模板

### Requirement: 提示词资产定位与缓存
提示词加载器 MUST 以与运行环境无关的方式定位 YAML 资产（打包产物态与源码/冒烟态均可达），
并 MUST 对已成功加载的模板做进程内缓存以避免重复读盘。

#### Scenario: 多态定位
- **WHEN** 在打包产物运行、或在以源码目录为根的冒烟/开发环境运行
- **THEN** 加载器 MUST 依次探测候选目录直至命中该 agent 的 YAML
- **AND** 全部候选均未命中时 MUST 回退到内置默认，MUST NOT 抛出未捕获异常

#### Scenario: 加载结果缓存
- **WHEN** 同一 agent 的模板被再次请求
- **THEN** 加载器 MUST 返回首次成功加载后缓存的模板，MUST NOT 重复读盘解析
