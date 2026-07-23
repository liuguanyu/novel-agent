# LibriScribe 提示词存档（参考素材）

本目录存档自开源项目 **LibriScribe** 的 `prompts/templates/`，用于本项目多智能体角色分工与提示词的**借鉴/移植参考**。

- 来源仓库: https://github.com/guerra2fernando/libriscribe
- 许可证: MIT License（作者 Fernando Guerra 和 Lenxys）
- 抓取日期: 2026-07-15
- 抓取分支: `main`

## 用途说明

这些是**参考存档**，不是本项目的运行时资产。本项目会在此基础上：

1. 借鉴其 **Agent 角色分工**（写手 / 审稿 / 事实核查 / 编辑 / 文风 / 大纲 / 世界观 / 角色 等）。
2. 借鉴其 **YAML 外置提示词**的设计（persona / 变量 slot / settings 与代码解耦）。
3. **改写/中文化**为本项目所需的提示词，并补充 LibriScribe 所不具备的能力所需的提示词（如：
   事实库溯源比对、双向一致性检查、局部 Diff 重构约束、按需召唤的 scope 感知等）。

## 与本项目的关键差异（为什么不能直接照搬）

LibriScribe 是 **CLI 黑盒自动化流水线**，本项目是 **human-in-the-loop 的“小说 IDE”**。因此本项目的提示词需额外满足：

- 输出**结构化、可锚定**的结果（bug 带类型/严重度/出处/定位），而非自由文本反馈。
- 重构 Agent 只接收**待修片段**，返回**局部改写**，绝不重写全章（保护原创好文笔）。
- 审稿/核查 Agent 必须**对撞事实库**（角色称呼表、时间线、能力设定）来发现跨章矛盾。

## 模板清单（13 个）

| 文件 | 角色 | 本项目对应能力 |
|------|------|---------------|
| `concept_generator.yml` | 概念生成 | 策划 |
| `outliner.yml` | 大纲 | 策划 |
| `scene_outliner.yml` | 分场大纲 | 策划 |
| `character_generator.yml` | 角色卡生成 | 事实库·设定 |
| `worldbuilding.yml` | 世界观 | 事实库·设定 |
| `researcher.yml` | 资料研究 | 设定 |
| `chapter_writer.yml` | 章节写手 | 写作 |
| `scene_generator.yml` | 场景生成 | 写作 |
| `content_reviewer.yml` | 内容审稿 | 审稿 |
| `fact_checker.yml` | 事实/一致性核查 | 纠 bug（连续性） |
| `plagiarism_checker.yml` | 查重/原创性 | 审稿 |
| `editor.yml` | 章节编辑 | 重构 |
| `style_editor.yml` | 文风编辑 | 重构 |
