# persistence-sqlite

实现阶段第 2 波（I2）：把 I1 的真数据行走骨架推进到“可持久化的本地项目”。

本 change 采用双持久化后端：

- 工作区文件层：`workspace.json` + `manuscript.json` + Markdown 正文文件，保持人类可读、Git 友好。
- SQLite 层：使用 Node 24 内置 `node:sqlite`，承载 checkpoints、事实库与事实版本表；本波只建 schema + 读写 API，不接 LangGraph/事实抽取。
