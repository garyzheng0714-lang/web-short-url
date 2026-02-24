# 获取项目下短链分组

- Source: https://xiaomark.com/help/api/shortlink-api-groups
- Fetched: 2026-02-24 17:14:23 +0800

## 接口功能

获取某个项目下的全部[短链接](https://xiaomark.com/shortlink)分组。

## 接口地址

```
https://api.xiaomark.com/v2/sl/group/batch_get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| project\_id | string | 是 | 项目id |
| offset | integer | 否 | 起始位置，默认为0 |
| count | integer | 否 | 请求数量，不超过100，默认为10 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "project_id": "658d4d8a38c8a5a89e3b21d4",
    "offset": 0,
    "count": 20
}
```

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |
| data | object | 请求成功返回的数据 |
| groups | array<object> | 短链分组列表 |
| id | string | 分组id |
| create\_time | integer | 分组创建时间（以秒为单位的时间戳） |
| name | string | 分组名称 |
| total\_links | integer | 分组下的短链数量 |
| count | integer | 此次请求返回的分组数量 |
| total | integer | 分组总数 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "groups": [
            {
                "id": "81myhfrn",
                "create_time": 1712062822,
                "name": "内部测试",
                "total_links": 32
            },
            {
                "id": "g17khkz8",
                "create_time": 1712066054,
                "name": "私域运营",
                "total_links": 1000
            },
            {
                "id": "0og83pz9",
                "create_time": 1732797489,
                "name": "平台投放",
                "total_links": 256
            }
        ],
        "count": 3,
        "total": 3
    }
}
```
