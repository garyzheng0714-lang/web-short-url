# API - 获取短链接访问数据

- Source: https://xiaomark.com/help/api/shortlink-api-data
- Fetched: 2026-02-24 17:14:33 +0800

## 接口地址

```
https://api.xiaomark.com/v1/link/stats/get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 用户的API密钥 |
| url | string | 是 | 短链接 |
| start | string | 是 | 开始日期，按“yyyy-mm-dd”的格式传入 |
| end | string | 是 | 结束日期，按“yyyy-mm-dd”的格式传入 |

备注：日期跨度不能超过 31 天。

## **请求POST数据示例**

```
{
    "apikey": "361f534e9897e75af4206ea820365fde",
    "url": "https://sourl.cn/HOHzsG",
    "start": "2020-10-15",
    "end": "2020-10-19"
}
```

![示例图](https://static.interval.im/interval/efNTy3jEynr7bXcN.png)

## **返回参数说明**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码 |
| message | string | 返回信息 |
| data | object | 请求成功返回的数据 |
| pv | integer | 总访问次数 |
| uv | integer | 总访问人数 |
| uip | integer | 总访问IP数 |
| daily | object 数组 | 每日数据 |
| weekday\_stats | integer数组 | 一周分布数据（长度为7，对应周一到周日） |
| hour\_stats | integer数组 | 24小时分布数据（长度为24，对应0点到23点） |
| top\_ip\_stats | object 数组 | Top 5 IP |
| top\_referer\_stats | object 数组 | Top 5 referer |
| locale\_global\_stats | object 数组 | 国际地区分布数据 |
| locale\_cn\_stats | object 数组 | 中国地区分布数据 |
| browser\_stats | object 数组 | 浏览器分布数据 |
| os\_stats | object 数组 | 操作系统分布数据 |
| device\_stats | object 数组 | 设备类型分布数据 |
| net\_stats | object 数组 | 网络类型分布数据 |

### **daily 对象详情**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| date | String | 日期 |
| pv | integer | 访问次数 |
| uv | integer | 访问人数 |
| uip | integer | 访问IP数 |

### **top\_stats 对象详情**

top\_ip\_stats, top\_referer\_statss 返回的对象如下：

| 名称 | 类型 | 描述 | 归属对象 |
| --- | --- | --- | --- |
| ip | String | IP | top\_ip\_stats |
| referer | String | Referer（空字符串表示直接访问） | top\_referer\_statss |
| cnt | integer | 计数 | 都有 |

### **locale\_stats 对象详情**

locale\_global\_stats 和 locale\_cn\_stats 返回的对象如下：

| 名称 | 类型 | 描述 | 归属对象 |
| --- | --- | --- | --- |
| locale | String | 地区 | 都有 |
| cnt | integer | 计数 | 都有 |
| ratio | number | 占比 | 都有 |

### **xxx\_stats 对象详情**

browser\_stats, os\_stats, device\_stats, net\_stats 返回的对象如下：

| 名称 | 类型 | 描述 | 归属对象 |
| --- | --- | --- | --- |
| browser | String | 浏览器： wechat - 微信，qq - QQ，tencent - QQ浏览器，sogou - 搜狗浏览器，uc - UC浏览器，ie - IE，edge - Edge， chrome - Chrome，safari - Safari，firefox - Firefox，other - 其它 | browser\_stats |
| os | String | 操作系统：ios/android/windows/macos/linux/other | os\_stats |
| device | String | 设备类型：mobile/pc/other | device\_stats |
| net | String | 网络类型：mobile/broadband | net\_stats |
| cnt | integer | 计数 | 都有 |
| ratio | number | 占比 | 都有 |

## **返回结果示例**

```
        {
            "code": 0,
            "data": {
                "browser_stats": [
                    {
                        "browser": "chrome",
                        "cnt": 968,
                        "ratio": 0.32213
                    },
                    // ... 其他浏览器
                    {
                        "browser": "firefox",
                        "cnt": 14,
                        "ratio": 0.004659
                    }
                ],
                "daily": [
                    {
                        "date": "2020-10-15",
                        "pv": 535,
                        "uip": 451,
                        "uv": 478
                    },
                    {
                        "date": "2020-10-16",
                        "pv": 709,
                        "uip": 575,
                        "uv": 593
                    },
                    {
                        "date": "2020-10-17",
                        "pv": 801,
                        "uip": 660,
                        "uv": 681
                    },
                    {
                        "date": "2020-10-18",
                        "pv": 515,
                        "uip": 441,
                        "uv": 453
                    },
                    {
                        "date": "2020-10-19",
                        "pv": 445,
                        "uip": 402,
                        "uv": 413
                    }
                ],
                "device_stats": [
                    {
                        "cnt": 2747,
                        "device": "mobile",
                        "ratio": 0.914143
                    },
                    {
                        "cnt": 258,
                        "device": "pc",
                        "ratio": 0.085857
                    }
                ],
                "hour_stats": [
                    158,104,62,38,34,42,36,39,83,97,108,125,166,181,174,161,147,152,151,168,152,208,212,207
                ],
                "locale_cn_stats": [
                    {
                        "cnt": 405,
                        "locale": "广东",
                        "ratio": 0.134775
                    },
                    // ... 其他中国地区
                    {
                        "cnt": 2,
                        "locale": "香港",
                        "ratio": 0.000666
                    }
                ],
                "locale_global_stats": [
                    {
                        "cnt": 2961,
                        "locale": "中国",
                        "ratio": 0.985358
                    },
                    {
                        "cnt": 9,
                        "locale": "英国",
                        "ratio": 0.002995
                    },
                    // ... 其他国家
                    {
                        "cnt": 1,
                        "locale": "新加坡",
                        "ratio": 0.000333
                    }
                ],
                "net_stats": [
                    {
                        "cnt": 2642,
                        "net": "broadband",
                        "ratio": 0.879201
                    },
                    {
                        "cnt": 363,
                        "net": "mobile",
                        "ratio": 0.120799
                    }
                ],
                "os_stats": [
                    {
                        "cnt": 2176,
                        "os": "android",
                        "ratio": 0.724126
                    },
                    // ... 其他设备
                    {
                        "cnt": 565,
                        "os": "ios",
                        "ratio": 0.18802
                    }
                ],
                "pv": 3005,
                "top_ip_stats": [
                    {
                        "cnt": 10,
                        "ip": "183.217.211.23"
                    },
                    {
                        "cnt": 7,
                        "ip": "117.167.249.35"
                    },
                    {
                        "cnt": 7,
                        "ip": "36.98.213.98"
                    },
                    {
                        "cnt": 6,
                        "ip": "118.212.199.179"
                    },
                    {
                        "cnt": 6,
                        "ip": "117.61.240.185"
                    }
                ],
                "top_referer_stats": [
                    {
                        "cnt": 269,
                        "referer": "https://sourl.cn/RDCzBw"
                    },
                    {
                        "cnt": 173,
                        "referer": "http://sourl.cn/PFbD3n"
                    },
                    {
                        "cnt": 138,
                        "referer": "https://sourl.cn/TXY5nH"
                    },
                    {
                        "cnt": 60,
                        "referer": "https://sourl.cn/BhEMSx"
                    },
                    {
                        "cnt": 46,
                        "referer": "https://sourl.cn/AkurGq"
                    }
                ],
                "uip": 2516,
                "uv": 2605,
                "weekday_stats": [
                    445,0,0,535,709,801,515
                ]
            },
            "message": "请求成功"
        }
```
