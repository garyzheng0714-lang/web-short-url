# 获取分组下短链

- Source: https://xiaomark.com/help/api/shortlink-api-links
- Fetched: 2026-02-24 17:14:28 +0800

## 接口功能

可以获取某个分组下的短链列表，包含名称、短链、原始链接以及其他信息。

## 接口地址

```
https://api.xiaomark.com/v2/sl/link/batch_get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| group\_id | string | 是 | 分组id |
| offset | integer | 否 | 起始位置，默认为0 |
| count | integer | 否 | 请求数量，不超过100，默认为10 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "group_id": "81myhfrn",
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
| links | array<object> | 短链列表 |
| url | string | 短链地址 |
| domain | string | 短链域名 |
| create\_time | integer | 短链创建时间（以秒为单位的时间戳） |
| project\_id | string | 短链所在项目id |
| group\_id | string | 短链所在分组id |
| name | string | 短链名称 |
| target\_url | string | 短链跳转到的目标链接 |
| escape\_from\_wechat | boolean | 是否开启了微信内强制浏览器打开 |
| advanced\_bot\_detection | boolean | 是否开启了深度过滤机器访问 |
| webhook | boolean | 是否开启了事件推送 |
| webhook\_scene | string | 事件推送场景值 |
| suspended | boolean | 是否已停止跳转 |
| banned | boolean | 是否已被封禁 |
| count | integer | 此次请求返回的短链数量 |
| total | integer | 短链总数 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "links": [
            {
                "url": "https://sourl.cn/6GtdVb",
                "domain": "sourl.cn",
                "create_time": 1732768208,
                "project_id": "658d4d8a38c8a5a89e3b21d4",
                "group_id": "81myhfrn",
                "name": "短链6GtdVb",
                "target_url": "https://xiaomark.com/shortlink",
                "escape_from_wechat": false,
                "advanced_bot_detection": true,
                "webhook": false,
                "webhook_scene": "",
                "suspended": true,
                "banned": false
            },
            {
                "url": "https://sourl.cn/biMfBE",
                "domain": "sourl.cn",
                "create_time": 1732780302,
                "project_id": "658d4d8a38c8a5a89e3b21d4",
                "group_id": "81myhfrn",
                "name": "图片压缩",
                "target_url": "https://docsmall.com/image-compress",
                "escape_from_wechat": true,
                "advanced_bot_detection": false,
                "webhook": true,
                "webhook_scene": "image-compress",
                "suspended": false,
                "banned": false
            },
            {
                "url": "https://s.xma.im/cVh7rh",
                "domain": "s.xma.im",
                "create_time": 1732798635,
                "project_id": "658d4d8a38c8a5a89e3b21d4",
                "group_id": "81myhfrn",
                "name": "产品套餐定价方案",
                "target_url": "https://xiaomark.com/plan/shortlink",
                "escape_from_wechat": false,
                "advanced_bot_detection": true,
                "webhook": true,
                "webhook_scene": "plan",
                "suspended": false,
                "banned": false
            }
        ],
        "count": 3,
        "total": 3
    }
}
```
