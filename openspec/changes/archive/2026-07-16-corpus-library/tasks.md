## 1. 素材条目模型

- [x] 1.1 定义条目模型（type/content/tags/source，type 可扩展）
- [x] 1.2 定义弱参考语义约束（不进一致性检查、不产 bug）
- [x] 1.3 定义导入意图分流（正文 / 参考素材 / 两者）
- [x] 1.4 定义作用域与挂载（全局库 + 项目挂载 + 检索作用域限定）
- [x] 1.5 声明个人本地参考用途的合规边界

## 2. 自动提炼

- [x] 2.1 定义提炼输入/输出契约与 schema 校验点
- [x] 2.2 定义候选条目的人工修改/确认/打标签/删除
- [x] 2.3 明确 embedding 计算归属 utilityProcess

## 3. 语义检索

- [x] 3.1 定义语义检索契约（查询 → 排序结果）
- [x] 3.2 定义标签/来源/类型过滤及与语义检索的组合
- [x] 3.3 明确检索计算的进程归属（embedding→utilityProcess，向量库 I/O→Main）
- [x] 3.4 向量库选型待实现阶段确定（Chroma/LanceDB 等），本 change 不锁定

## 4. 校验

- [x] 4.1 `openspec validate corpus-library --strict` 通过
- [x] 4.2 确认与 story-workspace 导入入口、story-bible 正交关系一致
