# 获取可用自有域名

- Source: https://xiaomark.com/help/api/shortlink-api-private-domains
- Fetched: 2026-02-24 17:14:21 +0800

## 接口功能

列出可用的[自有域名](https://xiaomark.com/shortlink/advance/custom-domain)。

绑定自有域名后，调用接口创建短链无需设置域名白名单，还可以获取更加稳定的跳转体验，参考[自有域名帮助文档](https://xiaomark.com/help/shortlink/custom-domain)。

## 接口地址

```
https://api.xiaomark.com/v2/sl/private_domain/get_all
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90"
}
```

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |
| data | object | 请求成功返回的数据 |
| private\_domains | array<object> | 自有域名列表 |
| domain | string | 域名 |
| ssl\_enabled | boolean | 是否启用了HTTPS |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "private_domains": [
            {
                "domain": "s.xma.im",
                "ssl_enabled": true
            },
            {
                "domain": "xma.im",
                "ssl_enabled": false
            }
        ]
    }
}
```
