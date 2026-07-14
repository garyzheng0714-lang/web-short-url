# 覆盖债台账（Coverage Debt）

验不到 / 暂时没验的风险路径，一行一条。**给这条路径补上有意义的验证时，就在同一次改动里删掉它的行。**

格式：`路径 | 为什么难验 | 打算怎么解决`

---

## 当前欠账

| 路径 | 为什么难验 | 打算怎么解决 |
|---|---|---|
| `server.js` 全部纯函数（`parseHttpUrl` / `cleanOptionalString` / `asBoolean` / `hashApiKey` / `cacheGet`） | **一个都没 export**，外部拿不到，没法单测 | 抽到 `lib/utils.js` 并 export，用 `node:test` 测。需先写规划文档（这是动生产代码的重构） |
| `lib/feishu_auth.js` 的 `signState` / `verifyState` | 没 export。这是 HMAC 防 CSRF 的核心，**最值得测却最测不到** | 同上：export 后用 `node:test` 测「过期 / 篡改签名 / 换租户」三种伪造 |
| 飞书端内 SSO 免登（`tt.requestAccess`） | 只能在**真实飞书客户端**里跑，没法自动化 | 保持人工验证。改 cookie / session 逻辑时**强制**走一遍——这是唯一会暴露"cookie 丢失"的场景 |
| 扫码登录（v1 token 链路） | 要真手机扫码 | 保持人工验证 |
| 上游小码 API 失败分支（超时 / 非 JSON / code≠0） | 要么等真超时，要么造假上游 | 可用本地假服务器 + 改 `XIAOMARK_API_BASE` 模拟。目前靠断网人工验 |
| DB 迁移逻辑（`migrateLegacyUserIds`） | 需要造一个「老 schema + 老数据」的库来验幂等 | 可复制一份 `shorturl.db` 手工造老数据验。**改迁移逻辑前必须做这一步**——不幂等 = 每次启动都搞坏数据 |

---

## 底线（不可欠账的部分）

覆盖债可以欠**深度**，**绝不能欠安全关键行为**。下面这些**每次碰到都必须真实验证**，不许记账拖延：

- 鉴权（未登录 → 401 / 303）
- 越权（拿 A 的 token 动 B 的数据）
- API key 不泄漏到前端
- 删除 / 持久化行为
- 外部请求的形状（发给小码/飞书的 payload）

**绝不藏未验证的代码**：不加 ignore 注释、不改配置排除、不降门槛。
