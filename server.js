import "dotenv/config";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import QRCode from "qrcode";

import { openDatabase, statementCache, localUserId } from "./lib/db.js";
import { createFeishuRouter } from "./lib/feishu_auth.js";
import { createXiaomarkClient } from "./lib/xiaomark.js";
import { createSyncEngine } from "./lib/sync.js";
import { createApiRouter, ok, fail } from "./lib/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (level, msg) => (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(`[${new Date().toISOString()}] ${msg}`);

// ===== 配置 =====
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || "shorturl.db");
const SERVER_API_KEY = process.env.XIAOMARK_API_KEY?.trim() || "";
const SYNC_ENABLED = (process.env.SYNC_ENABLED || "true").toLowerCase() !== "false";
const ADMIN_FEISHU_OPEN_IDS = new Set((process.env.ADMIN_FEISHU_OPEN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));
const ALLOWED_GO_HOSTS = new Set((process.env.ALLOWED_GO_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天滑动续期
const SESSION_COOKIE_NAME = "shorturl_session";
const WEB_DIST = path.join(__dirname, "web", "dist");
const PUBLIC_DIR = path.join(__dirname, "public");

// ===== 数据库 =====
const { db, migrationsRan } = openDatabase(DB_PATH);
const q = statementCache(db);
if (migrationsRan.length) log("info", `schema migrations applied: ${migrationsRan.join(", ")}`);

// ===== 小码客户端 + 同步引擎 =====
const xm = SERVER_API_KEY
  ? createXiaomarkClient({
      apikey: SERVER_API_KEY,
      concurrency: Number(process.env.SYNC_CONCURRENCY || 2),
      log,
    })
  : null;
const sync = xm
  ? createSyncEngine({ db, q, xm, log, options: { tickMs: Number(process.env.SYNC_TICK_MS || 5 * 60_000) } })
  : null;

// ===== Session =====
const stmtGetSession = db.prepare(
  `SELECT s.token, s.open_id, s.expires_at, u.feishu_open_id, u.name AS user_name, u.avatar_url, u.tenant, u.tenant_key, u.role
   FROM sessions s JOIN users u ON s.open_id = u.open_id
   WHERE s.token = ? AND s.expires_at > datetime('now')`
);
const stmtTouchSession = db.prepare(`UPDATE sessions SET expires_at = ? WHERE token = ?`);

function extractSessionTokens(req) {
  const tokens = [];
  const add = (value) => {
    if (typeof value !== "string") return;
    const token = value.trim();
    if (token && !tokens.includes(token)) tokens.push(token);
  };
  add(req.cookies?.[SESSION_COOKIE_NAME]);
  add(req.headers["x-session-token"]);
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) add(auth.slice(7));
  add(req.query?.session_token);
  return tokens;
}

function resolveSession(req) {
  for (const token of extractSessionTokens(req)) {
    const row = stmtGetSession.get(token);
    if (!row) continue;
    const newExpiry = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
    try {
      stmtTouchSession.run(newExpiry, token);
    } catch {}
    return { ...row, expires_at: newExpiry };
  }
  return null;
}

function requireAuth(req, res, next) {
  const session = resolveSession(req);
  if (!session) return res.status(401).json({ ok: false, error: { code: "unauthorized", message: "未登录" } });
  req.session = session;
  next();
}

try {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
} catch (e) {
  log("warn", `expired session cleanup failed: ${e.message}`);
}

// ===== App =====
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

// ===== 飞书登录（单应用） =====
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (open_id, feishu_open_id, name, avatar_url, tenant, tenant_key, union_id, user_id, email, role)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(open_id) DO UPDATE SET
    feishu_open_id=excluded.feishu_open_id, name=excluded.name, avatar_url=excluded.avatar_url, tenant=excluded.tenant,
    tenant_key=excluded.tenant_key, union_id=excluded.union_id, user_id=excluded.user_id, email=excluded.email,
    role=CASE WHEN excluded.role = 'admin' THEN 'admin' ELSE users.role END,
    updated_at=datetime('now')`);
const stmtCreateSession = db.prepare(`INSERT INTO sessions (token, open_id, expires_at) VALUES (?, ?, ?)`);
const stmtDeleteSession = db.prepare(`DELETE FROM sessions WHERE token = ?`);

app.use(
  createFeishuRouter({
    onLogin: async (user, tenant) => {
      const localId = localUserId(tenant || "", user.open_id);
      const role = ADMIN_FEISHU_OPEN_IDS.has(user.open_id) ? "admin" : "member";
      stmtUpsertUser.run(localId, user.open_id, user.name || "", user.avatar_url || null, tenant || "", user.tenant_key || "", user.union_id || "", user.user_id || "", user.email || "", role);
      const sessionToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
      stmtCreateSession.run(sessionToken, localId, expiresAt);
      return { sessionToken, expiresAt };
    },
    onLogout: (token) => {
      try {
        stmtDeleteSession.run(token);
      } catch (e) {
        log("warn", `logout delete session failed: ${e.message}`);
      }
    },
  })
);

// ===== 身份与健康 =====
app.get("/api/me", (req, res) => {
  const session = resolveSession(req);
  if (!session) return req.query?.optional === "1" ? res.json({ ok: false }) : res.status(401).json({ ok: false });
  res.json({
    ok: true,
    name: session.user_name,
    avatar_url: session.avatar_url,
    open_id: session.feishu_open_id || session.open_id,
    tenant: session.tenant,
    tenant_key: session.tenant_key,
    is_admin: session.role === "admin" || ADMIN_FEISHU_OPEN_IDS.has(session.feishu_open_id),
  });
});

app.get("/api/health", (_req, res) => {
  const links = q(`SELECT COUNT(*) AS n FROM links WHERE missing_since IS NULL`).get().n;
  res.json({ ok: true, serverTime: new Date().toISOString(), apiKeyConfigured: Boolean(SERVER_API_KEY), syncEnabled: Boolean(sync) && SYNC_ENABLED, links });
});

// ===== 本地工具：二维码 / 跳转解析 / 跳转代理 =====
function parseHttpUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80")) return true;
    if (low.startsWith("::ffff:")) return isPrivateIp(low.slice(7));
  }
  return false;
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("不允许访问内网地址");
    return;
  }
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("不允许访问内网地址");
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("不允许访问内网地址");
}

async function resolveRedirectChain(inputUrl, { timeoutMs = 10_000, maxHops = 6 } = {}) {
  const steps = [];
  let currentUrl = inputUrl;
  for (let i = 0; i < maxHops; i += 1) {
    const u = new URL(currentUrl);
    await assertPublicHost(u.hostname);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "short-url-tool/1.0 (+redirect resolver)" } });
      const locationHeader = res.headers.get("location");
      let nextLocation = "";
      if (locationHeader) {
        try {
          nextLocation = new URL(locationHeader, currentUrl).toString();
        } catch {
          nextLocation = locationHeader;
        }
      }
      steps.push({ url: currentUrl, status: res.status, location: nextLocation || undefined });
      if (res.status < 300 || res.status >= 400 || !nextLocation) {
        return { redirected: steps.some((s) => s.status >= 300 && s.status < 400), finalUrl: currentUrl, steps };
      }
      currentUrl = nextLocation;
    } finally {
      clearTimeout(timeout);
    }
  }
  return { redirected: true, finalUrl: currentUrl, steps, truncated: true };
}

app.post("/api/tools/qrcode", requireAuth, async (req, res) => {
  try {
    const parsed = parseHttpUrl(req.body?.text);
    if (!parsed) return fail(res, 400, "invalid_url", "二维码内容必须是 http/https 链接");
    const dataUrl = await QRCode.toDataURL(parsed.toString(), { errorCorrectionLevel: "M", margin: 2, width: 320, color: { dark: "#050505", light: "#FFFFFF" } });
    return ok(res, { text: parsed.toString(), data_url: dataUrl });
  } catch (error) {
    log("error", `qrcode failed: ${error?.message || error}`);
    return fail(res, 500, "qrcode_failed", "二维码生成失败");
  }
});

app.post("/api/tools/resolve-redirect", requireAuth, async (req, res) => {
  const url = parseHttpUrl(req.body?.url);
  if (!url) return fail(res, 400, "invalid_url", "请输入 http/https 链接");
  try {
    const result = await resolveRedirectChain(url.toString());
    return ok(res, { input_url: url.toString(), redirected: Boolean(result.redirected), final_url: result.finalUrl, steps: result.steps, truncated: Boolean(result.truncated) });
  } catch (error) {
    const isAbort = error?.name === "AbortError";
    return fail(res, isAbort ? 504 : 400, isAbort ? "timeout" : "resolve_failed", isAbort ? "解析超时" : String(error?.message || "解析失败"));
  }
});

// /go 只允许跳到小码短链域名（自有域名 + 默认域名），不再是开放跳转
let goHostsCache = { at: 0, hosts: new Set(["sourl.cn"]) };
async function goHosts() {
  if (Date.now() - goHostsCache.at < 10 * 60_000) return goHostsCache.hosts;
  const hosts = new Set(["sourl.cn", ...ALLOWED_GO_HOSTS]);
  for (const d of q(`SELECT DISTINCT domain FROM links WHERE domain <> ''`).all()) hosts.add(String(d.domain).toLowerCase());
  if (xm) {
    try {
      for (const d of await xm.privateDomains()) hosts.add(String(d.domain).toLowerCase());
    } catch {}
  }
  goHostsCache = { at: Date.now(), hosts };
  return hosts;
}
app.get("/go", async (req, res) => {
  const url = parseHttpUrl(req.query?.url);
  if (!url) return res.status(400).type("text/plain").send("Invalid url. Expect http:// or https://");
  const hosts = await goHosts();
  if (!hosts.has(url.hostname.toLowerCase())) return res.status(400).type("text/plain").send("Only short link domains are allowed");
  return res.redirect(302, url.toString());
});

// ===== 业务 API =====
if (xm && sync) {
  app.use(
    "/api",
    createApiRouter({
      db,
      q,
      xm,
      sync,
      requireAuth,
      adminFeishuIds: ADMIN_FEISHU_OPEN_IDS,
      webhook: { token: process.env.XIAOMARK_WEBHOOK_TOKEN?.trim() || "", relayUrl: process.env.WEBHOOK_RELAY_URL?.trim() || "" },
      log,
    })
  );
} else {
  app.use("/api", (_req, res) => fail(res, 503, "not_configured", "服务端未配置 XIAOMARK_API_KEY"));
}

// ===== 静态与页面 =====
function sendHtml(res, file) {
  res.set("Cache-Control", "no-cache");
  res.sendFile(file);
}
app.get("/login", (_req, res) => sendHtml(res, path.join(PUBLIC_DIR, "login.html")));
app.use("/mascots", express.static(path.join(PUBLIC_DIR, "mascots"), { maxAge: "7d" }));
if (fs.existsSync(WEB_DIST)) {
  app.use("/assets", express.static(path.join(WEB_DIST, "assets"), { immutable: true, maxAge: "365d", fallthrough: false }));
  app.use(express.static(WEB_DIST, { index: false, maxAge: "1h" }));
}

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const session = resolveSession(req);
  if (!session) {
    const nextPath = encodeURIComponent(req.originalUrl || "/");
    return res.redirect(303, `/login?next=${nextPath}`);
  }
  const indexFile = path.join(WEB_DIST, "index.html");
  if (!fs.existsSync(indexFile)) return res.status(503).type("text/plain").send("前端尚未构建：请先在 web/ 目录执行 npm run build");
  return sendHtml(res, indexFile);
});

app.listen(PORT, () => {
  log("info", `short-url app running on http://localhost:${PORT}`);
  log("info", SERVER_API_KEY ? "XIAOMARK_API_KEY loaded." : "XIAOMARK_API_KEY not set: business API disabled.");
  const fbifReady = Boolean((process.env.FEISHU_FBIF_APP_ID || "").trim() && (process.env.FEISHU_FBIF_APP_SECRET || "").trim());
  log("info", `Feishu OAuth（单应用）: FBIF=${fbifReady ? "ready" : "MISSING"}`);
  if (!process.env.FEISHU_REDIRECT_BASE) log("warn", "FEISHU_REDIRECT_BASE not set — OAuth callbacks will fail.");
  if (!fs.existsSync(WEB_DIST)) log("warn", "web/dist not found — pages will respond 503 until the frontend is built.");
  if (sync && SYNC_ENABLED) {
    sync.start({ initialDelayMs: Number(process.env.SYNC_INITIAL_DELAY_MS || 5000) });
    log("info", `sync scheduler started (tick ${sync.options.tickMs} ms)`);
  }
});
