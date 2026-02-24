# API - 获取短链接访问记录

- Source: https://xiaomark.com/help/api/shortlink-api-record
- Fetched: 2026-02-24 17:14:33 +0800

## 接口地址

```
https://api.xiaomark.com/v1/link/record/get
```

## 请求方法

POST

## **请求参数说明**

| 参数名 | 类型 | 是否必传 | 描述 |
| --- | --- | --- | --- |
| apikey | string | 是 | 用户的API密钥 |
| url | string | 是 | 短链接 |
| offset | integer | 否 | 起始位置，默认为0 |
| limit | integer | 否 | 请求数量，不超过1000，默认为100 |

## **请求POST数据示例**

```
{
    "apikey": "361f534e9897e75af4206ea820365fde",
    "url": "https://sourl.cn/HOHzsG",
    "offset": 0,
    "limit": 100
}
```

![示例图](https://static.interval.im/interval/8TbySENXGPEQScRC.png)

## **返回参数说明**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| code | integer | 返回码 |
| message | string | 返回信息 |
| data | object | 请求成功返回的数据 |
| records | object数组 | 访问记录，详见 访问记录信息 |
| total | integer | 总数 |
| count | integer | 此次请求返回的数量 |

### **访问记录信息 record**

| 名称 | 类型 | 描述 |
| --- | --- | --- |
| id | string | 访问记录ID |
| visit\_time | integer | 访问时间（时间戳，以秒为单位） |
| ip | string | IP地址 |
| user\_agent | string | User-Agent |
| referer | string | 访问来源（空字符串表示直接访问） |
| target\_url | string | 跳转目标链接 |
| z | string | 自定义参数 |
| new\_visitor | boolean | 是否为新访客 |
| is\_robot | boolean | 是否为机器访问 |
| country\_code | string | 国家代码 |
| country | string | 国家 |
| region | string | 省份 |
| city | string | 城市 |
| browser | string | 浏览器： wechat - 微信，qq - QQ，tencent - QQ浏览器，sogou - 搜狗浏览器，uc - UC浏览器，ie - IE，edge - Edge， chrome - Chrome，safari - Safari，firefox - Firefox，other - 其它 |
| os | string | 操作系统：ios/android/windows/macos/linux/other |
| device | string | 设备类型：mobile - 移动设备，pc - 非移动设备，other - 其它 |
| network | string | 网络类型：mobile - 移动网络，broadband - 宽带网络 |

## **返回结果示例**

```
{
    "code": 0,
    "data": {
        "total": 12345,
        "count": 2,
        "records": [
            {
                "id": "5f72af532c7fbddd311a83cf",
                "visit_time": 1602750150,
                "ip": "180.97.118.219",
                "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
                "referer": "https://xiaomark.com/",
                "target_url": "https://portal.xiaomark.com/",
                "z": "nanjing",
                "new_visitor": true,
                "is_robot": false,
                "country_code": "CN",
                "country": "中国",
                "region": "江苏",
                "city": "南京",
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
                "referer": "",
                "target_url": "https://portal.xiaomark.com/",
                "z": "",
                "new_visitor": false,
                "is_robot": false,
                "country_code": "CN",
                "country": "中国",
                "region": "北京",
                "city": "北京",
                "browser": "wechat",
                "os": "android",
                "device": "mobile",
                "network": "mobile"
            }
        ]
    },
    "message": "请求成功"
}
```
