# 创建单条短链

- Source: https://xiaomark.com/help/api/shortlink-api-create-link
- Fetched: 2026-02-24 17:14:25 +0800

## 接口功能

创建单条[短链接](https://xiaomark.com/shortlink)。

## 接口地址

```
https://api.xiaomark.com/v2/sl/link/create
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| group\_id | string | 是 | 分组id |
| target\_url | string | 是 | 跳转的目标链接，必须是以 http:// 或 https:// 开头的链接或者应用跳转链接 |
| name | string | 否 | 短链名称，长度不超过128个字符 |
| domain | string | 否 | [自有域名](https://xiaomark.com/shortlink/advance/custom-domain)，不填则默认使用 sourl.cn；使用自有域名可以生成任意域名下的短链，无需设置白名单 |
| key | string | 否 | 使用自有域名生成短链可以自定义后缀，可使用英文字母、数字、连字符和下划线，长度不超过32个字符 |
| key\_length | integer | 否 | 使用自有域名生成短链可以自定义随机后缀的长度，最小为4，最大为8，默认为6 |
| escape\_from\_wechat | boolean | 否 | 是否开启微信内强制浏览器打开，默认不开启（不能与“深度过滤机器访问”同时开启） |
| advanced\_bot\_detection | boolean | 否 | 是否开启深度过滤机器访问，默认不开启 |
| webhook | boolean | 否 | 是否开启事件推送，默认不开启 |
| webhook\_scene | string | 否 | 事件推送场景值，会包含在每次推送的数据中，可填写任意参数值，长度不超过128个字符 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "group_id": "81myhfrn",
    "target_url": "https://xiaomark.com/shortlink",
    "name": "小码短链",
    "domain": "s.xma.im",
    "key_length": 4,
    "advanced_bot_detection": true,
    "webhook": true,
    "webhook_scene": "test"
}
```

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |
| data | object | 请求成功返回的数据 |
| link\_url | string | 短链地址 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "link_url": "https://s.xma.im/6MsW"
    }
}
```
