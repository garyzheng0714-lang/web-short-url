# 获取短链访问记录

- Source: https://xiaomark.com/help/api/shortlink-api-link-records
- Fetched: 2026-02-24 17:14:29 +0800

## 接口功能

获取某条[短链接](https://xiaomark.com/shortlink)的一年之内的访问记录。

## 接口地址

```
https://api.xiaomark.com/v2/sl/link/visit_record/batch_get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| link\_url | string | 是 | 短链地址 |
| start\_date | string | 否 | 起始日期，不可早于365天前，按“yyyy-mm-dd”的格式传入，默认为365天前 |
| end\_date | string | 否 | 截止日期，按“yyyy-mm-dd”的格式传入 |
| offset | integer | 否 | 起始位置，默认为0 |
| count | integer | 否 | 请求数量，不超过100，默认为10 |
| exclude\_bot | boolean | 否 | 是否排除机器访问，默认不排除 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "link_url": "https://sourl.cn/6GtdVb",
    "start_date": "2024-11-01",
    "end_date": "2024-11-07",
    "offset": 0,
    "count": 20,
    "exclude_bot": true
}
```

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |
| data | object | 请求成功返回的数据 |
| records | array<object> | 访问记录列表 |
| id | string | 访问记录id |
| visit\_time | integer | 访问时间（以秒为单位的时间戳） |
| ip | string | IP地址 |
| user\_agent | string | User-Agent |
| referer | string | Referer（空字符串表示直接访问） |
| target\_url | string | 短链跳转到的目标链接 |
| z | string | 自定义访问参数z |
| new\_visitor | boolean | 是否为新访客 |
| country\_code | string | 国家代码 |
| country | string | 国家名称 |
| region | string | 省份或地区 |
| city | string | 城市 |
| is\_robot | boolean | 是否为机器访问 |
| browser | string | 浏览器类型（"wechat" - 微信，"qq" - QQ，"tencent" - QQ浏览器，"sogou" - 搜狗浏览器，"uc" - UC浏览器，"ie" - IE，"edge" - Edge，"firefox" - Firefox，"safari" - Safari，"chrome" - Chrome，"other" - 其它） |
| os | string | 操作系统类型（"ios" - iOS，"android" - 安卓，"windows" - Windows，"macos" - MacOS，"linux" - Linux，"other" - 其它） |
| device | string | 设备类型（"mobile" - 移动设备，"pc" - 电脑，"other" - 其它） |
| network | string | 网络类型（"mobile" - 移动网络，"broadband" - 宽带网络） |
| count | integer | 此次请求返回的访问记录数量 |
| total | integer | 访问记录总数 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "records": [
            {
                "id": "5f72af532c7fbddd311a83cf",
                "visit_time": 1602750150,
                "ip": "180.97.118.219",
                "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
                "referer": "",
                "target_url": "https://portal.xiaomark.com/rule.html",
                "z": "nanjing",
                "new_visitor": true,
                "country_code": "CN",
                "country": "中国",
                "region": "江苏省",
                "city": "南京市",
                "is_robot": false,
                "browser": "chrome",
                "os": "windows",
                "device": "pc",
                "network": "broadband"
            },
            {
                "id": "5f7554792c7fbddd311a83d8",
                "visit_time": 1602750926,
                "ip": "47.94.47.130",
                "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
                "referer": "https://xiaomark.com/",
                "target_url": "https://portal.xiaomark.com/rule.html",
                "z": "",
                "new_visitor": false,
                "country_code": "CN",
                "country": "中国",
                "region": "北京市",
                "city": "北京市",
                "is_robot": false,
                "browser": "wechat",
                "os": "android",
                "device": "mobile",
                "network": "mobile"
            }
        ],
        "count": 2,
        "total": 100
    }
}
```
