# 获取短链多维统计数据

- Source: https://xiaomark.com/help/api/shortlink-api-link-chart-stats
- Fetched: 2026-02-24 17:14:29 +0800

## 接口功能

获取某个[短链接](https://xiaomark.com/shortlink)的多维统计数据，对应数据报表中的24小时分布、地理位置分布、设备、网络等统计数据。

## 接口地址

```
https://api.xiaomark.com/v2/sl/link/chart_stats/get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 团队的API密钥 |
| link\_url | string | 是 | 短链地址 |
| start\_date | string | 是 | 统计起始日期，不可早于365天前，按“yyyy-mm-dd”的格式传入 |
| end\_date | string | 是 | 统计截止日期，按“yyyy-mm-dd”的格式传入；起止日期跨度不可超过31天 |
| exclude\_bot | boolean | 否 | 是否排除机器访问，默认不排除 |

## **JSON请求示例**

```
{
    "apikey": "5ac55544645cf99e40b14b4e78de5d90",
    "link_url": "https://s.xma.im/6MsW",
    "start_date": "2024-11-01",
    "end_date": "2024-11-30"
}
```

## 

## **返回数据说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码，0 代表请求成功，其他数值代表出错，详细见“返回码说明”页面 |
| message | string | “请求成功”，或者相应的错误信息 |
| data | object | 请求成功返回的数据 |
| new\_visitor\_count | integer | 所选时段内的新访客数 |
| hour\_stats | array<object> | 所选时段内的24小时分布数据 |
| hour | integer | 小时（取值范围0~23，例如，8表示8点整到9点整之间的时段） |
| count | integer | 访问次数 |
| top\_ip\_stats | array<object> | 所选时段内访问次数前5名的IP分布数据 |
| ip | string | IP地址 |
| count | integer | 访问次数 |
| top\_referer\_stats | array<object> | 所选时段内访问次数前5名的Referer分布数据 |
| referer | string | Referer（空字符串表示直接访问） |
| count | integer | 访问次数 |
| world\_stats | array<object> | 所选时段内各国家分布数据 |
| country\_code | string | 国家代码 |
| country | string | 国家名称 |
| count | integer | 访问次数 |
| china\_stats | array<object> | 所选时段内中国各省份和地区分布数据 |
| region | string | 省份或地区 |
| count | integer | 访问次数 |
| browser\_stats | array<object> | 所选时段内浏览器分布数据 |
| browser | string | 浏览器类型（"wechat" - 微信，"qq" - QQ，"tencent" - QQ浏览器，"sogou" - 搜狗浏览器，"uc" - UC浏览器，"ie" - IE，"edge" - Edge，"firefox" - Firefox，"safari" - Safari，"chrome" - Chrome，"other" - 其它） |
| count | integer | 访问次数 |
| os\_stats | array<object> | 所选时段内操作系统分布数据 |
| os | string | 操作系统类型（"ios" - iOS，"android" - 安卓，"windows" - Windows，"macos" - MacOS，"linux" - Linux，"other" - 其它） |
| count | integer | 访问次数 |
| device\_stats | array<object> | 所选时段内设备分布数据 |
| device | string | 设备类型（"mobile" - 移动设备，"pc" - 电脑，"other" - 其它） |
| count | integer | 访问次数 |
| network\_stats | array<object> | 所选时段内网络分布数据 |
| network | string | 网络类型（"mobile" - 移动网络，"broadband" - 宽带网络） |
| count | integer | 访问次数 |

## **JSON返回示例**

```
{
    "code": 0,
    "message": "请求成功",
    "data": {
        "new_visitor_count": 2605,
        "hour_stats": [
            {
                "hour": 0,
                "count": 158
            },
            {
                "hour": 1,
                "count": 104
            },
            // ... 其它小时时段
            {
                "hour": 23,
                "count": 207
            }
        ],
        "top_ip_stats": [
            {
                "ip": "183.217.211.23",
                "count": 10
            },
            {
                "ip": "117.167.249.35",
                "count": 7
            },
            {
                "ip": "36.98.213.98",
                "count": 7
            },
            {
                "ip": "118.212.199.179",
                "count": 6
            },
            {
                "ip": "117.61.240.185",
                "count": 6
            }
        ],
        "top_referer_stats": [
            {
                "referer": "",
                "count": 1983
            },
            {
                "referer": "http://sourl.cn/PFbD3n",
                "count": 173
            },
            {
                "referer": "https://sourl.cn/TXY5nH",
                "count": 138
            },
            {
                "referer": "https://sourl.cn/BhEMSx",
                "count": 60
            },
            {
                "referer": "https://sourl.cn/AkurGq",
                "count": 46
            }
        ],
        "world_stats": [
            {
                "country_code": "CN",
                "country": "中国",
                "count": 2961
            },
            {
                "country_code": "UK",
                "country": "英国",
                "count": 19
            },
            // ... 其他国家
            {
                "country_code": "SG",
                "country": "新加坡",
                "count": 1
            }
        ],
        "china_stats": [
            {
                "region": "广东省",
                "count": 405
            },
            {
                "region": "江苏省",
                "count": 341
            },
            // ... 其他省份和地区
            {
                "region": "香港特别行政区",
                "count": 5
            }
        ],
        "browser_stats": [
            {
                "browser": "chrome",
                "count": 968
            },
            // ... 其他浏览器
            {
                "browser": "firefox",
                "count": 4
            }
        ],
        "os_stats": [
            {
                "os": "android",
                "count": 1576
            },
            // ... 其他操作系统
            {
                "os": "macos",
                "count": 33
            }
        ],
        "device_stats": [
            {
                "device": "mobile",
                "count": 2747
            },
            {
                "device": "pc",
                "count": 258
            }
        ],
        "network_stats": [
            {
                "network": "broadband",
                "count": 1542
            },
            {
                "network": "mobile",
                "count": 1463
            }
        ]
    }
}
```
