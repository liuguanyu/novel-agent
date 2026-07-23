## ADDED Requirements

### Requirement: YAML 外置提示词
提示词 MUST 以外置 YAML 定义（name/description/template 含变量 slot/variables.required/settings
含能力档位），与代码解耦。

#### Scenario: 提示词与代码解耦
- **WHEN** 需要修改某 agent 的 persona、语气或风格
- **THEN** 该修改 MUST 仅通过编辑 YAML 完成，不需修改源码

#### Scenario: 档位在提示词中声明
- **WHEN** 定义某提示词模板
- **THEN** 其 settings MUST 可声明所需能力档位（prose/reasoning/cheap-fast）
- **AND** 该档位 MUST 经 model-adapter 解析到具体模型

### Requirement: 加载、变量填充与回退
提示词加载器 MUST 运行时加载模板、校验必填变量齐备、填充 slot；模板缺失或变量缺失时 MUST 明确回退
或报错，不得静默产出错误 prompt。

#### Scenario: 必填变量校验
- **WHEN** 填充某模板时缺少 variables.required 中的变量
- **THEN** 加载器 MUST 报错或按既定回退处理
- **AND** MUST NOT 用空值静默填充产出错误 prompt

#### Scenario: 模板缺失回退
- **WHEN** 指定的 YAML 模板文件缺失
- **THEN** 加载器 MUST 回退到内置默认或明确报错
- **AND** MUST NOT 静默失败
