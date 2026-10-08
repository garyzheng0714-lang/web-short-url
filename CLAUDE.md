# 项目规则

## 项目定位

`web-short-url` 是仍在使用的内部短链工作台：Express 把小码团队账号的短链与统计镜像到 SQLite，React + Su Design 前端做创建、归属与效果仪表盘，飞书单应用登录。目录位于 `归档/`，但 `main` 分支有生产部署（121.40.214.5:3010，`https://shorturl.garyzheng.com`）。

## 硬边界

- 只有 `main` 一个分支，push 即部署生产；动手前本地过 `npm test`、`npm run build:web`、`web/scripts/ui-check.mjs`。
- 公开入口只有 `/api/health`、`/login`、`/auth/feishu/*`、`/go`（仅短链域名）、`/api/webhooks/xiaomark`（验签）。其余页面与 API 必须经过 `requireAuth`；管理员看全部，其他人只看、只改自己创建的短链（`canView` / `canManage` / `visibleSql`，`test/visibility.test.js` 守着），管理接口用 `requireAdmin`。
- 小码 API key 只在服务端，前端没有自填 key 的入口，不要加回去。
- 列表与统计读本地镜像，不在请求里直接打小码；要新数据改 `lib/sync.js` 的分层或 TTL。写操作先打小码成功再回写本地。
- SQLite 迁移写在 `lib/db.js` 的 `MIGRATIONS`，加版本号、保持幂等、同步搬外键。
- 前端只用 `web/src/components/ui/` 里的 `@su` 组件与语义类，不写色值、尺寸、圆角，不手改组件源码；要改视觉回 Su Design 改并重新 `shadcn add`。登录页 `public/login.html` 仍是独立静态页。
- 登录只用 `FEISHU_FBIF_APP_ID/SECRET`；富的走关联组织共享，企业归属看 `tenant_key`。session 四通道见 `docs/ARCHI.md` 第 11、12 章。
- 不提交 `.env`、`web/.env.local`、小码 key、飞书 secret、session token、生产数据库、截图目录。

## 代码地图

| 路径 | 职责 |
| --- | --- |
| `server.js` | 装配：配置、session、飞书路由、工具接口、`/go`、静态与 SPA 回退、同步启动 |
| `lib/db.js` | 打开数据库、版本化迁移、语句缓存 |
| `lib/xiaomark.js` | 小码 V2 客户端：并发、重试、熔断 |
| `lib/sync.js` | 盘点、累计分层、每日 / 多维缓存、webhook 事件、调度、状态 |
| `lib/api.js` | 全部 `/api` 业务路由与 webhook |
| `lib/feishu_auth.js` | 飞书 OAuth / SSO |
| `scripts/sync.mjs`、`scripts/dev-session.mjs` | 同步运维、本地测试会话 |
| `test/` | `node:test` |
| `web/src/pages`、`web/src/components`、`web/src/lib` | 前端页面、业务组件、API 与会话 |
| `web/scripts/ui-check.mjs` | 真实 Chrome 走查 |
| `docs/ARCHI.md`、`DEPLOY.md`、`docs/4-unit-tests/TESTING.md` | 现行架构、部署、验证 |

## 命令

```bash
npm install && npm test
npm run sync inventory-full && npm run sync totals
npm start                      # 或 SYNC_ENABLED=false npm start
cd web && npm install && npm run dev
npm run build:web
```

## 修改同步

- 路由、环境变量、schema、同步策略、认证、部署变化必须同步 `README.md`、`docs/ARCHI.md`、`DEPLOY.md`、`.env.example`。
- 小码接口以 https://xiaomark.com/help/api 为准，`docs/xiaomark-api/` 是 2026-02-24 快照。
- 不创建完成后长期残留的计划文档。

## 当前未决

- 小码后台的 webhook 回调尚未指到本服务，实时事件为空；接入步骤见 `DEPLOY.md` 第 4 节。
- 生产租户白名单仍为空；富的共享登录未真人验收。
- API 路由没有集成测试（见 `docs/4-unit-tests/COVERAGE-DEBT.md`）。
