# 验证指南（Testing Guidelines）

## 先说实话：本项目没有自动化测试

- ❌ 没有单元测试框架
- ❌ 没有 lint
- ❌ 没有 typecheck
- ❌ `package.json` 的 `scripts` 里只有 `start` 和 `dev`

**这不是"待补充"的委婉说法，就是现状。** 本文件不假装有测试可跑——它讲的是**怎么在真实运行环境里把改动验明白**。

铁律：
> `语法检查通过` ≠ 完成。`服务起来了` ≠ 完成。
> **只有在真实浏览器 / 真实接口上验过，才算完成。绝不让用户代测。**

---

## 测试框架

**无。** 验证靠三样东西：

| 工具 | 干什么 | 痕迹在哪 |
|---|---|---|
| `node --check` | 语法检查 | — |
| `curl` | 接口验活 | — |
| **Playwright MCP**（或 Chrome MCP） | 真实浏览器 UI 验证 | `screenshots/`、`.playwright-mcp/`（都已 gitignore） |

生产还有一道：GitHub Actions 部署后 `curl -sf /api/health`，失败即 `exit 1`。

---

## 怎么跑

### 1. 语法检查

```bash
node --check server.js
node --check lib/feishu_auth.js
node --check public/app.js
```

改了哪个查哪个。**`index.html` / `login.html` 里的内联脚本没法 `--check`**——只能靠浏览器 console 验。

### 2. 起服务（先查端口）

```bash
lsof -ti :3000        # 有输出 = 被占用 → 换端口，绝不硬抢
PORT=3000 npm start   # 或 npm run dev（改完自动重启）
```

**启动日志就是自检**，这三行要看：
- `XIAOMARK_API_KEY loaded from environment` — 没有 = 小码 key 没配
- `Feishu OAuth: FBIF=ready 富的=ready` — 有 `MISSING` = 租户凭证没配
- `⚠️ FEISHU_REDIRECT_BASE not set` — 出现 = OAuth 回调会挂

### 3. 接口验活

**每次都要跑的基线三条：**

```bash
# ① 健康检查（部署脚本也靠它）
curl -sf http://127.0.0.1:3000/api/health | jq

# ② 鉴权没坏：未登录访问受保护接口 → 必须 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/config

# ③ 页面守卫没坏：未登录访问首页 → 必须 303 跳 /login
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://127.0.0.1:3000/
```

**带登录态测：** session token 从浏览器 DevTools → Application → sessionStorage 拿，或从登录回跳 URL 的 `#session_token=` 里抠。

```bash
TOKEN="<粘贴>"
curl -s http://127.0.0.1:3000/api/me -H "X-Session-Token: $TOKEN" | jq
```

### 4. 真实浏览器（碰了 `public/` 就必做）

核心：**登录真实页面 → 全页截图 → 主动扫全局问题（不只看用户报的那一处）→ 一次性修完**。

扫描清单（每条都要主动看，别等人报）：

- **布局**：列宽是否对齐、内容是否溢出列/页、文字是否断行不当
- **元素**：图标是否居中、大小是否合适、按钮之间有没有呼吸空间
- **状态**：hover 态、空状态、错误状态、加载态
- **响应式**：窄屏下会不会挤爆

铁律：**「CSS 下发成功」≠ 完成。「服务起来了」≠ 完成。只有真实浏览器上眼睛看过没问题，才算完成。**

---

## 测试文件在哪

**没有 `test/` 目录，没有 `*.test.js`。**

验证的产物是：
- `screenshots/` — UI 验证截图（gitignore）
- `.playwright-mcp/` — 页面快照 + console 日志（gitignore）
- `docs/4-unit-tests/COVERAGE-DEBT.md` — 验不到的风险路径台账（进 git）

---

## 验证优先级

按危险程度排——**从上往下必须都过**：

### 🔴 安全与鉴权（改坏 = 生产事故）
- 未登录访问受保护接口 → 401
- 未登录访问页面 → 303 跳 `/login`
- API key 没泄漏到前端（看 Network 响应体，搜 `apikey`）
- 越权：拿 A 的 token 删 B 的历史 id → 删不掉
- `/go?url=` 试 `javascript:` / `file://` → 400

### 🟠 登录链路（改坏 = 全员登不进）
- 4 条 token 通道：cookie / `X-Session-Token` / `Authorization: Bearer` / `?session_token=`
- 3 条链路 × 2 租户：端内 SSO 免登 / OAuth 按钮 / 扫码 × fbif / fude
- session 滑动续期

**改了 cookie 逻辑必须验飞书端内**——那是唯一暴露"cookie 会丢"的场景。

### 🟡 核心业务流
- 建短链 → 成功 → **历史里出现了这条**
- 二维码 / 跳转解析
- 建分组 → **新分组立刻可见**（缓存主动失效）

### 🟢 UI 与边界
- 空 / 错误 / 加载中状态
- 移动端窄视口
- 上游超时（断网模拟）→ 前端要有像样的报错，不能白屏

---

## 未来若要上单元测试

**现在上不了**：`server.js` 里那些本该好测的纯函数（`parseHttpUrl` / `cleanOptionalString` / `asBoolean` / `hashApiKey` / `cacheGet`）**一个都没 export**；`lib/feishu_auth.js` 也只 export 了 `createFeishuRouter`。

要上的话，零新依赖的路子：

1. 纯函数抽到 `lib/utils.js` 并 export（`server.js` 改成 import）
2. `lib/feishu_auth.js` 额外 export `signState` / `verifyState`
3. 用 **Node 内置 `node:test`**（不用装 jest / vitest）：`package.json` 加 `"test": "node --test"`
4. 优先测这四个：
   - `parseHttpUrl` — `javascript:` / `file://` / 空串 → 都该返 null
   - `verifyState` — 过期的 / 篡改签名的 / 换租户的 → 都该返 null
   - `cacheGet` — TTL 过期后返 null 并删条目
   - `localUserId` — 租户命名空间拼接

⚠️ **这是一次真实重构（要动 `server.js`），必须先写规划文档再动手。** 别在做别的功能时顺手改——那违反"外科手术式修改"。

---

## 覆盖要求

**未定义**（没有覆盖率工具，也没有阈值）。

取而代之的底线：**碰到鉴权、删除、持久化、外部请求形状的行为，至少要有一次人工真实验证**。
验不到的写进 `COVERAGE-DEBT.md`——**覆盖债可以欠深度，绝不能欠安全关键行为**。
