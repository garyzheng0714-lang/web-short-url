# web-short-url

![类型](https://img.shields.io/badge/%E7%B1%BB%E5%9E%8B-%E7%9F%AD%E9%93%BE%E5%B7%A5%E5%85%B7-f97316)
![技术栈](https://img.shields.io/badge/%E6%8A%80%E6%9C%AF%E6%A0%88-Node.js%20%2B%20Express%20%2B%20SQLite-2563eb)
![状态](https://img.shields.io/badge/%E7%8A%B6%E6%80%81-%E5%86%85%E9%83%A8%E5%B7%A5%E5%85%B7-16a34a)
![README](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-111827)

基于小码 API 的短链接创建网页工具，通过 Node.js/Express 服务端代理保护 API key，并提供二维码、跳转解析和历史记录能力。

## 仓库定位

- 分类：短链工具 / 小码 API 前端代理 / 运营链接管理。
- 服务对象：需要快速创建短链、生成二维码、排查跳转链路并保存个人历史记录的内部运营工作流。
- 边界说明：本仓库是独立 Web 工具，不是浏览器插件，也不是飞书多维表格插件。

## 功能概览

- 创建单条小码短链接。
- 自动拉取小码项目、分组和自有域名。
- 支持在前端弹窗创建分组。
- 支持默认域名、随机后缀长度和高级字段展示。
- 服务端缓存项目/分组/域名元数据，缓存时长可配置。
- 生成短链二维码，支持预览、复制和下载。
- 解析跳转链路，便于排查最终落地页。
- `/go?url=` 重定向代理。
- 浏览器本地历史记录；登录后可使用 SQLite 保存服务端历史。
- 飞书双租户登录：支持 FBIF 与富的两个自建应用，飞书客户端内可免登。
- 提供健康检查接口、PM2 配置和 Nginx 部署说明。

## 技术栈

- Node.js ES modules。
- Express 4。
- better-sqlite3。
- cookie-parser。
- dotenv。
- qrcode。
- 原生 HTML/CSS/JavaScript 前端。
- PM2 进程管理。

## 快速开始

安装依赖：

```bash
npm install
```

创建本地环境配置：

```bash
cp .env.example .env
```

启动服务：

```bash
npm start
```

开发模式：

```bash
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

## 配置

`.env.example` 中的主要变量：

| 变量 | 说明 |
| --- | --- |
| `PORT` | 服务端端口，默认 `3000` |
| `XIAOMARK_API_KEY` | 服务端保存的小码 API key |
| `DEFAULT_WEBHOOK_CALLBACK_URL` | 前端高级字段的默认展示值 |
| `DEFAULT_WEBHOOK_SCENE` | 前端高级字段的默认场景值 |
| `XIAOMARK_CACHE_TTL_MS` | 小码元数据缓存时长，单位毫秒 |

飞书登录需要两个租户各建一个自建网页应用，并把 App ID / App Secret 放到服务端环境变量：

| 变量 | 说明 |
| --- | --- |
| `FEISHU_FBIF_APP_ID` | FBIF 自建应用 App ID |
| `FEISHU_FBIF_APP_SECRET` | FBIF 自建应用 App Secret |
| `FEISHU_FUDE_APP_ID` | 富的自建应用 App ID |
| `FEISHU_FUDE_APP_SECRET` | 富的自建应用 App Secret |
| `FEISHU_REDIRECT_BASE` | 部署根地址，例如 `https://shorturl.garyzheng.com` |
| `FEISHU_ALLOWED_TENANT_KEYS` | 可选，逗号分隔的飞书 `tenant_key` 白名单 |

飞书后台网页应用首页 URL：

| 租户 | 首页 URL |
| --- | --- |
| FBIF | `https://shorturl.garyzheng.com/login?tenant=fbif` |
| 富的 | `https://shorturl.garyzheng.com/login?tenant=fude` |

安全设置里的重定向 URL 按租户分别配置：

| 应用 | 重定向 URL |
| --- | --- |
| FBIF | `https://shorturl.garyzheng.com/login` |
| FBIF | `https://shorturl.garyzheng.com/auth/feishu/fbif/callback` |
| FBIF | `https://shorturl.garyzheng.com/auth/feishu/fbif/qr-callback` |
| 富的 | `https://shorturl.garyzheng.com/login` |
| 富的 | `https://shorturl.garyzheng.com/auth/feishu/fude/callback` |
| 富的 | `https://shorturl.garyzheng.com/auth/feishu/fude/qr-callback` |

免登主链路是飞书客户端打开 `/login?tenant=...`，前端用飞书 H5 SDK 获取临时 code，后端用对应租户的 App Secret 换用户身份并创建本系统 session。普通浏览器或 SDK 不可用时，会退回到登录页按钮/扫码登录。

运行时 SQLite 数据保存在项目目录的 `shorturl.db`。

## 项目结构

```text
.
├── server.js                 # Express 代理、OAuth、历史记录和二维码接口
├── public/                   # 前端页面、脚本和样式
├── docs/xiaomark-api/        # 小码 API 文档导出
├── scripts/                  # 小码 API 文档抓取脚本
├── DEPLOY.md                 # Node.js + PM2 + Nginx 部署说明
├── ecosystem.config.cjs      # PM2 配置
├── .env.example              # 环境变量模板
└── package.json
```

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm start` | 运行 `server.js` |
| `npm run dev` | 使用 `node --watch` 运行 `server.js` |

## 本地接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/config` | 返回前端配置与接口路径 |
| `GET /auth/feishu/:tenant/login` | 发起飞书 OAuth 登录，`:tenant` 为 `fbif` 或 `fude` |
| `GET /auth/feishu/:tenant/callback` | OAuth 登录回调 |
| `GET /auth/feishu/:tenant/qr-config` | 获取扫码登录配置 |
| `GET /auth/feishu/:tenant/qr-callback` | 扫码登录回调 |
| `GET /auth/feishu/:tenant/sso-config` | 飞书客户端内免登配置 |
| `POST /auth/feishu/:tenant/sso-exchange` | 飞书客户端内免登 code 交换 |
| `GET /api/me` | 检查登录状态 |
| `GET /api/history` | 读取已登录用户历史记录 |
| `POST /api/history/migrate` | 将浏览器历史迁移到服务端历史 |
| `POST /api/meta/projects` | 代理读取小码项目 |
| `POST /api/meta/groups` | 代理读取小码分组 |
| `POST /api/meta/groups/create` | 代理创建小码分组 |
| `POST /api/meta/private-domains` | 代理读取自有域名 |
| `POST /api/shortlinks/create` | 代理创建短链接 |
| `POST /api/tools/qrcode` | 生成二维码 |
| `POST /api/tools/resolve-redirect` | 解析跳转链路 |
| `GET /go?url=<url>` | 重定向代理 |

小码相关接口需要服务端 `XIAOMARK_API_KEY`，或由前端用户输入 API key。

## 部署

详见 `DEPLOY.md`。常见 PM2 流程：

```bash
npm ci
pm2 start ecosystem.config.cjs --env production
pm2 save
```

部署时建议通过 Nginx 反向代理，并把 API key 与 OAuth 密钥放在服务器环境变量或 `.env` 中。

## 注意事项

- 不要把小码 API key、飞书 App Secret 或 OAuth 配置提交到仓库。
- “Webhook 推送地址”字段用于展示和记录；小码 webhook callback 与签名 token 仍需在小码后台配置。
- 未配置飞书 OAuth 时仍可创建短链，但无法使用已登录用户的服务端历史记录。
