# 短链生成工具（web-short-url）

内部短链工具：在小码（Xiaomark）团队账号之上，提供短链创建、归属和效果仪表盘。飞书登录识别使用者，Express 把小码账号里的全部短链与统计镜像到本地 SQLite，React 前端读本地数据展示。

> 目录位于 `归档/`，但仓库 `main` 分支有生产部署（`https://shorturl.garyzheng.com`，服务器 121.40.214.5，端口 3010），不能按废弃项目处理。

## 能力

- **生成短链**：「生成短链」页只有一个输入框和一个按钮，粘贴长链接即生成；域名与分组用个人设置里的默认值。每人每月默认 100 条（认领来的不算），用完弹窗提示联系 Gary，管理员可在设置页单独调额度。
- **全量镜像**：定时把小码账号里的项目、分组、全部短链（约 1 万条）同步到本地，列表、搜索、筛选、排序都走本地库。
- **仪表盘**：区间访问、访客、今日访问、短链数四张指标卡，每日访问图，访问最多的短链与分组两张排行。
- **短链访问数据**：表格（标签页切到分组），可按分组、状态筛选，点表头按创建时间或访问排序；点短链在右侧抽屉看详情（每日访问、24 小时分布、设备、系统、浏览器、网络、地区、来源、高频 IP、访问记录）。
- **可见范围**：管理员看全部；其他人只看、只改自己创建的短链（服务端强制）。本工具建的短链自动记创建者；历史短链由管理员认领或改派；管理员可把分组指定给某人。
- **管理**：编辑目标链接与名称、暂停 / 恢复跳转（长按确认，列表有状态列）、二维码、跳转链路解析；管理员可看同步状态、小码额度与白名单、成员列表。
- **Webhook（可选）**：接收小码访问事件推送（验签、去重），可原样转发给原有接收方。

## 架构

```
浏览器 React 19 + Vite + Tailwind v4 + Su Design（web/）
   │ 同源 fetch，cookie 或 X-Session-Token
   ▼
Express（server.js）
   ├─ 飞书 OAuth / 端内 SSO（lib/feishu_auth.js）
   ├─ 业务 API（lib/api.js）：只读本地镜像；写操作先打小码再回写
   ├─ 同步引擎（lib/sync.js）：盘点、分层刷新累计数据、按需拉每日 / 多维数据
   ├─ 小码客户端（lib/xiaomark.js）：并发上限、退避重试、熔断
   └─ SQLite（lib/db.js，版本化迁移）
```

详细说明见 [docs/ARCHI.md](docs/ARCHI.md)。

## 页面

| 路径 | 内容 |
| --- | --- |
| `/` | 生成短链：只有输入框和按钮；旧版首页带的查询串转到 `/data` |
| `/dashboard` | 仪表盘：指标卡、每日访问图、访问最多的短链与分组排行。查询串 `scope=mine`（管理员）、`range=7d/90d`；`link=<id>` 打开短链抽屉，`g=<分组 id>` 打开分组抽屉（管理员） |
| `/data` | 短链访问数据：表格。查询串 `view=groups`、`scope=mine`（管理员）、`group=`、`status=active/suspended/banned`、`q=`、`sort=created_asc/visits/visits_asc`、`page=`；`link=<id>`、`g=<分组 id>` 同上 |
| `/settings` | 默认域名 / 分组 / 机器过滤；管理员：同步状态、小码额度、成员与每月额度（可填任意条数） |
| `/links/:id`、`/groups`、`/groups/:id`、`/overview` | 旧地址：前三个重定向到 `/data` 对应的抽屉或视图，`/overview` 到 `/dashboard` |
| `/login` | 飞书登录页（静态 `public/login.html`） |

## API

全部返回 `{ ok, data }` 或 `{ ok: false, error: { code, message } }`。除标注外都要求登录。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（公开） |
| GET | `/api/me` | 登录态 |
| GET | `/api/bootstrap` | 当前用户、域名、分组、默认值、额度、同步摘要 |
| GET | `/api/links` | 列表：`scope`、`group`、`status`、`domain`、`q`、`sort`（`created` / `created_asc` / `visits` / `visits_asc` / `visitors`）、`page`、`page_size` |
| GET | `/api/links/trends?ids=` | 7 日迷你趋势（最多 50 条；表格改版后前端暂未使用） |
| POST | `/api/links` | 建链（超出本月额度返回 403 `quota_exceeded`） |
| GET | `/api/usage` | 本月用量：`used`、`limit`、`remaining`、`contact` |
| GET / PATCH | `/api/links/:id` | 详情 / 编辑（创建者、分组归属人或管理员） |
| POST | `/api/links/:id/suspend`、`/resume`、`/claim` | 暂停、恢复、认领（管理员可传 `open_id` 改派） |
| GET | `/api/links/:id/stats` | 累计、期间、每日序列、多维分布；`range=7d|30d|90d` 或 `start&end`，`bot=include` 含机器 |
| GET | `/api/links/:id/visits` | 访问记录分页 |
| GET | `/api/overview` | 概览聚合 |
| GET / POST | `/api/groups` | 分组列表 / 新建 |
| GET | `/api/groups/:id/stats` | 分组数据 |
| PATCH | `/api/groups/:id` | 归属人、改名（管理员） |
| GET | `/api/users` | 成员（含本月用量与额度） |
| PATCH | `/api/users/:openId` | 调整某人每月额度 `monthly_quota`，`null` 恢复默认（管理员） |
| GET / PUT | `/api/settings` | 个人默认值 |
| GET / POST | `/api/admin/sync`、`/api/admin/sync/run` | 同步状态 / 手动触发（管理员） |
| GET | `/api/admin/quota` | 小码额度、白名单、自有域名（管理员） |
| POST | `/api/tools/qrcode`、`/api/tools/resolve-redirect` | 二维码、跳转链路 |
| POST | `/api/webhooks/xiaomark` | 小码事件推送（公开，SHA1 验签，未配置 token 时 404） |
| GET | `/go?url=` | 302 跳转，只允许短链域名（公开） |

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | 默认 3000，生产 3010 |
| `XIAOMARK_API_KEY` | 是 | 小码团队 API key，只在服务端 |
| `SYNC_ENABLED` / `SYNC_TICK_MS` / `SYNC_CONCURRENCY` | 否 | 同步开关、每轮间隔（默认 5 分钟）、对小码的并发（默认 2） |
| `XIAOMARK_WEBHOOK_TOKEN` | 否 | 小码后台设置的签名 token；留空则不开 webhook 接口 |
| `WEBHOOK_RELAY_URL` | 否 | 收到的事件转发地址 |
| `ADMIN_FEISHU_OPEN_IDS` | 推荐 | 管理员飞书 open_id，逗号分隔 |
| `DEFAULT_MONTHLY_QUOTA` | 否 | 每人每月可新建条数，默认 100 |
| `QUOTA_CONTACT_NAME` | 否 | 额度用完时弹窗里的联系人，默认 Gary |
| `DB_PATH` | 否 | SQLite 路径，默认 `shorturl.db` |
| `ALLOWED_GO_HOSTS` | 否 | `/go` 额外允许的域名 |
| `FEISHU_FBIF_APP_ID` / `_SECRET` / `FEISHU_REDIRECT_BASE` | 是 | 飞书登录 |
| `FEISHU_ALLOWED_TENANT_KEYS` | 生产建议 | 租户白名单 |

## 本地开发

```bash
npm install && cp .env.example .env     # 填 XIAOMARK_API_KEY 等
npm run sync inventory-full             # 第一次：把小码账号镜像到本地（约 110 次调用，几秒）
npm run sync totals                     # 第一次：补齐全部短链的累计数据（1 万条约 10 分钟）
npm start                               # 后端 :3000，同步引擎按 tick 自动运行
cd web && npm install && npm run dev    # 前端 :5174，/api /auth /login 代理到 :3000
```

本机没有飞书回调时，用 `node scripts/dev-session.mjs --admin` 生成一个测试会话 token，放进 cookie `shorturl_session` 或请求头 `X-Session-Token`（只对本地库有效）。

## 构建与验证

```bash
npm test                                # node:test：小码客户端、迁移、同步引擎
npm run build:web                       # tsc + vite，产物 web/dist，由 Express 托管
node --check server.js lib/*.js
SESSION_TOKEN=<token> BASE_URL=http://127.0.0.1:3000 node web/scripts/ui-check.mjs   # 真实 Chrome 走查各页并截图
```

更多见 [docs/4-unit-tests/TESTING.md](docs/4-unit-tests/TESTING.md)。

## 部署

push 到 `main` 触发 GitHub Actions：CI 构建前端，产物复制到服务器，服务器拉代码、装依赖、PM2 重启、健康检查。详见 [DEPLOY.md](DEPLOY.md)。

## 安全边界

- 小码 API key 只在服务端；前端不再有自填 key 的入口。
- 核心页面与业务 API 全部要求登录；写操作按创建者 / 分组归属人 / 管理员鉴权。
- `/go` 只跳到短链域名；跳转链路解析拒绝内网地址。
- webhook 必须通过 SHA1 验签，按记录 id 去重。
- 不提交 `.env`、小码 key、飞书 secret、session token、生产数据库。
