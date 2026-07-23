# corpus-retrieval Specification

## Purpose
TBD - created by archiving change corpus-library. Update Purpose after archive.
## Requirements
### Requirement: 语义检索
系统 MUST 支持按语义相似度检索素材条目，用于写作时寻找类似氛围/桥段/写法。

#### Scenario: 按语义检索
- **WHEN** 给定一个查询（如当前场景描述或关键词）
- **THEN** 系统 MUST 返回语义相似的素材条目，按相关度排序

### Requirement: 过滤与组合
系统 MUST 支持按标签、来源、类型过滤，并可与语义检索组合。

#### Scenario: 组合过滤
- **WHEN** 检索时指定标签/来源/类型过滤条件
- **THEN** 系统 MUST 仅返回同时满足语义相关与过滤条件的条目

### Requirement: 检索的进程归属
向量 embedding 计算 MUST 在 utilityProcess 执行；向量库读写作为 I/O 归 Main。

#### Scenario: 检索计算归属正确
- **WHEN** 一次语义检索需要计算查询 embedding
- **THEN** 该计算 MUST 在 utilityProcess/worker 执行
- **AND** 向量库的读写 I/O MAY 在 Main 以非阻塞方式进行

