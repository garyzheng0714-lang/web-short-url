# 获取短链每日数据

- Source: https://xiaomark.com/help/api/shortlink-api-link-daily-stats
- Fetched: 2026-02-24 17:14:29 +0800

## 接口功能

获取某个[短链接](https://xiaomark.com/shortlink)的按天的统计数据，传入起止日期，返回起止日期内每天的访问次数、人数、ip数，以及起止日期内的累计访问次数。

## 接口地址

```
https://api.xiaomark.com/v2/sl/link/daily_stats/get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| link\_url | string | 是 | 短链地址 |
| start\_date | string | 是 | 统计起始日期，不可早于365天前，按“yyyy-mm-dd”的格式传入 |
| end\_date | string | 是 | 统计截止日期，按“yyyy-mm-dd”的格式传入；起止日期跨度不可超过31天 |
| exclude\_bot | boolean | 否 | 是否排除机器访问，默认不排除 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "link_url": "https://s.xma.im/6MsW",
    "start_date": "2024-11-01",
    "end_date": "2024-11-07",
    "exclude_bot": true
}
```

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |
| data | object | 请求成功返回的数据 |
| visit\_count | integer | 所选时段内的累计访问次数 |
| visitor\_count | integer | 所选时段内的累计访问人数 |
| ip\_count | integer | 所选时段内的累计访问IP数 |
| daily\_stats | array<object> | 每日数据列表 |
| date | string | 日期 |
| visit\_count | integer | 当日访问次数 |
| visitor\_count | integer | 当日访问人数 |
| ip\_count | integer | 当日访问IP数 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "visit_count": 128,
        "visitor_count": 105,
        "ip_count": 98,
        "daily_stats": [
            {
                "date": "2024-11-01",
                "visit_count": 0,
                "visitor_count": 0,
                "ip_count": 0
            },
            {
                "date": "2024-11-02",
                "visit_count": 5,
                "visitor_count": 3,
                "ip_count": 3
            },
            {
                "date": "2024-11-03",
                "visit_count": 42,
                "visitor_count": 37,
                "ip_count": 35
            },
            {
                "date": "2024-11-04",
                "visit_count": 50,
                "visitor_count": 44,
                "ip_count": 42
            },
            {
                "date": "2024-11-05",
                "visit_count": 25,
                "visitor_count": 18,
                "ip_count": 15
            },
            {
                "date": "2024-11-06",
                "visit_count": 4,
                "visitor_count": 2,
                "ip_count": 2
            },
            {
                "date": "2024-11-07",
                "visit_count": 2,
                "visitor_count": 1,
                "ip_count": 1
            }
        ]
    }
}
```
