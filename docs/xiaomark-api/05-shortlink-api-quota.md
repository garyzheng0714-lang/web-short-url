# 获取资源包可用额度

- Source: https://xiaomark.com/help/api/shortlink-api-quota
- Fetched: 2026-02-24 17:14:21 +0800

## 接口功能

获取短链 API 资源包剩余额度。

## 接口地址

```
https://api.xiaomark.com/v2/sl/quota/get
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
| link\_quota | integer | 剩余短链额度 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "link_quota": 9000
    }
}
```
