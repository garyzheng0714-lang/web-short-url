# API - 编辑短链接

- Source: https://xiaomark.com/help/api/shortlink-api-edit
- Fetched: 2026-02-24 17:14:32 +0800

## 接口地址

```
https://api.xiaomark.com/v1/link/update
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 用户的API密钥 |
| url | string | 是 | 短链接 |
| origin\_url | string | 是 | 跳转链接，必须是以 http:// 或者 https:// 开头的链接或应用跳转链接 |

## **请求POST数据示例**

```
{
    "apikey": "361f534e9897e75af4206ea820365fde",
    "url": "https://sourl.cn/HOHzsG",
    "origin_url": "https://xiaomark.com"
}
```

![示例图](https://static.interval.im/interval/e7kheCeCtPstA35D.png)

## **返回参数说明**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码 |
| message | string | 返回信息 |
| data | object | 请求成功返回的数据 |
| link | object | 短链接，详见 短链接信息 |

### **短链接信息 link**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| origin\_url | string | 跳转链接URL |
| url | string | 短链接URL |

## **返回结果示例**

```
{
    "code": 0,
    "data": {
        "link": {
            "origin_url": "https://xiaomark.com",
            "url": "https://sourl.cn/HOHzsG"
        }
    },
    "message": "请求成功"
}
```
