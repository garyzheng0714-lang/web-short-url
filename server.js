import "dotenv/config";
import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import Database from "better-sqlite3";
import path from "path";
import QRCode from "qrcode";
import { fileURLToPath } from "url";
import { createFeishuRouter } from "./lib/feishu_auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Database Setup =====
const db = new Database(path.join(__dirname, "shorturl.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    open_id    TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    open_id    TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (open_id) REFERENCES users(open_id)
  );

  CREATE TABLE IF NOT EXISTS link_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    open_id     TEXT NOT NULL,
    link_url    TEXT NOT NULL,
    target_url  TEXT NOT NULL,
    name        TEXT DEFAULT '',
    domain      TEXT DEFAULT '',
    group_id    TEXT DEFAULT '',
    group_name  TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (open_id) REFERENCES users(open_id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_open_id ON sessions(open_id);
  CREATE INDEX IF NOT EXISTS idx_link_history_open_id ON link_history(open_id);
`);

// Schema migration: 双租户字段（兼容老库）
const existingUserCols = new Set(db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name));
for (const [col, type] of [
  ["tenant", "TEXT DEFAULT ''"],
  ["tenant_key", "TEXT DEFAULT ''"],
  ["union_id", "TEXT DEFAULT ''"],
  ["user_id", "TEXT DEFAULT ''"],
  ["email", "TEXT DEFAULT ''"],
]) {
  if (!existingUserCols.has(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
  }
}

// Prepared statements
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (open_id, name, avatar_url, tenant, tenant_key, union_id, user_id, email)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(open_id) DO UPDATE SET
    name=excluded.name,
    avatar_url=excluded.avatar_url,
    tenant=excluded.tenant,
    tenant_key=excluded.tenant_key,
    union_id=excluded.union_id,
    user_id=excluded.user_id,
    email=excluded.email,
    updated_at=datetime('now')
`);
const stmtCreateSession = db.prepare(
  `INSERT INTO sessions (token, open_id, expires_at) VALUES (?, ?, ?)`
);
const stmtGetSession = db.prepare(
  `SELECT s.token, s.open_id, s.expires_at, u.name AS user_name, u.avatar_url, u.tenant, u.tenant_key
   FROM sessions s JOIN users u ON s.open_id = u.open_id
   WHERE s.token = ? AND s.expires_at > datetime('now')`
);
const stmtTouchSession = db.prepare(
  `UPDATE sessions SET expires_at = ? WHERE token = ?`
);
const stmtDeleteSession = db.prepare(`DELETE FROM sessions WHERE token = ?`);
const stmtDeleteExpiredSessions = db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`);
const stmtInsertHistory = db.prepare(
  `INSERT INTO link_history (open_id, link_url, target_url, name, domain, group_id, group_name) VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const stmtGetHistory = db.prepare(
  `SELECT * FROM link_history WHERE open_id = ? ORDER BY created_at DESC LIMIT 500`
);
const stmtDeleteHistoryItem = db.prepare(
  `DELETE FROM link_history WHERE id = ? AND open_id = ?`
);
const stmtClearHistory = db.prepare(
  `DELETE FROM link_history WHERE open_id = ?`
);

// 启动时清理过期 session
try {
  stmtDeleteExpiredSessions.run();
} catch (e) {
  console.warn("expired session cleanup failed:", e.message);
}

// ===== App Setup =====
const app = express();
const PORT = Number(process.env.PORT || 3000);
const XIAOMARK_API_BASE = "https://api.xiaomark.com";
const SERVER_API_KEY = process.env.XIAOMARK_API_KEY?.trim() || "";
const CACHE_TTL_MS = Number(process.env.XIAOMARK_CACHE_TTL_MS || 30_000);
const DEFAULT_WEBHOOK_CALLBACK_URL = process.env.DEFAULT_WEBHOOK_CALLBACK_URL?.trim() || "";
const DEFAULT_WEBHOOK_SCENE = process.env.DEFAULT_WEBHOOK_SCENE?.trim() || "";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天滑动续期
const SESSION_COOKIE_NAME = "shorturl_session";

const cacheStore = new Map();

// 部署在 Caddy/Nginx 反代后面，必须开 trust proxy 才能让 req.secure 正确反映 X-Forwarded-Proto
app.set("trust proxy", 1);

app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// ===== Auth Helpers =====

// session token 来源（按优先级）：cookie → X-Session-Token header → Authorization Bearer → query 兜底
// 这是为了应对飞书内嵌 / 隐私浏览器 / 客户电脑 cookie 丢失的场景
function extractSessionToken(req) {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const header = req.headers["x-session-token"];
  if (typeof header === "string" && header) return header;

  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  const q = req.query?.session_token;
  if (typeof q === "string" && q) return q;

  return "";
}

function resolveSession(req) {
  const token = extractSessionToken(req);
  if (!token) return null;
  const row = stmtGetSession.get(token);
  if (!row) return null;
  // 30 天滑动续期：每次成功解析就把 expires_at 推到 now+30d
  const newExpiry = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
  try {
    stmtTouchSession.run(newExpiry, token);
  } catch {}
  return { ...row, expires_at: newExpiry };
}

function requireAuth(req, res, next) {
  const session = resolveSession(req);
  if (!session) {
    return res.status(401).json({ code: -1, message: "未登录" });
  }
  req.session = session;
  next();
}

// ===== Feishu OAuth Router（FBIF + 富的 双租户） =====

const feishuRouter = createFeishuRouter({
  onLogin: async (user, tenant) => {
    stmtUpsertUser.run(
      user.open_id,
      user.name || "",
      user.avatar_url || null,
      tenant || "",
      user.tenant_key || "",
      user.union_id || "",
      user.user_id || "",
      user.email || ""
    );
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
    stmtCreateSession.run(sessionToken, user.open_id, expiresAt);
    return { sessionToken, expiresAt };
  },
  onLogout: (token) => {
    try {
      stmtDeleteSession.run(token);
    } catch (e) {
      console.warn("logout delete session failed:", e.message);
    }
  },
});

app.use(feishuRouter);

// ===== Identity API =====

app.get("/api/me", (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(401).json({ ok: false });
  res.json({
    ok: true,
    name: session.user_name,
    avatar_url: session.avatar_url,
    open_id: session.open_id,
    tenant: session.tenant,
    tenant_key: session.tenant_key,
  });
});

// ===== History API =====
app.get("/api/history", requireAuth, (req, res) => {
  const items = stmtGetHistory.all(req.session.open_id);
  res.json({ ok: true, items });
});

app.delete("/api/history/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "无效 ID" });
  stmtDeleteHistoryItem.run(id, req.session.open_id);
  res.json({ ok: true });
});

app.delete("/api/history", requireAuth, (req, res) => {
  stmtClearHistory.run(req.session.open_id);
  res.json({ ok: true });
});

app.post("/api/history/migrate", requireAuth, (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.json({ ok: true, migrated: 0 });
  }

  const insert = db.transaction((rows) => {
    let count = 0;
    for (const item of rows) {
      const linkUrl = (item.linkUrl || item.link_url || "").trim();
      const targetUrl = (item.targetUrl || item.target_url || "").trim();
      if (!linkUrl || !targetUrl) continue;
      stmtInsertHistory.run(
        req.session.open_id,
        linkUrl,
        targetUrl,
        (item.name || "").trim(),
        (item.domain || "").trim(),
        (item.groupId || item.group_id || "").trim(),
        (item.groupName || item.group_name || "").trim()
      );
      count++;
    }
    return count;
  });

  const migrated = insert(items.slice(0, 500));
  res.json({ ok: true, migrated });
});

// ===== Existing Helpers =====
function hashApiKey(apikey) {
  return crypto.createHash("sha1").update(apikey).digest("hex").slice(0, 8);
}

function getEffectiveApiKey(body = {}) {
  const bodyKey = typeof body.apikey === "string" ? body.apikey.trim() : "";
  return SERVER_API_KEY || bodyKey;
}

function cleanOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseHttpUrl(value) {
  const text = cleanOptionalString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function asBoolean(value, defaultValue = false) {
  return typeof value === "boolean" ? value : defaultValue;
}

function cacheGet(cacheKey) {
  const entry = cacheStore.get(cacheKey);
  if (!entry) return null;
  const isFresh = Date.now() - entry.ts < CACHE_TTL_MS;
  if (!isFresh) {
    cacheStore.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function cacheSet(cacheKey, data) {
  cacheStore.set(cacheKey, { ts: Date.now(), data });
  return data;
}

async function postXiaomark(pathname, payload, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstreamRes = await fetch(`${XIAOMARK_API_BASE}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await upstreamRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { code: -1, message: "Non-JSON response from upstream", raw: text };
    }
    return { status: upstreamRes.status || 502, ok: upstreamRes.ok, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRedirectChain(inputUrl, { timeoutMs = 12000, maxHops = 5 } = {}) {
  const steps = [];
  let currentUrl = inputUrl;

  for (let i = 0; i < maxHops; i += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "short-url-tool/1.0 (+local redirect resolver)",
        },
      });

      const locationHeader = res.headers.get("location");
      let nextLocation = "";
      if (locationHeader) {
        try {
          nextLocation = new URL(locationHeader, currentUrl).toString();
        } catch {
          nextLocation = locationHeader;
        }
      }

      steps.push({
        url: currentUrl,
        status: res.status,
        location: nextLocation || undefined,
      });

      if (res.status < 300 || res.status >= 400 || !nextLocation) {
        return {
          redirected: steps.some((step) => step.status >= 300 && step.status < 400),
          finalUrl: currentUrl,
          steps,
        };
      }

      currentUrl = nextLocation;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    redirected: true,
    finalUrl: currentUrl,
    steps,
    truncated: true,
  };
}

function sendError(res, status, message, detail) {
  return res.status(status).json({
    code: -1,
    message,
    ...(detail ? { detail } : {}),
  });
}

async function handleCachedListProxy({
  req,
  res,
  path,
  cacheKeyBase,
  buildPayload,
  timeoutMs,
}) {
  try {
    const apikey = getEffectiveApiKey(req.body);
    if (!apikey) {
      return sendError(
        res,
        400,
        "Missing apikey. Set XIAOMARK_API_KEY on server or provide apikey in the request body."
      );
    }

    const payload = buildPayload(apikey);
    const cacheKey = `${cacheKeyBase}:${hashApiKey(apikey)}:${JSON.stringify(payload)}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.json({ ...cached, _meta: { ...(cached._meta || {}), cache: "hit" } });
    }

    const upstream = await postXiaomark(path, payload, timeoutMs);
    const responseBody = {
      ...upstream.data,
      _meta: {
        cache: "miss",
        upstreamStatus: upstream.status,
      },
    };
    if (upstream.ok) {
      cacheSet(cacheKey, responseBody);
    }
    return res.status(upstream.ok ? 200 : upstream.status).json(responseBody);
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    return sendError(
      res,
      isAbort ? 504 : 500,
      isAbort ? "Upstream request timeout" : "Internal server error",
      String(error?.message || error)
    );
  }
}

// ===== API Routes =====
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    apiKeyConfigured: Boolean(SERVER_API_KEY),
    cacheTtlMs: CACHE_TTL_MS,
  });
});

app.get("/api/config", requireAuth, (_req, res) => {
  res.json({
    apiKeyConfigured: Boolean(SERVER_API_KEY),
    cacheTtlMs: CACHE_TTL_MS,
    defaults: {
      keyLength: 4,
      escapeFromWechat: false,
      advancedBotDetection: true,
      webhookEnabled: true,
      webhookCallbackUrl: DEFAULT_WEBHOOK_CALLBACK_URL,
      webhookScene: DEFAULT_WEBHOOK_SCENE,
    },
    endpoints: {
      projects: "/api/meta/projects",
      groups: "/api/meta/groups",
      createGroup: "/api/meta/groups/create",
      privateDomains: "/api/meta/private-domains",
      createLink: "/api/shortlinks/create",
      qrCode: "/api/tools/qrcode",
      resolveRedirect: "/api/tools/resolve-redirect",
      redirectProxy: "/go",
    },
  });
});

app.post("/api/meta/projects", requireAuth, async (req, res) => {
  return handleCachedListProxy({
    req,
    res,
    path: "/v2/sl/project/get_all",
    cacheKeyBase: "projects",
    buildPayload: (apikey) => ({ apikey }),
    timeoutMs: 10000,
  });
});

app.post("/api/meta/private-domains", requireAuth, async (req, res) => {
  return handleCachedListProxy({
    req,
    res,
    path: "/v2/sl/private_domain/get_all",
    cacheKeyBase: "private-domains",
    buildPayload: (apikey) => ({ apikey }),
    timeoutMs: 10000,
  });
});

app.post("/api/meta/groups", requireAuth, async (req, res) => {
  try {
    const projectId = cleanOptionalString(req.body?.project_id);
    if (!projectId) {
      return sendError(res, 400, "project_id is required.");
    }
    return handleCachedListProxy({
      req,
      res,
      path: "/v2/sl/group/batch_get",
      cacheKeyBase: "groups",
      buildPayload: (apikey) => ({
        apikey,
        project_id: projectId,
        offset: 0,
        count: 100,
      }),
      timeoutMs: 12000,
    });
  } catch (error) {
    return sendError(res, 500, "Internal server error", String(error?.message || error));
  }
});

app.post("/api/meta/groups/create", requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    const apikey = getEffectiveApiKey(body);
    const projectId = cleanOptionalString(body.project_id);
    const name = cleanOptionalString(body.name);

    if (!apikey) {
      return sendError(
        res,
        400,
        "Missing apikey. Set XIAOMARK_API_KEY on server or provide apikey in the request body."
      );
    }
    if (!projectId) return sendError(res, 400, "project_id is required.");
    if (!name) return sendError(res, 400, "name is required.");
    if (name.length > 64) return sendError(res, 400, "name length must be <= 64.");

    const upstream = await postXiaomark("/v2/sl/group/create", {
      apikey,
      project_id: projectId,
      name,
    });

    if (upstream.data?.code === 0) {
      const keyPrefix = `groups:${hashApiKey(apikey)}:`;
      for (const cacheKey of cacheStore.keys()) {
        if (cacheKey.startsWith(keyPrefix) && cacheKey.includes(projectId)) {
          cacheStore.delete(cacheKey);
        }
      }
    }

    return res.status(upstream.ok ? 200 : upstream.status).json(upstream.data);
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    return sendError(
      res,
      isAbort ? 504 : 500,
      isAbort ? "Upstream request timeout" : "Internal server error",
      String(error?.message || error)
    );
  }
});

app.post("/api/shortlinks/create", requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    const apikey = getEffectiveApiKey(body);
    const groupId = cleanOptionalString(body.group_id);
    const targetUrl = cleanOptionalString(body.target_url);

    if (!apikey) {
      return sendError(
        res,
        400,
        "Missing apikey. Set XIAOMARK_API_KEY on server or provide apikey in form."
      );
    }
    if (!groupId) return sendError(res, 400, "group_id is required.");
    if (!targetUrl) return sendError(res, 400, "target_url is required.");

    const parsedTarget = parseHttpUrl(targetUrl);
    if (!parsedTarget) {
      return sendError(res, 400, "target_url must use http:// or https://");
    }

    const rawKeyLength =
      typeof body.key_length === "number"
        ? body.key_length
        : typeof body.key_length === "string" && body.key_length.trim()
        ? Number(body.key_length)
        : undefined;

    const payload = {
      apikey,
      group_id: groupId,
      target_url: targetUrl,
      name: cleanOptionalString(body.name),
      domain: cleanOptionalString(body.domain),
      key: cleanOptionalString(body.key),
      key_length: rawKeyLength,
      escape_from_wechat: asBoolean(body.escape_from_wechat, false),
      advanced_bot_detection: asBoolean(body.advanced_bot_detection, true),
      webhook: asBoolean(body.webhook, true),
      webhook_scene: cleanOptionalString(body.webhook_scene),
    };

    if (payload.escape_from_wechat && payload.advanced_bot_detection) {
      return sendError(
        res,
        400,
        "escape_from_wechat and advanced_bot_detection cannot both be enabled (per docs)."
      );
    }

    if (
      payload.key_length !== undefined &&
      (!Number.isInteger(payload.key_length) || payload.key_length < 4 || payload.key_length > 8)
    ) {
      return sendError(res, 400, "key_length must be an integer between 4 and 8.");
    }

    if (!payload.webhook) delete payload.webhook_scene;

    for (const key of ["name", "domain", "key", "webhook_scene"]) {
      if (!payload[key]) delete payload[key];
    }
    if (payload.key_length === undefined || Number.isNaN(payload.key_length)) {
      delete payload.key_length;
    }

    delete payload.webhook_callback_url;
    delete payload.webhook_callback_token;

    const upstream = await postXiaomark("/v2/sl/link/create", payload, 15000);

    // 强制登录后，req.session 一定存在；记录到当前用户的历史
    if (upstream.data?.code === 0 && upstream.data?.data?.link_url) {
      const linkUrl = upstream.data.data.link_url;
      const groupLabel = body._group_name || "";
      stmtInsertHistory.run(
        req.session.open_id,
        linkUrl,
        targetUrl,
        cleanOptionalString(body.name) || "",
        cleanOptionalString(body.domain) || "",
        groupId,
        groupLabel
      );
    }

    return res.status(upstream.ok ? 200 : upstream.status).json(upstream.data);
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    return sendError(
      res,
      isAbort ? 504 : 500,
      isAbort ? "Upstream request timeout" : "Internal server error",
      String(error?.message || error)
    );
  }
});

app.post("/api/tools/qrcode", requireAuth, async (req, res) => {
  try {
    const text = cleanOptionalString(req.body?.text);
    if (!text) return sendError(res, 400, "text is required.");
    if (text.length > 2048) return sendError(res, 400, "text is too long (max 2048 chars).");

    const parsed = parseHttpUrl(text);
    if (!parsed) {
      return sendError(res, 400, "text must be a valid http:// or https:// URL.");
    }

    const dataUrl = await QRCode.toDataURL(parsed.toString(), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: {
        dark: "#1F2329",
        light: "#FFFFFF",
      },
    });

    return res.json({
      code: 0,
      message: "ok",
      data: {
        text: parsed.toString(),
        data_url: dataUrl,
      },
    });
  } catch (error) {
    return sendError(res, 500, "Failed to generate QR code", String(error?.message || error));
  }
});

app.post("/api/tools/resolve-redirect", requireAuth, async (req, res) => {
  try {
    const url = parseHttpUrl(req.body?.url);
    if (!url) return sendError(res, 400, "url must be a valid http:// or https:// URL.");

    const result = await resolveRedirectChain(url.toString(), {
      timeoutMs: 10_000,
      maxHops: 6,
    });

    return res.json({
      code: 0,
      message: "ok",
      data: {
        input_url: url.toString(),
        redirected: Boolean(result.redirected),
        final_url: result.finalUrl,
        steps: result.steps,
        truncated: Boolean(result.truncated),
      },
    });
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    return sendError(
      res,
      isAbort ? 504 : 500,
      isAbort ? "Redirect resolve timeout" : "Failed to resolve redirect",
      String(error?.message || error)
    );
  }
});

app.get("/go", (req, res) => {
  const url = parseHttpUrl(req.query?.url);
  if (!url) {
    return res.status(400).send("Invalid url. Expect http:// or https://");
  }
  return res.redirect(302, url.toString());
});

// HTML 不缓存，避免部署后用户拿到旧 index.html / login.html
function sendHtml(res, filename) {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "public", filename));
}

// /login 是登录页（不需要登录态）
app.get("/login", (_req, res) => sendHtml(res, "login.html"));

// 其他所有 HTML 路径：未登录 → 跳 /login；已登录 → index.html
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) return next();

  const session = resolveSession(req);
  if (!session) {
    // 用 303 防止 POST 路径误转发；带 next 让登录后回原路径
    const next = encodeURIComponent(req.originalUrl || "/");
    return res.redirect(303, `/login?next=${next}`);
  }
  return sendHtml(res, "index.html");
});

app.listen(PORT, () => {
  console.log(`short-url app running on http://localhost:${PORT}`);
  console.log(
    SERVER_API_KEY
      ? "XIAOMARK_API_KEY loaded from environment (frontend key field can be left blank)."
      : "XIAOMARK_API_KEY not set (user can provide apikey in the form)."
  );
  const fbifReady = Boolean(
    (process.env.FEISHU_FBIF_APP_ID || "").trim() &&
      (process.env.FEISHU_FBIF_APP_SECRET || "").trim()
  );
  const fudeReady = Boolean((process.env.FEISHU_FUDE_APP_SECRET || "").trim() || true); // 富的 有默认 fallback
  console.log(
    `Feishu OAuth: FBIF=${fbifReady ? "ready" : "MISSING"} 富的=${fudeReady ? "ready" : "MISSING"}`
  );
  if (!process.env.FEISHU_REDIRECT_BASE) {
    console.warn("⚠️  FEISHU_REDIRECT_BASE not set — OAuth callbacks will fail.");
  }
  if (DEFAULT_WEBHOOK_CALLBACK_URL) {
    console.log("DEFAULT_WEBHOOK_CALLBACK_URL loaded for UI defaults.");
  }
});
