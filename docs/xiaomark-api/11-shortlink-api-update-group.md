# 编辑短链分组

- Source: https://xiaomark.com/help/api/shortlink-api-update-group
- Fetched: 2026-02-24 17:14:24 +0800

## 接口功能

编辑修改[短链接](https://xiaomark.com/shortlink)分组信息（分组名称）。

## 接口地址

```
https://api.xiaomark.com/v2/sl/group/update
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| group\_id | string | 是 | 分组id |
| name | string | 是 | 分组名称，长度不超过64个字符 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "group_id": "5mn5djnx",
    "name": "营销短信-2024"
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
