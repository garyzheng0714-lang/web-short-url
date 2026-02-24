# 编辑单条短链

- Source: https://xiaomark.com/help/api/shortlink-api-update-link
- Fetched: 2026-02-24 17:14:25 +0800

## 接口功能

编辑修改某条[短链接](https://xiaomark.com/shortlink)的跳转网址、名称等信息。

## 接口地址

```
https://api.xiaomark.com/v2/sl/link/update
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| link\_url | string | 是 | 短链地址 |
| target\_url | string | 否 | 跳转的目标链接，必须是以 http:// 或 https:// 开头的链接或者应用跳转链接 |
| name | string | 否 | 短链名称，长度不超过128个字符 |
| escape\_from\_wechat | boolean | 否 | 是否开启微信内强制浏览器打开（不能与“深度过滤机器访问”同时开启） |
| advanced\_bot\_detection | boolean | 否 | 是否开启深度过滤机器访问 |
| webhook | boolean | 否 | 是否开启事件推送 |
| webhook\_scene | string | 否 | 事件推送场景值，会包含在每次推送的数据中，可填写任意参数值，长度不超过128个字符 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "link_url": "https://s.xma.im/6MsW",
    "target_url": "https://portal.xiaomark.com/rule.html",
    "name": "使用规范",
    "advanced_bot_detection": false,
    "webhook": false
}
```

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {}
}
```
