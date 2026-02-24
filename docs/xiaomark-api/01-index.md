# 使用前必读

- Source: https://xiaomark.com/help/api/
- Fetched: 2026-02-24 17:14:20 +0800

## 短链 API 的用途

[短链接](https://xiaomark.com/shortlink) API 是[小码短链接](https://xiaomark.com/shortlink)推出的使用接口创建短链、查询数据等相关操作的功能。使用短链 API 你可以打通自有的产品体系，将数据互联互通，典型的应用场景如下：

- 生成邀请链接：产品有邀请链接，可以为用户生成专属的邀请链接；
- 短信营销：为每个手机号生成专属的链接，用户点击后通过 webhook 推送消息至服务器；
- 系统集成：集成公司自有的营销、生产等各类系统，缩短美化链接。

## 项目、分组和链接

V2 版本的接口添加了关于项目、分组的相关操作，为了给您一个直观的印象，下图展示了项目、分组和链接之间的关系：

![](https://bcdn.xiaomark.com/help/2a90c9b2123435a9cb20303c6194744a.png)

## 关于 V1 与 V2 接口

V1 接口为[小码短链接](https://xiaomark.com/shortlink)最老的接口版本，上线时间久、功能简陋、不支持批量创建，只是为了老用户不受影响，不推荐新用户使用。新接入用户请使用 V2 版本接口。

## 关于域名白名单

1. 短链的跳转链接的域名需添加至白名单，创建短链之前请先到**「短链 > API 短链 > API 设置」**中添加白名单域名；
2. 白名单中的域名需精确匹配，不支持通配符或者子域名。例如，跳转链接为 http://a.b.c.interval.im/xyz，提交的白名单域名应为 a.b.c.interval.im，若提交 c.interval.im 或 b.c.interval.im 都无法调用成功；
3. 白名单域名也可以通过调用相关的 API 接口进行查询和提交；
4. 白名单域名有数量限制，并且每月提交白名单的次数也有限制，如果数量无法满足您的使用需求，请联系客服并说明您的应用场景；
5. 使用[自有域名](https://xiaomark.com/shortlink/advance/custom-domain)生成短链可以填写任意跳转链接，不受域名白名单的限制。

## 接口鉴权方式

短链 API 接口全部为 POST 请求，鉴权方式为在每个 POST 请求的 body 中加入 apikey 字段，apikey 可以在**「短链 > API 短链 > API 设置」**获取。

## POST 请求数据格式

所有接口均为 POST 请求：

1. 请求头添加 Content-Type: application/json
2. 请求体 body 使用 json 格式传入；
3. 请求体 body 中添加 apikey 字段进行鉴权。

```
{
    "apikey": "小码后台获取到的API密钥",
    ...
}
```
