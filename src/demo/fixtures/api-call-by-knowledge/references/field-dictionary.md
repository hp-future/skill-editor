# 字段展示规则

优先展示接口返回中的中文名称字段：

- 如果同时存在代码字段和名称字段，展示为 `名称 (代码)`，例如 `存续期 (PS4)`。
- 如果只有代码字段，展示原始代码，不臆造中文含义。
- 空字符串、`null`、单个空格按空值展示。

常见字段建议：

| 字段 | 展示名 |
|---|---|
| `id` | 主键 ID |
| `portCode` | 组合代码 |
| `portName` | 组合名称 |
| `assetType` / `assetTypeName` | 资产类型 |
| `portCurrency` / `portCurrencyName` | 币种 |
| `buildDate` | 成立日期 |
| `closedDate` | 关闭日期 |
| `portLevel` / `portLevelName` | 组合层级 |
| `holidayCode` / `holidayCodeName` | 节假日群 |
| `productStatus` / `productStatusName` | 产品状态 |
| `audit` / `auditName` | 审核状态 |
| `modifyTime` | 修改时间 |
| `currentPage` | 当前页 |
| `pageSize` | 每页数量 |
| `totalCount` | 总条数 |

结果输出规则：

- 分页响应优先读取 `response.json.data.content` 和 `response.json.data.totalCount`。
- 数组响应优先展示前 10 条。
- 对象响应展示核心字段；字段过多时输出结果文件路径。
- 多接口结果必须逐个接口展示，不只展示最后一个接口。
