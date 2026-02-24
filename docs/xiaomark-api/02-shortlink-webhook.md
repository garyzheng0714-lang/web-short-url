# Webhook 回调通知使用说明

- Source: https://xiaomark.com/help/api/shortlink-webhook
- Fetched: 2026-02-24 17:14:20 +0800

## **推送机制**

Webhook 回调是指当您的短链被访问时，[小码短链接](https://xiaomark.com/shortlink)将向您设定的 URL 上通过 POST 请求发送数据。

如果您需要接收此类事件消息来实现业务逻辑，请按下列操作：

1. 开通公网可以访问的 IP 地址（或域名）和端口，如果需要对传输加密，请使用支持 HTTPS 的 URL 地址；
2. 在**「短链 > API 短链 > API 设置」**中设置接收推送的 URL 地址，以及用于签名验证的 token；
3. 调用接口创建短链，如需接收该短链的事件消息，则传入相应的参数以开启事件推送；
4. 处理 POST 请求报文，实现业务逻辑。

您的服务器接收到某条 Webhook 推送消息后须在 5 秒内返回字符串 success，如果未返回 success，[小码短链接](https://xiaomark.com/shortlink)将认为此条消息未能被成功处理，从而触发推送重试机制，重试最多会进行 4 次，单次发送间隔分别为 5 秒、10 秒、30 秒和 60 秒。

## **推送消息示例**

```
{
    "url": "https://sourl.cn/HOHzsG",
    "scene": "xiaomark",
    "msgid": "5f72af532c7fbddd311a83cf",
    "sign": "0a03e06acdf0dbff16e4e7888d056a3150839f6d",
    "record": {
        "id": "5f72af532c7fbddd311a83cf",
        "visit_time": 1602750150,
        "ip": "180.97.118.219",
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        "referer": "https://xiaomark.com/",
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
    }
}
```

## **参数说明**

| **字段名** | 类型 | 描述 |
| --- | --- | --- |
| url | string | 短链地址 |
| scene | string | 事件推送场景值（于创建短链时填写） |
| msgid | string | 消息id，可用于重试的消息排重 |
| sign | string | 数字签名 |
| record | object | 访问记录 |
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

## **验证签名**

签名的目的在于验证 Webhook 推送消息是由[小码短链接](https://xiaomark.com/shortlink)发送的，防止其他人恶意向您设置的推送地址发送伪造数据。

签名验证方式：取 Webhook 签名验证 token（在**「短链 > API 短链 > API 设置」**中设置）、url（短链地址）、msgid（消息id）这三个字符串值，将它们按字典序排序后拼接成一个字符串，然后进行 SHA1 数字签名，比较所得结果与 sign 字段值是否相等即可。
