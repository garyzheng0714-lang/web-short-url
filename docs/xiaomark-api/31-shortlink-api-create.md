# API - 创建短链接

- Source: https://xiaomark.com/help/api/shortlink-api-create
- Fetched: 2026-02-24 17:14:32 +0800

## 接口地址

```
https://api.xiaomark.com/v1/link/create
```

## 请求方法

POST

## **请求参数**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 用户的API密钥 |
| origin\_url | string | 是 | 跳转链接，必须是以 http:// 或者 https:// 开头的链接或应用跳转链接 |
| group\_sid | string | 是 | 链接分组的sid，可在网页端 API 短链分组列表中查找 |
| domain | string | 否 | 自定义域名，不填则默认使用sourl.cn；使用自定义域名可以生成任意域名下的短链接 |
| webhook | bool | 否 | 是否开启Webhook推送，默认不开启；（注：只有账号的API套餐里包含了Webhook推送的功能，且在 API 设置里开启了推送，该字段才生效） |
| webhook\_scene | string | 否 | Webhook推送场景值，会包含在每次推送给用户的数据中，可以填写任意参数值，长度不超过128个字符 |

## **请求POST数据示例**

```
{
    "apikey": "361f534e9897e75af4206ea820365fde",
    "domain": "interval.im",
    "origin_url": "https://xiaomark.com/",
    "group_sid": "w7ho5te8",
    "webhook": true,
    "webhook_scene": "test"
}
```

![示例图](https://static.interval.im/interval/zbHESdbQa5m6YiAQ.png)

## **返回参数说明**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码 |
| message | string | 错误信息 |
| data | object | 请求成功返回的数据 |
| data.group | object数组 | 链接分组，详见 分组信息 |
| data.link | object | 短链接，详见 短链接信息 |
| data.n\_links\_today | integer | 今天通过接口已创建的短链接数量 |

### **分组信息 group**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| sid | string | sid |
| name | string | 分组名称 |

### **短链接信息 link**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| name | string | 链接名称 |
| origin\_url | string | 跳转链接URL |
| url | string | 短链接URL |

## **返回结果示例**

```
{
    "code": 0,
    "data": {
        "group": {
            "sid": "w7ho5te8",
            "name": "分组1"
        },
        "link": {
            "name": "短链接HOHzsG",
            "origin_url": "https://xiaomark.com/",
            "url": "https://sourl.cn/HOHzsG"
        },
        "n_links_today": 13
    },
    "message": "请求成功",
}
```
