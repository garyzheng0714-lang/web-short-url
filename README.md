# web-short-url

基于小码 API 的短链创建网页（本地/服务器部署均可），通过 Node.js 本地代理调用接口，避免浏览器直连 CORS 问题。

## 已实现

- 创建单条短链（`/v2/sl/link/create`）
- 项目下拉选择（自动拉取）
- 分组下拉选择（按项目拉取）
- 前端弹窗创建分组（`/v2/sl/group/create`）
- 自有域名下拉选择（自动拉取）
- 元数据服务端缓存（项目/分组/自有域名）
- 高级选项折叠（名称、域名、后缀、webhook、访问过滤）

## 默认行为（符合你的要求）

- `微信内强制浏览器打开`：默认关闭
- `深度过滤机器访问`：默认开启
- `开启事件推送（webhook）`：默认开启
- `随机后缀长度`：默认 `4`

说明：

- “Webhook 推送地址（展示/记录用）”字段不会提交给小码创建短链接口，仅用于前端记录和部署核对。
- Webhook 的推送地址 / 签名 token 仍需在小码后台 `API 设置` 中配置。

## 本地运行

```bash
npm install
npm start
```

打开：

- `http://localhost:3000`

## 推荐环境变量

```bash
XIAOMARK_API_KEY=你的apikey \
DEFAULT_WEBHOOK_CALLBACK_URL='你的webhook回调地址' \
npm start
```

## 环境变量

参见 `/Users/simba/local_vibecoding/short-url/.env.example`

- `XIAOMARK_API_KEY`：服务端代理使用的小码 API Key
- `DEFAULT_WEBHOOK_CALLBACK_URL`：前端“更多选项”默认显示的 webhook 地址（不提交到创建接口）
- `DEFAULT_WEBHOOK_SCENE`：默认 webhook 场景值（可选）
- `XIAOMARK_CACHE_TTL_MS`：元数据缓存时间（毫秒）
- `PORT`：服务端端口

## 部署到服务器

详见 `/Users/simba/local_vibecoding/short-url/DEPLOY.md`

## 目录结构

- `/Users/simba/local_vibecoding/short-url/server.js`：Node/Express 代理与元数据 API
- `/Users/simba/local_vibecoding/short-url/public/index.html`：页面结构
- `/Users/simba/local_vibecoding/short-url/public/app.js`：前端逻辑（下拉拉取、弹窗创建分组、提交）
- `/Users/simba/local_vibecoding/short-url/public/styles.css`：样式
- `/Users/simba/local_vibecoding/short-url/docs/xiaomark-api/`：导出的 API 文档 Markdown

