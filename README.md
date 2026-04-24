# web-short-url

基于小码 API 的短链创建网页工具，使用 Node.js/Express 做服务端代理，避免浏览器直连第三方 API 的 CORS 和密钥暴露问题。

## Overview

应用提供一个轻量网页，用于创建短链、生成二维码、解析跳转链路和管理历史记录。服务端负责代理小码 API、缓存项目/分组/域名元数据、生成 QR Code，并提供可选的飞书 OAuth 登录与 SQLite 历史记录存储。

## Features

- 创建单条短链
- 自动拉取小码项目、分组和自有域名
- 在前端弹窗创建分组
- 支持默认域名和随机后缀长度
- 服务端元数据缓存，缓存时长可配置
- 短链二维码生成、预览、复制和下载
- 重定向链解析，便于排查跳转结果
- `/go?url=` 短链重定向代理
- 本地历史记录搜索、筛选、清空和导出
- 可选飞书 OAuth 登录，登录后通过 SQLite 保存历史记录
- 健康检查接口
- PM2 和 Nginx 部署说明

## Tech Stack

- Node.js with ES modules
- Express 4
- better-sqlite3
- cookie-parser
- dotenv
- qrcode
- Plain HTML/CSS/JavaScript frontend
- PM2 for process management

## Project Structure

```text
.
├── server.js                       # Express proxy, auth, history and QR APIs
├── public/
│   ├── index.html                  # Frontend page
│   ├── app.js                      # Browser-side app logic
│   └── styles.css                  # Styles
├── docs/xiaomark-api/              # Exported Xiaomark API docs
├── scripts/fetch_xiaomark_api_docs.py
├── ecosystem.config.cjs            # PM2 config
├── DEPLOY.md                       # Server deployment guide
├── .env.example
└── package.json
```

## Getting Started

Install dependencies:

```bash
npm install
```

Create local environment configuration:

```bash
cp .env.example .env
```

Start the server:

```bash
npm start
```

Development mode with Node's watch mode:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Run `server.js` |
| `npm run dev` | Run `server.js` with `node --watch` |

## Configuration

Variables from `.env.example`:

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port, default `3000` |
| `XIAOMARK_API_KEY` | Server-side Xiaomark API key |
| `DEFAULT_WEBHOOK_CALLBACK_URL` | Display/default value for the advanced webhook field |
| `DEFAULT_WEBHOOK_SCENE` | Default webhook scene value |
| `XIAOMARK_CACHE_TTL_MS` | Metadata cache TTL in milliseconds |

The server code also supports optional Feishu OAuth settings for login and server-side history:

| Variable | Purpose |
| --- | --- |
| `FEISHU_APP_ID` | Feishu app ID |
| `FEISHU_APP_SECRET` | Feishu app secret |
| `FEISHU_OAUTH_REDIRECT_URI` | Feishu OAuth callback URL |

Runtime SQLite data is stored in `shorturl.db` in the project directory.

## API Notes

Selected local endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/auth/feishu/login` | Start optional Feishu OAuth login |
| `GET /api/auth/session` | Check login session |
| `GET /api/history` | Read authenticated history |
| `POST /api/history/migrate` | Migrate browser history into server history |
| `GET /go?url=<url>` | Redirect proxy |

The create-link and metadata endpoints proxy requests to Xiaomark APIs and require either a server-side `XIAOMARK_API_KEY` or a user-entered API key in the UI.

## Deployment

See [`DEPLOY.md`](DEPLOY.md) for the Node.js + PM2 + Nginx deployment guide.

Typical PM2 flow:

```bash
npm ci
pm2 start ecosystem.config.cjs --env production
pm2 save
```

## Notes

- Keep API keys and OAuth secrets in environment variables; do not commit `.env`.
- The “Webhook 推送地址” field is for display/recording in this tool. Xiaomark webhook callback and signing token still need to be configured in the Xiaomark backend.
- If Feishu OAuth is not configured, the tool can still create short links, but authenticated cross-device history will not be available.
