// 飞书 OAuth 模块 — FBIF + 富的 双企业 App
//
// 路由（10 条）：
//   GET  /auth/feishu/fbif/login        FBIF 按钮模式
//   GET  /auth/feishu/fbif/callback     FBIF 按钮模式回调（v2 token）
//   GET  /auth/feishu/fbif/qr-config    FBIF 扫码模式配置
//   GET  /auth/feishu/fbif/qr-callback  FBIF 扫码模式回调（v1 token）
//   GET  /auth/feishu/fude/*            富的 同上 4 条
//   POST /auth/feishu/logout            退出登录（共享）
//
// 环境变量：
//   FEISHU_FBIF_APP_ID / FEISHU_FBIF_APP_SECRET    FBIF App
//   FEISHU_FUDE_APP_ID / FEISHU_FUDE_APP_SECRET    富的 App（默认 fallback 写在代码里）
//   FEISHU_REDIRECT_BASE                            部署 URL（不带路径）
//   FEISHU_ALLOWED_TENANT_KEYS                      逗号分隔 tenant_key 白名单（可选）
//
// 与 server.js 的接口：
//   createFeishuRouter({ onLogin, onLogout })
//     onLogin(user, tenant) 返回 { sessionToken, expiresAt }
//     onLogout(token) 删除 session

import express from "express";
import crypto from "crypto";

const FUDE_APP_ID_DEFAULT = "cli_a975bf6e72b95bc9";
const FUDE_APP_SECRET_DEFAULT = "MAXuPOlGRrvbO234gZyvObLbXBo5PKY4";

const AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const TOKEN_V2_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const QR_AUTHORIZE_URL = "https://passport.feishu.cn/suite/passport/oauth/authorize";
const APP_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal";
const TOKEN_V1_URL = "https://open.feishu.cn/open-apis/authen/v1/access_token";
const USER_INFO_URL = "https://open.feishu.cn/open-apis/authen/v1/user_info";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const ALL_TENANTS = ["fbif", "fude"];

function tenantConfig(tenant) {
  if (tenant === "fbif") {
    return {
      appId: (process.env.FEISHU_FBIF_APP_ID || "").trim(),
      appSecret: (process.env.FEISHU_FBIF_APP_SECRET || "").trim(),
    };
  }
  if (tenant === "fude") {
    return {
      appId: (process.env.FEISHU_FUDE_APP_ID || FUDE_APP_ID_DEFAULT).trim(),
      appSecret: (process.env.FEISHU_FUDE_APP_SECRET || FUDE_APP_SECRET_DEFAULT).trim(),
    };
  }
  throw new Error(`unknown tenant: ${tenant}`);
}

function redirectBase() {
  const v = (process.env.FEISHU_REDIRECT_BASE || "").trim();
  if (!v) throw new Error("FEISHU_REDIRECT_BASE not set");
  return v.replace(/\/+$/, "");
}

function callbackUri(tenant) {
  return `${redirectBase()}/auth/feishu/${tenant}/callback`;
}

function qrCallbackUri(tenant) {
  return `${redirectBase()}/auth/feishu/${tenant}/qr-callback`;
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
  const fude = (process.env.FEISHU_FUDE_APP_SECRET || FUDE_APP_SECRET_DEFAULT).trim();
  cachedSigningSecret = crypto
    .createHash("sha256")
    .update(`${fbif}|${fude}|shorturl-state-v1`)
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

async function exchangeCodeV2(tenant, code) {
  const { appId, appSecret } = tenantConfig(tenant);
  const resp = await fetch(TOKEN_V2_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: callbackUri(tenant),
    }),
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
    router.get(`/auth/feishu/${tenant}/qr-config`, (req, res) => handleQRConfig(req, res, tenant));
    router.get(`/auth/feishu/${tenant}/qr-callback`, (req, res) =>
      handleQRCallback(req, res, tenant, onLogin)
    );
  }

  router.post("/auth/feishu/logout", (req, res) => {
    const token = req.cookies?.shorturl_session;
    if (token && onLogout) onLogout(token);
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

function handleLogin(req, res, tenant) {
  try {
    const { appId } = tenantConfig(tenant);
    if (!appId) {
      console.error(`[feishu] tenant ${tenant} appId missing`);
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

function handleQRConfig(req, res, tenant) {
  try {
    const { appId } = tenantConfig(tenant);
    if (!appId) return res.status(500).json({ error: "config" });
    const state = signState({ tenant, mode: "qr" });
    setStateCookie(req, res, stateCookieName(tenant, "qr"), state);
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: qrCallbackUri(tenant),
      response_type: "code",
      state,
    });
    res.set("Cache-Control", "no-store").json({
      goto: `${QR_AUTHORIZE_URL}?${params.toString()}`,
      state,
      expires_in: 300,
    });
  } catch (err) {
    console.error(`[feishu] qr-config ${tenant} failed:`, err.message);
    res.status(500).json({ error: "config" });
  }
}

async function handleQRCallback(req, res, tenant, onLogin) {
  const check = checkState(req, res, tenant, "qr");
  if (!check.ok) {
    console.warn(`[feishu] state check failed ${tenant}/qr: ${check.reason}`);
    return res.redirect("/login?error=state");
  }
  if (req.query.error) {
    console.log(`[feishu] denied ${tenant}/qr:`, req.query.error, req.query.error_description);
    return res.redirect("/login?error=denied");
  }
  const code = req.query.code;
  if (!code) return res.redirect("/login?error=no_code");

  try {
    const appToken = await getAppAccessToken(tenant);
    const userToken = await exchangeCodeV1(String(code), appToken);
    await finishLogin(req, res, tenant, userToken, onLogin);
  } catch (err) {
    console.error(`[feishu] qr-callback ${tenant} failed:`, err.message);
    res.redirect("/login?error=token");
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
