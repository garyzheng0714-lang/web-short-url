// 飞书 OAuth 模块 — 单应用统一登录（FBIF App，富的员工经关联组织共享走同一个 App）
//
// 路由（5 条）：
//   GET  /auth/feishu/fbif/login         按钮模式
//   GET  /auth/feishu/fbif/callback      按钮模式回调（v2 token）
//   GET  /auth/feishu/fbif/sso-config    飞书 webview 免登配置（返回 appID）
//   POST /auth/feishu/fbif/sso-exchange  飞书 webview 免登 code 交换（v2 token，不带 redirect_uri）
//   POST /auth/feishu/logout             退出登录
//
// 路径里的 `fbif` 段保留不动（与生产 feed.foodtalks.cn 一致）。富的员工也走这几条 fbif 路由：
// 关联组织共享后，同一个 App 就能认出两家企业的账号，靠 user_info 返回的 tenant_key 区分身份。
//
// 环境变量：
//   FEISHU_FBIF_APP_ID / FEISHU_FBIF_APP_SECRET    登录 App
//   FEISHU_REDIRECT_BASE                            部署 URL（不带路径）
//   FEISHU_ALLOWED_TENANT_KEYS                      逗号分隔 tenant_key 白名单（可选）
//     ⚠️ 单应用下 FBIF 和富的是两个不同 tenant_key，要开白名单必须两个都填，只填一个会把另一家全拦掉。
//
// 与 server.js 的接口：
//   createFeishuRouter({ onLogin, onLogout })
//     onLogin(user, tenant) 返回 { sessionToken, expiresAt }
//     onLogout(token) 删除 session

import express from "express";
import crypto from "crypto";

const AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const TOKEN_V2_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const APP_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal";
const TOKEN_V1_URL = "https://open.feishu.cn/open-apis/authen/v1/access_token";
const USER_INFO_URL = "https://open.feishu.cn/open-apis/authen/v1/user_info";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const ALL_TENANTS = ["fbif"];

function tenantConfig(tenant) {
  if (tenant === "fbif") {
    return {
      appId: (process.env.FEISHU_FBIF_APP_ID || "").trim(),
      appSecret: (process.env.FEISHU_FBIF_APP_SECRET || "").trim(),
    };
  }
  throw new Error(`unknown tenant: ${tenant}`);
}

function tenantReady(tenant) {
  const { appId, appSecret } = tenantConfig(tenant);
  return Boolean(appId && appSecret);
}

function redirectBase() {
  const v = (process.env.FEISHU_REDIRECT_BASE || "").trim();
  if (!v) throw new Error("FEISHU_REDIRECT_BASE not set");
  return v.replace(/\/+$/, "");
}

function callbackUri(tenant) {
  return `${redirectBase()}/auth/feishu/${tenant}/callback`;
}

function stateCookieName(tenant, mode) {
  return `feishu_state_${tenant}_${mode}`;
}

function isAllowedTenant(tenantKey) {
  const allowed = (process.env.FEISHU_ALLOWED_TENANT_KEYS || "").trim();
  if (!allowed) return true;
  return allowed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(tenantKey);
}

// ===== 签名 state（HMAC，cookie 不可用时的兜底） =====

let cachedSigningSecret = null;
function signingSecret() {
  if (cachedSigningSecret) return cachedSigningSecret;
  const fbif = (process.env.FEISHU_FBIF_APP_SECRET || "").trim();
  cachedSigningSecret = crypto
    .createHash("sha256")
    .update(`${fbif}|shorturl-state-v1`)
    .digest();
  return cachedSigningSecret;
}

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function signState({ tenant, mode }) {
  const payload = {
    t: tenant,
    m: mode,
    n: crypto.randomBytes(12).toString("hex"),
    iat: Date.now(),
    exp: Date.now() + STATE_TTL_MS,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = b64urlEncode(crypto.createHmac("sha256", signingSecret()).update(body).digest());
  return `${body}.${sig}`;
}

function verifyState(state, { tenant, mode }) {
  if (typeof state !== "string" || !state.includes(".")) return null;
  const [body, sig] = state.split(".", 2);
  if (!body || !sig) return null;
  const expected = b64urlEncode(crypto.createHmac("sha256", signingSecret()).update(body).digest());
  // timing-safe compare
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (payload.t !== tenant || payload.m !== mode) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ===== state cookie 辅助 =====

function setStateCookie(req, res, name, value) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: req.secure,
    sameSite: "lax",
    path: "/auth/feishu",
    maxAge: STATE_TTL_MS,
  });
}

function clearStateCookie(res, name) {
  res.clearCookie(name, { path: "/auth/feishu" });
}

// state 校验：必须签名通过；cookie 是附加校验（缺失时允许，飞书内嵌 / 客户机 cookie 经常丢）
function checkState(req, res, tenant, mode) {
  const queryState = req.query.state;
  const payload = verifyState(queryState, { tenant, mode });
  const cookieName = stateCookieName(tenant, mode);
  const cookieValue = req.cookies?.[cookieName];
  clearStateCookie(res, cookieName);

  if (!payload) {
    return {
      ok: false,
      reason: "signed state invalid/expired",
    };
  }
  if (cookieValue && cookieValue !== queryState) {
    // 有 cookie 但和 state 不一致 → 这是真攻击
    return { ok: false, reason: "state cookie mismatch" };
  }
  // 没有 cookie 也允许：嵌入式环境/隐私浏览器常态。签名已经保护身份。
  return { ok: true };
}

// ===== token 兑换 =====

// 用 v2 token 接口换 user_access_token。
// OAuth flow（按钮跳转）必须带 redirect_uri；SSO flow（飞书 webview 内 tt.requestAccess）的 code 没有 redirect_uri，
// 传了反而会被飞书拒绝，所以由调用方决定要不要带。
async function exchangeCodeV2(tenant, code, { withRedirectUri = true } = {}) {
  const { appId, appSecret } = tenantConfig(tenant);
  const body = {
    grant_type: "authorization_code",
    client_id: appId,
    client_secret: appSecret,
    code,
  };
  if (withRedirectUri) body.redirect_uri = callbackUri(tenant);
  const resp = await fetch(TOKEN_V2_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (typeof data.code === "number" && data.code !== 0) {
    throw new Error(`v2 token api code=${data.code} ${data.error_description || data.msg || ""}`);
  }
  const flat = data.data && typeof data.data === "object" ? data.data : data;
  const token = flat.access_token;
  if (!token) throw new Error("v2 token api no access_token");
  return token;
}

async function getAppAccessToken(tenant) {
  const { appId, appSecret } = tenantConfig(tenant);
  const resp = await fetch(APP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json();
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`app_token api code=${data.code} msg=${data.msg || ""}`);
  }
  return data.app_access_token;
}

async function exchangeCodeV1(code, appAccessToken) {
  const resp = await fetch(TOKEN_V1_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const data = await resp.json();
  if (data.code !== 0 || !data.data?.access_token) {
    throw new Error(`v1 token api code=${data.code} msg=${data.msg || ""}`);
  }
  return data.data.access_token;
}

async function fetchUserInfo(userAccessToken) {
  const resp = await fetch(USER_INFO_URL, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`user_info api code=${data.code} msg=${data.msg || ""}`);
  }
  const flat = data.data && typeof data.data === "object" ? data.data : data;
  if (!flat.open_id) throw new Error("user_info no open_id");
  return flat;
}

// ===== 路由工厂 =====

export function createFeishuRouter({ onLogin, onLogout }) {
  const router = express.Router();

  for (const tenant of ALL_TENANTS) {
    router.get(`/auth/feishu/${tenant}/login`, (req, res) => handleLogin(req, res, tenant));
    router.get(`/auth/feishu/${tenant}/callback`, (req, res) =>
      handleCallback(req, res, tenant, onLogin)
    );
    router.get(`/auth/feishu/${tenant}/sso-config`, (req, res) => handleSsoConfig(req, res, tenant));
    router.post(`/auth/feishu/${tenant}/sso-exchange`, (req, res) =>
      handleSsoExchange(req, res, tenant, onLogin)
    );
  }

  router.post("/auth/feishu/logout", (req, res) => {
    if (onLogout) {
      for (const token of sessionTokenCandidates(req)) {
        onLogout(token);
      }
    }
    res.clearCookie("shorturl_session", {
      httpOnly: true,
      secure: req.secure,
      sameSite: "lax",
      path: "/",
    });
    res.json({ ok: true });
  });

  return router;
}

function sessionTokenCandidates(req) {
  const tokens = [];
  const add = (value) => {
    if (typeof value !== "string") return;
    const token = value.trim();
    if (token && !tokens.includes(token)) tokens.push(token);
  };
  add(req.cookies?.shorturl_session);
  add(req.headers["x-session-token"]);
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    add(auth.slice(7));
  }
  add(req.query?.session_token);
  return tokens;
}

function handleLogin(req, res, tenant) {
  try {
    const { appId } = tenantConfig(tenant);
    if (!tenantReady(tenant)) {
      console.error(`[feishu] tenant ${tenant} app credentials missing`);
      return res.redirect("/login?error=config");
    }
    const state = signState({ tenant, mode: "oauth" });
    setStateCookie(req, res, stateCookieName(tenant, "oauth"), state);
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: callbackUri(tenant),
      response_type: "code",
      state,
    });
    res.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
  } catch (err) {
    console.error(`[feishu] login ${tenant} failed:`, err.message);
    res.redirect("/login?error=config");
  }
}

async function handleCallback(req, res, tenant, onLogin) {
  const check = checkState(req, res, tenant, "oauth");
  if (!check.ok) {
    console.warn(`[feishu] state check failed ${tenant}/oauth: ${check.reason}`);
    return res.redirect("/login?error=state");
  }
  if (req.query.error) {
    console.log(`[feishu] denied ${tenant}/oauth:`, req.query.error, req.query.error_description);
    return res.redirect("/login?error=denied");
  }
  const code = req.query.code;
  if (!code) return res.redirect("/login?error=no_code");

  try {
    const token = await exchangeCodeV2(tenant, String(code));
    await finishLogin(req, res, tenant, token, onLogin);
  } catch (err) {
    console.error(`[feishu] callback ${tenant} failed:`, err.message);
    res.redirect("/login?error=token");
  }
}

// ===== SSO（飞书 webview 内 tt.requestAccess 免登）=====

// 前端在飞书 webview 里调 tt.requestAccess 前需要知道 appID。
// 这个接口只暴露 appID，绝不暴露 appSecret。
function handleSsoConfig(req, res, tenant) {
  try {
    const { appId } = tenantConfig(tenant);
    if (!tenantReady(tenant)) return res.status(500).json({ error: "config" });
    res.set("Cache-Control", "no-store").json({ appID: appId });
  } catch (err) {
    console.error(`[feishu] sso-config ${tenant} failed:`, err.message);
    res.status(500).json({ error: "config" });
  }
}

// 前端拿 tt.requestAccess 给的临时 code 来换 session。
// SSO code 没有 redirect_uri 概念，调 v2 token 时必须不带 redirect_uri。
async function handleSsoExchange(req, res, tenant, onLogin) {
  const code = req.body?.code;
  if (typeof code !== "string" || !code) {
    return res.status(400).json({ error: "missing code" });
  }
  const method = req.body?.method === "requestAuthCode" ? "requestAuthCode" : "requestAccess";
  try {
    const token =
      method === "requestAuthCode"
        ? await exchangeCodeV1(code, await getAppAccessToken(tenant))
        : await exchangeCodeV2(tenant, code, { withRedirectUri: false });
    const user = await fetchUserInfo(token);
    console.log(
      `[feishu] sso login ok via ${tenant} tenant_key=${user.tenant_key} open_id=${user.open_id} name=${user.name}`
    );
    if (!isAllowedTenant(user.tenant_key)) {
      console.warn(`[feishu] tenant ${user.tenant_key} not in FEISHU_ALLOWED_TENANT_KEYS`);
      return res.status(403).json({ error: "unauthorized_tenant" });
    }

    const { sessionToken, expiresAt } = await onLogin(user, tenant);

    // 同时下发 cookie（普通环境可用）+ 把 token 返给前端写 sessionStorage（飞书 webview cookie 兜底）
    res.cookie("shorturl_session", sessionToken, {
      httpOnly: true,
      secure: req.secure,
      sameSite: "lax",
      expires: new Date(expiresAt),
      path: "/",
    });
    res.json({ sessionToken, expiresAt });
  } catch (err) {
    console.error(`[feishu] sso-exchange ${tenant} failed:`, err.message);
    res.status(502).json({ error: "exchange_failed" });
  }
}

async function finishLogin(req, res, tenant, userAccessToken, onLogin) {
  const user = await fetchUserInfo(userAccessToken);
  console.log(
    `[feishu] login ok via ${tenant} tenant_key=${user.tenant_key} open_id=${user.open_id} name=${user.name}`
  );
  if (!isAllowedTenant(user.tenant_key)) {
    console.warn(`[feishu] tenant ${user.tenant_key} not in FEISHU_ALLOWED_TENANT_KEYS`);
    return res.redirect("/login?error=unauthorized_tenant");
  }

  const { sessionToken, expiresAt } = await onLogin(user, tenant);

  // 1. 标准 HttpOnly session cookie
  res.cookie("shorturl_session", sessionToken, {
    httpOnly: true,
    secure: req.secure,
    sameSite: "lax",
    expires: new Date(expiresAt),
    path: "/",
  });

  // 2. URL hash 兜底（飞书内嵌 / 客户电脑 cookie 丢失时仍可登录）
  //    前端启动时立刻消费 hash 并清理地址栏。
  res.redirect(`/#session_token=${encodeURIComponent(sessionToken)}`);
}
