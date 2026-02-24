# 获取当前白名单配置

- Source: https://xiaomark.com/help/api/shortlink-api-whitelist
- Fetched: 2026-02-24 17:14:22 +0800

## 接口功能

使用小码短链默认域名通过 API 生成短链需要设置域名白名单，此接口可以获取已配置的白名单信息。

建议绑定[自有域名](https://xiaomark.com/shortlink/advance/custom-domain)生成短链，不受白名单限制，具体参考[自有域名帮助文档](https://xiaomark.com/help/shortlink/custom-domain)。

## 接口地址

```
https://api.xiaomark.com/v2/sl/whitelist/get
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
| domains | array<string> | 白名单域名列表 |
| max\_whitelist\_size | integer | 白名单域名数量上限 |
| available\_submissions | integer | 本月剩余白名单域名提交次数 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "domains": [
            "xiaomark.com",
            "docsmall.com",
            "interval.im"
        ],
        "max_whitelist_size": 5,
        "available_submissions": 3
    }
}
```
