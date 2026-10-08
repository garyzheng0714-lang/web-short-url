# 验证指南

铁律：**语法过了不算完成，服务起来了不算完成，只有在真实浏览器 / 真实接口上验过才算。**

## 1. 自动化

```bash
npm test                      # node:test，约 2 秒
node --check server.js lib/*.js scripts/*.mjs
npm run build:web             # tsc --noEmit + vite build
```

`npm test` 覆盖：

| 文件 | 覆盖 |
| --- | --- |
| `test/xiaomark.test.js` | 日期分段；-2 重试后成功；业务错误不重试；连续失败熔断；请求体字段裁剪；并发上限 |
| `test/db.test.js` | 全新库三版迁移且幂等；老库（裸 open_id 重复用户 + link_history）合并与导入 |
| `test/sync.test.js` | 全量盘点分页与场景值归属；增量盘点只翻末尾页；每日数据 TTL 内不重拉；90 天多维分段合并与缓存；分组序列相加；webhook 事件去重；累计数据分层 |

## 2. 起服务

```bash
lsof -ti :3000 && echo 被占用
SYNC_ENABLED=false npm start                 # 本地验证时关掉定时同步，避免和脚本抢上游
node scripts/sync.mjs inventory-full          # 需要真实数据时先镜像
TOKEN=$(node scripts/dev-session.mjs --admin) # 本地测试会话（只对本地库有效）
```

## 3. 接口基线（每次都跑）

```bash
H="X-Session-Token: $TOKEN"
curl -s localhost:3000/api/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/links                    # 401
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:3000/overview     # 303 /login
curl -s -H "$H" 'localhost:3000/api/links?page_size=3&sort=visits'
curl -s -H "$H" 'localhost:3000/api/overview?range=7d'
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:3000/go?url=https://example.com/' # 400
```

权限：用 `node scripts/dev-session.mjs`（非管理员）再造一个 token，确认 `/api/admin/sync` 403、改别人的短链 403、认领无主短链 200。

## 4. 真实浏览器（碰了 `web/` 必做）

```bash
cd web && SESSION_TOKEN=$TOKEN BASE_URL=http://127.0.0.1:3000 node scripts/ui-check.mjs
```

脚本用本机 Chrome 走：首页（量测输入框与按钮同高同顶、标题 / 状态行 / 视图切换左缘同线、按钮与搜索框右缘同线、图解在视口里播放且左缘与输入框同线）→ 真实生成一条短链并确认出现在首行 → 点行开短链抽屉（地址带 `link=`、宽 ≥ 640、Esc 关闭）→ 分组视图开分组抽屉 →「查看组内短链」回到列表筛选 → 设置 → 390 宽（无横向溢出、短链列 ≥ 160）。任一检查失败或有 console / 页面 / HTTP 报错时退出码为 1。`--no-create` 跳过建链；`--quota` 走额度弹窗（先用 `PATCH /api/users/:openId` 把测试账号额度调到已用完）。

首页图解另有逐格走查（碰了 `short-link-story.tsx` 必做）：

```bash
cd web && SESSION_TOKEN=$TOKEN BASE_URL=http://127.0.0.1:3000 node scripts/story-check.mjs [--video]
```

暂停后用 `seek` 按 30fps 定格一整圈，检查：进入视口在跑、暂停后帧循环睡下；8 处衔接两侧都有指定部件（`data-part`）可见；看得见的部件不出舞台；静止占三成以上、动静段长短差 4 倍以上；宽屏、390 窄屏、深色（挂 `data-theme="dark"`）各一轮；减少动态时不跑、停在第 4 步、点步骤换画面。产物是逐格拼图、每步定格截图、节奏 JSON，`--video` 再用本机 ffmpeg 逐帧合成一圈 MP4。

看截图时逐项检查：列宽与截断、数字对齐、图表空态、悬停才出现的行尾操作、窄屏无横向溢出、深浅色（系统主题切换后再跑一次）。

## 5. 优先级

- 🔴 鉴权与越权、key 不下发、`/go` 与跳转解析的内网拦截、webhook 验签。
- 🟠 飞书两条登录链路（改 auth 才需要）。
- 🟡 建链入库并出现在列表首行；详情数据与小码后台一致（抽一条对数）；同步状态页任务全绿。
- 🟢 空态、错误态、加载态、窄屏。

## 6. 产物

- `web/.ui-check/<run>/`（gitignore）：截图。
- `docs/4-unit-tests/COVERAGE-DEBT.md`：验不到的风险路径。
