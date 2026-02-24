# 获取分组每日数据

- Source: https://xiaomark.com/help/api/shortlink-api-group-daily-stats
- Fetched: 2026-02-24 17:14:30 +0800

## 接口功能

获取某个短链分组的每日数据，分组下所有[短链接](https://xiaomark.com/shortlink)的每日访问次数、人数、ip数、被访问短链数等数据。

## 接口地址

```
https://api.xiaomark.com/v2/sl/group/daily_stats/get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| group\_id | string | 是 | 分组id |
| start\_date | string | 是 | 统计起始日期，不可早于365天前，按“yyyy-mm-dd”的格式传入 |
| end\_date | string | 是 | 统计截止日期，按“yyyy-mm-dd”的格式传入；起止日期跨度不可超过31天 |
| exclude\_bot | boolean | 否 | 是否排除机器访问，默认不排除 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "group_id": "81myhfrn",
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
| visited\_link\_count | integer | 所选时段内的累计被访问短链数 |
| created\_link\_count | integer | 所选时段内的累计创建短链数 |
| daily\_stats | array<object> | 每日数据列表 |
| date | string | 日期 |
| visit\_count | integer | 当日访问次数 |
| visitor\_count | integer | 当日访问人数 |
| ip\_count | integer | 当日访问IP数 |
| visited\_link\_count | integer | 当日被访问短链数 |
| created\_link\_count | integer | 当日创建短链数 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "visit_count": 528,
        "visitor_count": 505,
        "ip_count": 498,
        "visited_link_count": 5,
        "created_link_count": 32,
        "daily_stats": [
            {
                "date": "2024-11-01",
                "visit_count": 0,
                "visitor_count": 0,
                "ip_count": 0,
        		"visited_link_count": 0,
        		"created_link_count": 0
            },
            {
                "date": "2024-11-02",
                "visit_count": 45,
                "visitor_count": 43,
                "ip_count": 43,
        		"visited_link_count": 3,
        		"created_link_count": 8
            },
            {
                "date": "2024-11-03",
                "visit_count": 142,
                "visitor_count": 137,
                "ip_count": 135,
        		"visited_link_count": 5,
        		"created_link_count": 12
            },
            {
                "date": "2024-11-04",
                "visit_count": 250,
                "visitor_count": 244,
                "ip_count": 242,
        		"visited_link_count": 5,
        		"created_link_count": 7
            },
            {
                "date": "2024-11-05",
                "visit_count": 65,
                "visitor_count": 58,
                "ip_count": 55,
        		"visited_link_count": 4,
        		"created_link_count": 3
            },
            {
                "date": "2024-11-06",
                "visit_count": 24,
                "visitor_count": 22,
                "ip_count": 22,
        		"visited_link_count": 2,
        		"created_link_count": 1
            },
            {
                "date": "2024-11-07",
                "visit_count": 2,
                "visitor_count": 1,
                "ip_count": 1,
        		"visited_link_count": 1,
        		"created_link_count": 1
            }
        ]
    }
}
```
