# 获取分组累计数据

- Source: https://xiaomark.com/help/api/shortlink-api-group-stats
- Fetched: 2026-02-24 17:14:30 +0800

## 接口功能

获取某个短链分组的累计访问次数、人数、ip数、被访问短链数。

## 接口地址

```
https://api.xiaomark.com/v2/sl/group/overall_stats/get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| group\_id | string | 是 | 分组id |
| exclude\_bot | boolean | 否 | 是否排除机器访问，默认不排除 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "group_id": "81myhfrn",
    "exclude_bot": true
}
```

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |
| data | object | 请求成功返回的数据 |
| visit\_count | integer | 累计访问次数 |
| visitor\_count | integer | 累计访问人数 |
| ip\_count | integer | 累计访问IP数 |
| visited\_link\_count | integer | 累计被访问短链数 |
| created\_link\_count | integer | 累计创建短链数 |

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
        "created_link_count": 32
    }
}
```
