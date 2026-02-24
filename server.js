import "dotenv/config";
import crypto from "crypto";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const XIAOMARK_API_BASE = "https://api.xiaomark.com";
const SERVER_API_KEY = process.env.XIAOMARK_API_KEY?.trim() || "";
const CACHE_TTL_MS = Number(process.env.XIAOMARK_CACHE_TTL_MS || 30_000);
const DEFAULT_WEBHOOK_CALLBACK_URL = process.env.DEFAULT_WEBHOOK_CALLBACK_URL?.trim() || "";
const DEFAULT_WEBHOOK_SCENE = process.env.DEFAULT_WEBHOOK_SCENE?.trim() || "";

const cacheStore = new Map();

app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

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

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    apiKeyConfigured: Boolean(SERVER_API_KEY),
    cacheTtlMs: CACHE_TTL_MS,
  });
});

app.get("/api/config", (_req, res) => {
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
    },
  });
});

app.post("/api/meta/projects", async (req, res) => {
  return handleCachedListProxy({
    req,
    res,
    path: "/v2/sl/project/get_all",
    cacheKeyBase: "projects",
    buildPayload: (apikey) => ({ apikey }),
    timeoutMs: 10000,
  });
});

app.post("/api/meta/private-domains", async (req, res) => {
  return handleCachedListProxy({
    req,
    res,
    path: "/v2/sl/private_domain/get_all",
    cacheKeyBase: "private-domains",
    buildPayload: (apikey) => ({ apikey }),
    timeoutMs: 10000,
  });
});

app.post("/api/meta/groups", async (req, res) => {
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

app.post("/api/meta/groups/create", async (req, res) => {
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

    // Invalidate groups cache for this project after a create attempt that succeeds logically.
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

app.post("/api/shortlinks/create", async (req, res) => {
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

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return sendError(
        res,
        400,
        "target_url must be a valid URL and start with http:// or https://"
      );
    }
    if (!["http:", "https:"].includes(parsedTarget.protocol)) {
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

    // UI-only fields should never be passed to Xiaomark.
    delete payload.webhook_callback_url;
    delete payload.webhook_callback_token;

    const upstream = await postXiaomark("/v2/sl/link/create", payload, 15000);
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

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`short-url app running on http://localhost:${PORT}`);
  console.log(
    SERVER_API_KEY
      ? "XIAOMARK_API_KEY loaded from environment (frontend key field can be left blank)."
      : "XIAOMARK_API_KEY not set (user can provide apikey in the form)."
  );
  if (DEFAULT_WEBHOOK_CALLBACK_URL) {
    console.log("DEFAULT_WEBHOOK_CALLBACK_URL loaded for UI defaults.");
  }
});
