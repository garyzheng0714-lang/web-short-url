# 部署与生产验收

形态：Node.js + PM2 + Caddy。分支 `main`，生产地址 `https://shorturl.garyzheng.com`，服务器 121.40.214.5（SSH 别名 `aliyun-prod-real`），目录 `/opt/web-short-url`，端口 3010。

## 1. 自动部署（push main 即上线）

`.github/workflows/deploy.yml` 四步：

1. CI 用 Node 22 在 `web/` 执行 `npm ci && npm run build`。
2. ssh 到服务器 `git pull --ff-only`（HTTPS 拉公开仓库）。
3. scp `web/dist` 到服务器同路径（先清空再覆盖）。
4. ssh `npm ci --omit=dev`、`pm2 restart web-short-url --update-env`、`curl /api/health` 验活，失败打印 PM2 日志并退出非零。

没有 staging。改前先在本地跑 `npm test`、`npm run build:web` 和 `web/scripts/ui-check.mjs`。

## 2. 生产 `.env`

```dotenv
PORT=3010
XIAOMARK_API_KEY=
SYNC_ENABLED=true
ADMIN_FEISHU_OPEN_IDS=            # 管理员飞书 open_id，逗号分隔
XIAOMARK_WEBHOOK_TOKEN=           # 接 webhook 时填
WEBHOOK_RELAY_URL=                # 可选：转发到原接收方
FEISHU_FBIF_APP_ID=
FEISHU_FBIF_APP_SECRET=
FEISHU_REDIRECT_BASE=https://shorturl.garyzheng.com
FEISHU_ALLOWED_TENANT_KEYS=
```

旧变量 `XIAOMARK_CACHE_TTL_MS`、`DEFAULT_WEBHOOK_*`、`FEISHU_FUDE_*` 运行时不再读取，留着无害。

## 3. 首次上线 v0.3 后要做的事

```bash
ssh aliyun-prod-real
cd /opt/web-short-url
pm2 logs web-short-url --nostream --lines 30      # 看到 schema migrations applied: 1, 2, 3 与 sync scheduler started
node scripts/sync.mjs status                      # 盘点是否完成（启动 5 秒后首跑全量，约 10 秒）
node scripts/sync.mjs totals                      # 一次补齐 1 万条累计数据（约 10 分钟），不跑则按分层节奏约 100 分钟补完
```

## 4. 小码 webhook（可选）

1. 生成一个随机 token 写进 `.env` 的 `XIAOMARK_WEBHOOK_TOKEN`，`pm2 restart web-short-url --update-env`。
2. 小码后台「短链 > API 短链 > API 设置」：回调地址 `https://shorturl.garyzheng.com/api/webhooks/xiaomark`，签名 token 填同一个值。
3. 如果原来接的是飞书 AnyCross 触发器，把它的地址填到 `WEBHOOK_RELAY_URL`，事件会原样转发。
4. 验证：详情页「实时事件」计数增长；`/api/admin/events` 能看到记录。

## 5. 反向代理

Caddy 站点块在 `/etc/caddy/sites/garyzheng-tools.caddy`：`shorturl.garyzheng.com` 反代 `127.0.0.1:3010`，证书自动签发。服务端 `trust proxy` 已开，`X-Forwarded-Proto` 决定 cookie 的 `Secure`。

## 6. 机器可执行验收

```bash
curl -sf https://shorturl.garyzheng.com/api/health            # 200，含 links 数量
curl -s -o /dev/null -w '%{http_code}\n' https://shorturl.garyzheng.com/api/links         # 401
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://shorturl.garyzheng.com/   # 303 → /login
curl -s -o /dev/null -w '%{http_code}\n' 'https://shorturl.garyzheng.com/go?url=https://example.com/'   # 400（非短链域名）
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://shorturl.garyzheng.com/api/webhooks/xiaomark   # 未配 token 404，配了 400/403
```

## 7. 真人验收

1. 普通浏览器飞书登录 → 进入 `/`，列表有数据、生成一条测试短链到「短链测试」分组、二维码、详情图表。
2. 飞书客户端内打开 → 免登 → 同样检查。
3. 管理员账号：设置页能看到同步状态与小码额度；分组页能改归属。
4. 非管理员账号：设置页没有管理区；无法编辑别人的短链；可认领无主短链。

## 8. 回滚

- 代码：`git revert` 后 push main 触发部署，或在服务器 `git checkout <sha>` + 重新 scp 对应构建 + `pm2 restart`。
- 数据：先备份 `shorturl.db*`。v0.3 的迁移只增表、合并重复用户、导入历史，不删旧表；回到 v0.2 代码仍可运行（它只用 users / sessions / link_history）。
- 飞书后台与小码后台的配置不受 Git 控制，回滚时人工核对。
