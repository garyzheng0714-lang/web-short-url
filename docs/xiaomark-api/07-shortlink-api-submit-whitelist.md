# 提交白名单域名

- Source: https://xiaomark.com/help/api/shortlink-api-submit-whitelist
- Fetched: 2026-02-24 17:14:22 +0800

## 接口地址

此接口可以设置域名白名单。

建议绑定[自有域名](https://xiaomark.com/shortlink/advance/custom-domain)生成短链，不受白名单限制，具体参考[自有域名帮助文档](https://xiaomark.com/help/shortlink/custom-domain)。

## 接口地址

```
https://api.xiaomark.com/v2/sl/whitelist/submit
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| domains | array<string> | 是 | 白名单域名列表 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "domains": ["xiaomark.com", "docsmall.com", "interval.im"]
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
