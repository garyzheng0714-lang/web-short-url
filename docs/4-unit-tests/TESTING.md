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
| `test/visibility.test.js` | 起 Express + 假小码客户端：成员的列表（含 `scope=all`）、趋势、概览、分组汇总只有自己创建的；看别人的或无主的详情 / 统计 / 访问记录 / 修改 / 停用一律 404；成员不能认领；分组每日统计只给管理员；管理员看全部 |

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
cd web && SESSION_TOKEN=$TOKEN MEMBER_TOKEN=$MEMBER BASE_URL=http://127.0.0.1:3000 node scripts/ui-check.mjs
```

脚本用本机 Chrome 走：生成短链页（输入框与按钮同高同顶、输入组水平居中且宽 ≤ 672、标题与输入组同一中轴、按钮只写「生成」、输入组在主区视觉中心略偏上、页面只有输入框和按钮、主按钮是 Notion 蓝；站名、侧栏四项与当前项、侧栏上没有退出按钮、底部账号行有名字与身份、退出登录在账号菜单里）→ 真实生成一条短链并确认是数据页列表第一行 → 仪表盘（四张指标卡同高同顶、标题与第一张卡左缘同线、时间切换与最后一张卡右缘同线、两张排行卡并排且有数据、点排行开抽屉）→ 短链访问数据（没有指标卡与图表、列表是实色面、行等高、标题与列表左缘同线、搜索框与列表右缘同线、访问次数右缘同线）→ 点行开抽屉（地址带 `link=`、宽 ≥ 640、动作只有复制 / 二维码 / 更多、属性小表、指标名不重复时间范围、「更多」里有打开与跳转链路、Esc 关闭）→ 分组列表 → 分组抽屉 →「查看组内短链」→ 设置（每月额度是数字框）→ 390 宽（生成页与数据页无横向溢出、顶上一行入口与账号菜单）→ 有 `MEMBER_TOKEN` 时以成员身份：没有「全部 / 我的」、接口要 `scope=all` 也只回自己创建的、列表行数等于自己的短链数、拿不到分组整体数据。任一检查失败或有 console / 页面 / HTTP 报错时退出码为 1。`--no-create` 跳过建链；`--quota` 走额度弹窗（先用 `PATCH /api/users/:openId` 把测试账号额度调到已用完）。成员 token 用 `node scripts/dev-session.mjs`（不带 `--admin`）造。

看截图时逐项检查：列宽与截断、数字对齐、图表空态、悬停才出现的行尾操作、窄屏无横向溢出、深浅色（系统主题切换后再跑一次）。

## 5. 优先级

- 🔴 鉴权与越权、key 不下发、`/go` 与跳转解析的内网拦截、webhook 验签。
- 🟠 飞书两条登录链路（改 auth 才需要）。
- 🟡 建链入库并出现在列表首行；详情数据与小码后台一致（抽一条对数）；同步状态页任务全绿。
- 🟢 空态、错误态、加载态、窄屏。

## 6. 产物

- `web/.ui-check/<run>/`（gitignore）：截图。
- `docs/4-unit-tests/COVERAGE-DEBT.md`：验不到的风险路径。
