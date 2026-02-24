# API - 获取分组下的短链列表

- Source: https://xiaomark.com/help/api/shortlink-api-linklist
- Fetched: 2026-02-24 17:14:33 +0800

## 接口地址

```
https://api.xiaomark.com/v1/link/get
```

## 请求方法

POST

## **请求参数说明**

| **参数名** | **类型** | **是否必传** | **描述** |
| --- | --- | --- | --- |
| apikey | string | 是 | 用户的API密钥 |
| group\_sid | string | 是 | 链接分组的sid |
| offset | integer | 否 | 起始位置，默认为0 |
| limit | integer | 否 | 请求数量，不超过1000，默认为100 |

## **请求POST数据示例**

```
{
    "apikey": "361f534e9897e75af4206ea820365fde",
    "url": "https://sourl.cn/HOHzsG",
    "group_sid": "w7ho5te8",
    "limit": 100
}
```

![示例图](https://static.interval.im/interval/NHXZ7BDnamMQnsQj.jpeg)

## **返回参数说明**

| **名称** | **类型** | **描述** |
| --- | --- | --- |
| code | integer | 返回码 |
| message | string | 返回信息 |
| data | object | 请求成功返回的数据 |
| links | object数组 | [短链接](https://xiaomark.com/shortlink)列表 |
| total | integer | 总数 |
| count | integer | 此次请求返回的数量 |

### **短链接信息 links**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| name | string | 名称 |
| url | string | 短链接URL |
| origin\_url | string | 跳转链接URL，多个URL以换行符分隔 |
| enabled | bool | 是否可以访问（被封禁的链接不可访问） |
| webhook | bool | 是否开启了Webhook推送 |
| webhook\_scene | string | Webhook推送场景值 |

## **返回结果示例**

```
{
    "code": 0,
    "data": {
        "total": 4,
        "count": 4,
        "links": [
            {
                "enabled": true,
                "name": "INTERVAL · GitHub",
                "origin_url": "https://github.com/interval-design",
                "url": "https://6url.cn/dHHEkW",
                "webhook": false,
                "webhook_scene": ""
            },
            {
                "enabled": true,
                "name": "短链接2dS3hK",
                "origin_url": "https://xiaomark.com/rule",
                "url": "https://sourl.cn/2dS3hK",
                "webhook": true,
                "webhook_scene": "rule"
            },
            {
                "enabled": true,
                "name": "短链接cb6eq6",
                "origin_url": "https://v.douyin.com/J8NjAx/",
                "url": "https://sourl.cn/cb6eq6",
                "webhook": false,
                "webhook_scene": ""
            },
            {
                "enabled": true,
                "name": "百度",
                "origin_url": "https://baidu.com",
                "url": "https://sourl.co/u7gZxM",
                "webhook": false,
                "webhook_scene": ""
            }
        ]
    },
    "message": "请求成功"
}
```
