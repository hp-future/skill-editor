# API 索引与知识库规则

`api-wiki` 是接口定义唯一来源。检索命令：

```powershell
youdaonote -s ydn search "<关键词>"
youdaonote -s ydn read <fileId>
```

常见文档：

- `digital-employee-valuation-http-api.md`：HTTP API 总览。
- `httpapi-raw.md`：完整原始接口文档。
- `fomp-sso-login-api.md`：登录接口。
- `execution-status-check-api.md`：执行状态检查。
- `execution-log-query-api.md`：执行日志。
- `valuation-log-detail-api.md`：估值日志详情。

读取接口定义时必须记录：

- 接口名称、相对路径、方法、BASE_URL 规则。
- 通用请求头、特殊请求头、认证方式。
- 请求结构、必填参数、可选参数、默认值、固定值、参数格式。
- 响应结构、成功/失败判断规则。
- 是否需要轮询、轮询间隔、最大次数、终止状态。
- 多接口链路中的执行顺序和响应字段依赖。

默认调用约定：

- 分页查询通常使用 `{ "params": {...}, "currentPage": 1, "pageSize": 20, "totalCount": 0 }`。
- 通用成功响应通常包含 `code=success` 且 `success=true`。
- 登录成功后通常从 `data.accessToken` 取 token，注入后续请求头 `authentication`。

禁止事项：

- 不得根据历史记忆新增接口路径。
- 不得把检索结果标题当作完整接口定义。
- 不得为了让请求“看起来能运行”而填未知参数。
- 不得在最终回答中输出有效 token、密码、密码密文或完整认证请求头。
