# 部署到自己的服务器（Node.js + PM2 + Nginx）

下面是最常见的部署方式，适合你把这个工具放到自己的云服务器上长期运行。

## 1. 服务器准备

- 安装 Node.js 18+（建议 20 LTS）
- 安装 Git
- 安装 PM2（进程守护）
- 安装 Nginx（反向代理 + HTTPS）

示例（Ubuntu）：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx
sudo npm i -g pm2
```

## 2. 拉取代码并安装依赖

```bash
git clone https://github.com/garyzheng0714-lang/web-short-url.git
cd web-short-url
npm ci
```

如果你是首次部署且仓库还没推代码，也可以先 `git clone` 后再 `git pull` 你的分支。

## 3. 配置环境变量（关键）

不要把敏感配置写进前端代码或提交到仓库。

创建 `.env`（或直接在 PM2 配置里写 `env`）：

```bash
cp .env.example .env
```

至少配置这些：

- `XIAOMARK_API_KEY`：你的小码 API Key（你发给我的那个值建议只放服务器，不进仓库）
- `DEFAULT_WEBHOOK_CALLBACK_URL`：你希望前端“更多选项”默认显示的 webhook 推送地址
- `PORT`：默认 `3000`
- `FEISHU_FBIF_APP_ID` / `FEISHU_FBIF_APP_SECRET`：FBIF 飞书自建应用
- `FEISHU_FUDE_APP_ID` / `FEISHU_FUDE_APP_SECRET`：富的飞书自建应用
- `FEISHU_REDIRECT_BASE`：公网根地址，例如 `https://shorturl.garyzheng.com`

说明：

- 小码 Webhook 的“签名验证 token”是配置在小码后台 API 设置里的，这个项目当前不会接收 webhook，也不会用到 token。
- 前端里的 “Webhook 推送地址（展示/记录用）” 字段不会提交到创建短链接口，只是便于你部署时核对配置。
- 飞书 App Secret 只能放服务器环境变量或服务器 `.env`，不要写进前端代码，也不要提交到仓库。

飞书后台要配置两个自建网页应用：

| 租户 | 网页应用首页 URL |
| --- | --- |
| FBIF | `https://shorturl.garyzheng.com/login?tenant=fbif` |
| 富的 | `https://shorturl.garyzheng.com/login?tenant=fude` |

安全设置里的重定向 URL：

| 应用 | 重定向 URL |
| --- | --- |
| FBIF | `https://shorturl.garyzheng.com/login` |
| FBIF | `https://shorturl.garyzheng.com/auth/feishu/fbif/callback` |
| FBIF | `https://shorturl.garyzheng.com/auth/feishu/fbif/qr-callback` |
| 富的 | `https://shorturl.garyzheng.com/login` |
| 富的 | `https://shorturl.garyzheng.com/auth/feishu/fude/callback` |
| 富的 | `https://shorturl.garyzheng.com/auth/feishu/fude/qr-callback` |

两个应用都要发布到对应企业，并把可用范围设为允许使用该工具的人。飞书客户端内打开首页 URL 会走免登；普通浏览器打开时仍可用按钮或扫码登录。

## 4. PM2 启动

方式 A：直接带环境变量启动（简单）

```bash
export XIAOMARK_API_KEY='你的apikey'
export DEFAULT_WEBHOOK_CALLBACK_URL='你的webhook回调地址'
pm2 start ecosystem.config.cjs --env production
```

方式 B：在 `ecosystem.config.cjs` 的 `env` 中写变量，然后启动：

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

查看日志：

```bash
pm2 logs web-short-url
```

## 5. Nginx 反向代理

示例站点配置（HTTP）：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

启用并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. HTTPS（建议）

使用 Certbot：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 7. 更新发布

```bash
cd /path/to/web-short-url
git pull
npm ci
pm2 restart web-short-url
```

## 8. 运行检查

- 页面：`https://your-domain.com`
- 健康检查：`https://your-domain.com/api/health`
