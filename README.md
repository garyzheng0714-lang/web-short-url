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
- 短链二维码生成（服务端 `qrcode` 库生成，支持预览与下载）
- 重定向链解析（`/api/tools/resolve-redirect`，追踪完整跳转链路）
- 短链重定向代理（`/go?url=`，302 跳转）
- 本地短链列表（localStorage，支持搜索、分组筛选、状态筛选、导出）
- Dashboard 统计卡片（短链总数、重定向测试、二维码生成、重定向解析）
- 健康检查接口（`/api/health`）

## 默认行为

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

开发模式（文件变更自动重启）：

```bash
npm run dev
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

参见 `.env.example`

- `XIAOMARK_API_KEY`：服务端代理使用的小码 API Key
- `DEFAULT_WEBHOOK_CALLBACK_URL`：前端”更多选项”默认显示的 webhook 地址（不提交到创建接口）
- `DEFAULT_WEBHOOK_SCENE`：默认 webhook 场景值（可选）
- `XIAOMARK_CACHE_TTL_MS`：元数据缓存时间（毫秒，默认 30000）
- `PORT`：服务端端口（默认 3000）

## 部署到服务器

详见 `DEPLOY.md`

## 目录结构

- `server.js`：Node/Express 代理与元数据 API、QR 码生成、重定向解析
- `public/index.html`：页面结构
- `public/app.js`：前端逻辑（下拉拉取、弹窗创建分组、提交、历史列表、二维码、重定向解析）
- `public/styles.css`：样式
- `ecosystem.config.cjs`：PM2 部署配置
- `scripts/fetch_xiaomark_api_docs.py`：小码 API 文档抓取脚本
- `docs/xiaomark-api/`：导出的 API 文档 Markdown

