# 获取短链详情

- Source: https://xiaomark.com/help/api/shortlink-api-link
- Fetched: 2026-02-24 17:14:26 +0800

## 接口功能

获取某个短链的详细信息。

## 接口地址

```
https://api.xiaomark.com/v2/sl/link/get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| link\_url | string | 是 | 短链地址 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "link_url": "https://sourl.cn/6GtdVb"
}
```

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |
| data | object | 请求成功返回的数据 |
| link | object | 短链详情 |
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

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "link": {
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
        }
    }
}
```
