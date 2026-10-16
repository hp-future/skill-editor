---
name: api-call-by-knowledge
description: "根据用户的自然语言业务请求读取 api-wiki 接口定义，并生成结构化 `task_config.json`。当用户要求查询、调用、执行、排查或验证估值、债券、组合、执行日志、清算、统计、数据导入等 api-wiki 支撑的业务接口时使用。本 Skill 是业务决策层：负责识别接口、参数、调用顺序、依赖关系和输出要求；实际调用接口应把生成的配置交给原子执行 Skill `api-task-executor` 执行。"
---

# API 知识库调用规划

## 定位

把用户的自然语言业务请求转换成可执行的 API 任务配置。

本 Skill 只负责业务决策和配置生成：

```text
用户请求 -> 意图和参数提取 -> 查询 api-wiki -> 选择接口
-> 规划调用顺序和依赖 -> 生成 task_config.json
-> 如需实际调用，交给 api-task-executor 执行
```

本 Skill 不直接执行 HTTP 请求。接口调用执行由 `api-task-executor` 负责。

## 核心约束

- `api-wiki` 是接口定义的唯一来源。
- 生成配置前必须先检索并读取匹配的 api-wiki 文档。
- 不得猜测接口路径、请求方法、请求头、请求字段、枚举值、响应字段、轮询规则或成功判断规则。
- 不得临时编写一次性 Python 接口调用脚本。
- 所有可变执行信息都必须进入 `task_config.json`，包括 `base_url`、请求头、认证、接口列表、请求体、查询参数、响应引用和输出提示。
- 只有必填参数无法从用户请求或 api-wiki 默认值中确定时，才向用户询问。
- 日期类必填参数缺失时，先以 api-wiki 为准：如果接口定义说明“未指定默认当天”或等价语义，使用当前会话日期填入配置；只有 api-wiki 未提供默认值且该日期为必填时，才向用户确认。
- 如果用户只要求生成配置，写出配置后停止；可在执行器脚本可用时做结构校验。
- 如果用户要求查询、调用、执行、帮忙查、验证或排查，先生成配置，再使用 `api-task-executor` 执行。

## 知识来源

优先读取本 Skill 的本地参考资料：

- `references/task-mapping.md`：常见用户意图到检索关键词和目标接口的映射。
- `references/api-index.md`：api-wiki 使用规则和已知接口索引。
- `references/field-dictionary.md`：结果展示和字段翻译规则。

使用以下命令读取 api-wiki 中的权威接口定义：

```powershell
youdaonote -s ydn search "<关键词>"
youdaonote -s ydn read <fileId>
```

读取接口定义时必须记录：

- 接口名称、请求方式和相对路径。
- BASE_URL 规则。
- 通用请求头和特殊请求头。
- 认证方式。
- 请求体或查询参数结构。
- 必填参数、可选参数、默认值、固定值和格式要求。
- 响应结构、成功判断和失败判断。
- 是否需要轮询、轮询间隔、最大次数和终止状态。
- 多接口链路的调用顺序，以及后续接口依赖的前序响应字段。

## 规划流程

1. 解析用户请求：
   - 业务动作：查询、执行、排查、导入、清算、核算、查看日志等。
   - 业务对象：组合、估值、债券、证券、执行日志、清算方案、统计方案等。
   - 已给参数：组合代码、业务日期、日期区间、证券代码、日志 ID、方案代码、调度 ID 等。

2. 选择检索关键词：
   - 用户表述不明确时，优先参考 `references/task-mapping.md`。
   - 使用 1-3 个精准关键词检索 api-wiki。
   - 必须读取完整接口文档，不能只根据搜索结果标题生成配置。

3. 确定调用方案：
   - 选择满足需求的最小接口集合。
   - 多接口任务必须明确调用顺序和依赖关系。
   - 只有当前序响应字段来自文档说明或实际前序响应时，才使用 `{{responses.<request_id>.json.<path>}}` 引用。
   - 不为“看起来更完整”而增加与用户目标无关的辅助接口。

4. 生成 `task_config.json`：
   - 使用 `api-task-executor` 的配置契约。
   - `requests[].id` 必须稳定、唯一。
   - GET 查询参数放入 `params`。
   - POST、PUT、PATCH 请求体放入 `body`。
   - 日期字段若由 api-wiki 默认“当天”推导，必须写入当前会话日期的具体值，格式按接口定义生成，例如 `YYYY-MM-DD`。
   - 目标接口需要认证时才配置 `auth`。

5. 校验或执行：
   - 只生成配置时，可调用执行器的校验脚本验证结构。
   - 需要实际调用时，使用 `api-task-executor` 校验、执行，并用 `--quiet` 避免大响应刷屏。

## 默认认证模式

当 api-wiki 说明需要 FOMP 登录取 token，且接口定义没有额外要求时，生成如下认证配置：

```json
{
  "auth": {
    "enabled": true,
    "header_name": "authentication",
    "prefix": "",
    "login": {
      "endpoint": "/api/fomp-sso-server/login",
      "method": "POST",
      "body_type": "json",
      "body": {
        "username": {"$env_or": ["FOMP_USERNAME", "yssautotest"]},
        "password": {"$env_or": ["FOMP_PASSWORD", "CBDDDB8E8421B23498480570D7D75330538A6882F5DFDC3B64115C647F3328C4"]},
        "appId": "server1"
      },
      "token_path": "data.accessToken"
    }
  }
}
```

登录接口默认使用密文密码`CBDDDB8E8421B23498480570D7D75330538A6882F5DFDC3B64115C647F3328C4`，不使用知识库中的示例值；最终回答中不得展示该值。

## 配置骨架

```json
{
  "base_url": "http://10.10.91.110:25331",
  "timeout": 30,
  "headers": {
    "invokeFlag": "backend",
    "userCode": "yssautotest"
  },
  "auth": {},
  "requests": [
    {
      "id": "stable_request_id",
      "name": "接口名称",
      "endpoint": "/api/example/path",
      "method": "POST",
      "body_type": "json",
      "body": {}
    }
  ]
}
```

## 最终输出要求

执行完成后输出：

- 接口名称和相对路径。
- 脱敏后的请求参数。
- HTTP 状态和业务状态。
- 数据预览、匹配结论或关键失败原因。
- `task_config.json` 和完整响应 JSON 文件路径。

**不得输出有效 token、密码、密码密文或完整认证请求头。**

## 失败处理

- 未匹配到接口：输出“未匹配到可执行接口，执行终止”。
- 必填参数缺失：列出缺失字段，等待用户补充。
- api-wiki 定义冲突：优先采用更具体或更新的文档，并说明冲突点。
- 配置校验失败：输出执行器校验错误，不执行接口。
- 执行失败：输出失败的请求 id、接口名称、路径和执行器错误摘要。
