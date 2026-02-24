# 批量恢复短链跳转

- Source: https://xiaomark.com/help/api/shortlink-api-resume-links
- Fetched: 2026-02-24 17:14:28 +0800

## 接口功能

传入[短链接](https://xiaomark.com/shortlink)列表，调用此接口后恢复这些短链接的跳转。

## 接口地址

```
https://api.xiaomark.com/v2/sl/link/batch_resume
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| link\_url\_list | array<string> | 是 | 短链地址列表，数量不超过100 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "link_url_list": [
        "https://s.xma.im/6MsW",
        "https://s.xma.im/KmPq",
        "https://sourl.cn/6GtdVb"
    ]
}
```

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |
| data | object | 请求成功返回的数据 |
| count | integer | 恢复跳转的短链数量 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "count": 3
    }
}
```
