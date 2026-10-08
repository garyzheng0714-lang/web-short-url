// 业务 API：全部读本地镜像；写操作先打小码再回写本地。
// 响应统一：{ ok: true, data } / { ok: false, error: { code, message } }

import crypto from "node:crypto";
import express from "express";
import { nowIso } from "./db.js";
import { XiaomarkError, fmtDate } from "./xiaomark.js";
import { SCENE_PREFIX, rangeFromPreset, todayCN } from "./sync.js";

const SORTS = {
  created: "l.create_time DESC, l.id DESC",
  created_asc: "l.create_time ASC, l.id ASC",
  visits: "l.visit_count DESC, l.create_time DESC",
  visitors: "l.visitor_count DESC, l.create_time DESC",
};

export function ok(res, data) {
  return res.json({ ok: true, data });
}
export function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

function cleanStr(v, max = 512) {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "";
}
function parseHttpUrl(value) {
  const text = cleanStr(value, 4096);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
function parseRange(query) {
  const preset = ["7d", "30d", "90d"].includes(query.range) ? query.range : null;
  if (preset) return rangeFromPreset(preset);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(query.start || "") ? query.start : null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(query.end || "") ? query.end : null;
  if (start && end && start <= end) {
    const days = Math.round((new Date(end) - new Date(start)) / 86_400_000) + 1;
    if (days <= 366) return { start, end, days };
  }
  return rangeFromPreset("30d");
}
function wantsBots(query) {
  return query.bot === "include";
}

export function createApiRouter({ db, q, xm, sync, requireAuth, adminFeishuIds = new Set(), webhook = {}, log = () => {} }) {
  const router = express.Router();
  const memo = new Map();
  const memoGet = async (key, ttlMs, fetcher) => {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await fetcher();
    memo.set(key, { at: Date.now(), value });
    return value;
  };

  // ---------- 权限 ----------
  const isAdmin = (session) => session.role === "admin" || adminFeishuIds.has(session.feishu_open_id);
  const requireAdmin = (req, res, next) => (isAdmin(req.session) ? next() : fail(res, 403, "forbidden", "需要管理员权限"));
  const groupOwner = (groupId) => (groupId ? q(`SELECT owner_open_id FROM xm_groups WHERE id = ?`).get(groupId)?.owner_open_id || null : null);
  const canManage = (session, link) => isAdmin(session) || link.creator_open_id === session.open_id || (link.group_id && groupOwner(link.group_id) === session.open_id);
  const scopeSql = (scope) => (scope === "mine" ? `(l.creator_open_id = @me OR l.group_id IN (SELECT id FROM xm_groups WHERE owner_open_id = @me))` : "1=1");

  // 统一错误包装：小码错误透传 code / message；其余 500 只进日志
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof XiaomarkError) {
        const status = err.status === 401 ? 502 : err.status >= 400 && err.status < 600 ? err.status : 502;
        return fail(res, status, `xiaomark_${err.code}`, err.message);
      }
      log("error", `api ${req.method} ${req.originalUrl}: ${err?.stack || err}`);
      return fail(res, 500, "internal", "服务器内部错误");
    }
  };

  const LINK_SELECT = `
    SELECT l.id, l.link_url, l.domain, l.key, l.project_id, l.group_id, g.name AS group_name, g.owner_open_id AS group_owner_open_id,
           l.name, l.target_url, l.create_time, l.escape_from_wechat, l.advanced_bot_detection, l.webhook, l.webhook_scene,
           l.suspended, l.banned, l.creator_open_id, u.name AS creator_name, u.avatar_url AS creator_avatar, l.source, l.claimed_at,
           l.visit_count, l.visitor_count, l.ip_count, l.stats_fetched_at, l.last_synced_at, l.missing_since
    FROM links l
    LEFT JOIN xm_groups g ON g.id = l.group_id
    LEFT JOIN users u ON u.open_id = l.creator_open_id`;

  const getLink = (id) => q(`${LINK_SELECT} WHERE l.id = ?`).get(id);
  const getLinkRaw = (id) => q(`SELECT * FROM links WHERE id = ?`).get(id);

  function presentLink(row, session) {
    if (!row) return null;
    const status = row.banned ? "banned" : row.suspended ? "suspended" : row.missing_since ? "missing" : "active";
    return {
      id: row.id,
      link_url: row.link_url,
      domain: row.domain,
      key: row.key,
      group_id: row.group_id,
      group_name: row.group_name || "",
      name: row.name,
      target_url: row.target_url,
      created_at: row.create_time ? new Date(row.create_time * 1000).toISOString() : null,
      flags: {
        escape_from_wechat: Boolean(row.escape_from_wechat),
        advanced_bot_detection: Boolean(row.advanced_bot_detection),
        webhook: Boolean(row.webhook),
        webhook_scene: row.webhook_scene || "",
      },
      status,
      creator: row.creator_open_id ? { open_id: row.creator_open_id, name: row.creator_name || "", avatar_url: row.creator_avatar || null } : null,
      source: row.source,
      stats: { visit_count: row.visit_count, visitor_count: row.visitor_count, ip_count: row.ip_count, fetched_at: row.stats_fetched_at },
      can_manage: session ? canManage(session, row) : false,
      is_mine: session ? row.creator_open_id === session.open_id || row.group_owner_open_id === session.open_id : false,
    };
  }

  // ---------- 启动包：当前用户 + 元数据 ----------
  router.get(
    "/bootstrap",
    requireAuth,
    wrap(async (req, res) => {
      const s = req.session;
      const settings = q(`SELECT default_domain, default_group_id, exclude_bot FROM user_settings WHERE open_id = ?`).get(s.open_id) || {
        default_domain: "",
        default_group_id: "",
        exclude_bot: 1,
      };
      const domains = await memoGet("private_domains", 10 * 60_000, () => xm.privateDomains()).catch(() => []);
      const groups = q(`SELECT g.id, g.name, g.project_id, g.total_links, g.owner_open_id, u.name AS owner_name,
                               (SELECT COUNT(*) FROM links WHERE group_id = g.id AND missing_since IS NULL) AS link_count
                        FROM xm_groups g LEFT JOIN users u ON u.open_id = g.owner_open_id
                        WHERE g.missing_since IS NULL ORDER BY g.create_time`).all();
      const projects = q(`SELECT id, name FROM xm_projects ORDER BY create_time`).all();
      const quota = await memoGet("quota", 10 * 60_000, () => xm.quota()).catch(() => null);
      const status = sync.status();
      return ok(res, {
        user: { open_id: s.open_id, feishu_open_id: s.feishu_open_id, name: s.user_name, avatar_url: s.avatar_url, tenant_key: s.tenant_key, is_admin: isAdmin(s) },
        settings: { default_domain: settings.default_domain, default_group_id: settings.default_group_id, exclude_bot: Boolean(settings.exclude_bot) },
        domains: domains.map((d) => ({ domain: d.domain, ssl: Boolean(d.ssl_enabled) })),
        default_domain_fallback: "sourl.cn",
        groups,
        projects,
        defaults: { key_length: 4, advanced_bot_detection: true, webhook: true, escape_from_wechat: false },
        quota: quota ? { link_quota: quota.link_quota } : null,
        sync: { links: status.counts, inventory_at: status.inventory_at, pending_stats: status.counts?.pending_stats || 0 },
        today: todayCN(),
      });
    })
  );

  // ---------- 短链列表 ----------
  router.get(
    "/links",
    requireAuth,
    wrap(async (req, res) => {
      const scope = req.query.scope === "mine" ? "mine" : "all";
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(5, Number(req.query.page_size) || 20));
      const sort = SORTS[req.query.sort] ? req.query.sort : "created";
      const where = [`l.missing_since IS NULL`, scopeSql(scope)];
      const params = { me: req.session.open_id };
      const group = cleanStr(req.query.group, 64);
      if (group) {
        where.push(`l.group_id = @group`);
        params.group = group;
      }
      const domain = cleanStr(req.query.domain, 128);
      if (domain) {
        where.push(`l.domain = @domain`);
        params.domain = domain;
      }
      const status = cleanStr(req.query.status, 16);
      if (status === "active") where.push(`l.suspended = 0 AND l.banned = 0`);
      else if (status === "suspended") where.push(`l.suspended = 1`);
      else if (status === "banned") where.push(`l.banned = 1`);
      const creator = cleanStr(req.query.creator, 128);
      if (creator) {
        where.push(`l.creator_open_id = @creator`);
        params.creator = creator;
      }
      const text = cleanStr(req.query.q, 200);
      if (text) {
        where.push(`(l.link_url LIKE @like ESCAPE '\\' OR l.target_url LIKE @like ESCAPE '\\' OR l.name LIKE @like ESCAPE '\\' OR l.key LIKE @like ESCAPE '\\')`);
        params.like = `%${likeEscape(text)}%`;
      }
      const whereSql = where.join(" AND ");
      const total = q(`SELECT COUNT(*) AS n FROM links l WHERE ${whereSql}`).get(params).n;
      const agg = q(`SELECT COALESCE(SUM(l.visit_count),0) AS visits, COALESCE(SUM(CASE WHEN l.visit_count > 0 THEN 1 ELSE 0 END),0) AS visited FROM links l WHERE ${whereSql}`).get(params);
      const rows = q(`${LINK_SELECT} WHERE ${whereSql} ORDER BY ${SORTS[sort]} LIMIT @limit OFFSET @offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return ok(res, {
        items: rows.map((r) => presentLink(r, req.session)),
        page,
        page_size: pageSize,
        total,
        summary: { visits: agg.visits, visited_links: agg.visited },
      });
    })
  );

  // 列表里的 7 日迷你趋势：按需补齐，最多 50 条
  router.get(
    "/links/trends",
    requireAuth,
    wrap(async (req, res) => {
      const ids = String(req.query.ids || "")
        .split(",")
        .map((s) => Number(s))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 50);
      const { start, end } = rangeFromPreset("7d");
      const out = {};
      for (const id of ids) {
        const link = getLinkRaw(id);
        if (!link) continue;
        if (link.visit_count === 0 && link.stats_fetched_at) {
          out[id] = Array(7).fill(0);
          continue;
        }
        const series = await sync.ensureLinkDaily(link, start, end, true);
        out[id] = series.map((d) => d.visit_count);
      }
      return ok(res, { start, end, trends: out });
    })
  );

  // ---------- 建链 ----------
  router.post(
    "/links",
    requireAuth,
    wrap(async (req, res) => {
      const body = req.body || {};
      const target = parseHttpUrl(body.target_url);
      if (!target) return fail(res, 400, "invalid_target", "目标链接必须以 http:// 或 https:// 开头");
      const groupId = cleanStr(body.group_id, 64);
      if (!groupId) return fail(res, 400, "group_required", "请选择分组");
      const name = cleanStr(body.name, 128);
      const domain = cleanStr(body.domain, 128);
      const key = cleanStr(body.key, 32);
      if (key && !/^[A-Za-z0-9_-]{1,32}$/.test(key)) return fail(res, 400, "invalid_key", "自定义后缀只能用字母、数字、连字符、下划线，不超过 32 位");
      let keyLength;
      if (body.key_length !== undefined && body.key_length !== "" && body.key_length !== null) {
        keyLength = Number(body.key_length);
        if (!Number.isInteger(keyLength) || keyLength < 4 || keyLength > 8) return fail(res, 400, "invalid_key_length", "随机后缀长度必须是 4 到 8 的整数");
      }
      const escapeFromWechat = body.escape_from_wechat === true;
      const botDetection = body.advanced_bot_detection !== false;
      if (escapeFromWechat && botDetection) return fail(res, 400, "flags_conflict", "微信内强制浏览器打开 与 深度过滤机器访问 不能同时开启");
      const webhookOn = body.webhook !== false;

      const created = await xm.createLink({
        group_id: groupId,
        target_url: target.toString(),
        name,
        domain,
        key,
        key_length: key ? undefined : keyLength,
        escape_from_wechat: escapeFromWechat,
        advanced_bot_detection: botDetection,
        webhook: webhookOn,
        webhook_scene: webhookOn ? `${SCENE_PREFIX}${req.session.feishu_open_id}`.slice(0, 128) : undefined,
      });
      const linkUrl = created.link_url;
      let detail = null;
      try {
        detail = await xm.link(linkUrl);
      } catch (err) {
        log("warn", `link/get after create failed for ${linkUrl}: ${err.message}`);
      }
      const row = sync.upsertLinkFromXm(
        detail || {
          url: linkUrl,
          domain: domain || new URL(linkUrl).hostname,
          create_time: Math.floor(Date.now() / 1000),
          group_id: groupId,
          name,
          target_url: target.toString(),
          escape_from_wechat: escapeFromWechat,
          advanced_bot_detection: botDetection,
          webhook: webhookOn,
          webhook_scene: webhookOn ? `${SCENE_PREFIX}${req.session.feishu_open_id}` : "",
        }
      );
      q(`UPDATE links SET creator_open_id = ?, source = 'tool', stats_fetched_at = COALESCE(stats_fetched_at, ?) WHERE id = ?`).run(req.session.open_id, nowIso(), row.id);
      q(`UPDATE xm_groups SET total_links = total_links + 1 WHERE id = ?`).run(groupId);
      return ok(res, { link: presentLink(getLink(row.id), req.session) });
    })
  );

  // ---------- 详情 ----------
  router.get(
    "/links/:id",
    requireAuth,
    wrap(async (req, res) => {
      const raw = getLinkRaw(Number(req.params.id));
      if (!raw) return fail(res, 404, "not_found", "短链不存在");
      sync.touchOpened(raw.id);
      try {
        await sync.refreshLink(raw);
      } catch (err) {
        log("warn", `refreshLink ${raw.link_url}: ${err.message}`);
      }
      return ok(res, { link: presentLink(getLink(raw.id), req.session) });
    })
  );

  router.patch(
    "/links/:id",
    requireAuth,
    wrap(async (req, res) => {
      const row = getLink(Number(req.params.id));
      if (!row) return fail(res, 404, "not_found", "短链不存在");
      if (!canManage(req.session, row)) return fail(res, 403, "forbidden", "只能修改自己或自己名下分组的短链");
      const body = req.body || {};
      const patch = { link_url: row.link_url };
      if (body.name !== undefined) patch.name = cleanStr(body.name, 128);
      if (body.target_url !== undefined) {
        const t = parseHttpUrl(body.target_url);
        if (!t) return fail(res, 400, "invalid_target", "目标链接必须以 http:// 或 https:// 开头");
        patch.target_url = t.toString();
      }
      const nextWechat = body.escape_from_wechat !== undefined ? body.escape_from_wechat === true : Boolean(row.escape_from_wechat);
      const nextBot = body.advanced_bot_detection !== undefined ? body.advanced_bot_detection === true : Boolean(row.advanced_bot_detection);
      if (nextWechat && nextBot) return fail(res, 400, "flags_conflict", "微信内强制浏览器打开 与 深度过滤机器访问 不能同时开启");
      if (body.escape_from_wechat !== undefined) patch.escape_from_wechat = nextWechat;
      if (body.advanced_bot_detection !== undefined) patch.advanced_bot_detection = nextBot;
      if (body.webhook !== undefined) {
        patch.webhook = body.webhook === true;
        if (patch.webhook) patch.webhook_scene = row.webhook_scene || `${SCENE_PREFIX}${req.session.feishu_open_id}`;
      }
      if (Object.keys(patch).length === 1) return fail(res, 400, "nothing_to_update", "没有要修改的字段");
      await xm.updateLink(patch);
      const detail = await xm.link(row.link_url);
      const updated = sync.upsertLinkFromXm(detail);
      return ok(res, { link: presentLink(getLink(updated.id), req.session) });
    })
  );

  const toggleSuspend = (suspend) =>
    wrap(async (req, res) => {
      const row = getLink(Number(req.params.id));
      if (!row) return fail(res, 404, "not_found", "短链不存在");
      if (!canManage(req.session, row)) return fail(res, 403, "forbidden", "只能操作自己或自己名下分组的短链");
      if (suspend) await xm.suspendLinks([row.link_url]);
      else await xm.resumeLinks([row.link_url]);
      q(`UPDATE links SET suspended = ?, last_synced_at = ? WHERE id = ?`).run(suspend ? 1 : 0, nowIso(), row.id);
      return ok(res, { link: presentLink(getLink(row.id), req.session) });
    });
  router.post("/links/:id/suspend", requireAuth, toggleSuspend(true));
  router.post("/links/:id/resume", requireAuth, toggleSuspend(false));

  router.post(
    "/links/:id/claim",
    requireAuth,
    wrap(async (req, res) => {
      const row = getLink(Number(req.params.id));
      if (!row) return fail(res, 404, "not_found", "短链不存在");
      const body = req.body || {};
      let target = req.session.open_id;
      if (body.open_id !== undefined) {
        if (!isAdmin(req.session)) return fail(res, 403, "forbidden", "只有管理员可以改派归属");
        target = body.open_id === null || body.open_id === "" ? null : cleanStr(body.open_id, 128);
        if (target && !q(`SELECT 1 FROM users WHERE open_id = ?`).get(target)) return fail(res, 400, "unknown_user", "目标用户不存在");
      } else if (row.creator_open_id && row.creator_open_id !== req.session.open_id && !isAdmin(req.session)) {
        return fail(res, 409, "already_owned", "这条短链已经有归属人");
      }
      q(`UPDATE links SET creator_open_id = ?, source = CASE WHEN ? IS NULL THEN 'xiaomark' ELSE 'claimed' END, claimed_at = ? WHERE id = ?`).run(target, target, target ? nowIso() : null, row.id);
      return ok(res, { link: presentLink(getLink(row.id), req.session) });
    })
  );

  // ---------- 短链统计 ----------
  router.get(
    "/links/:id/stats",
    requireAuth,
    wrap(async (req, res) => {
      const raw = getLinkRaw(Number(req.params.id));
      if (!raw) return fail(res, 404, "not_found", "短链不存在");
      const { start, end, days } = parseRange(req.query);
      const excludeBot = !wantsBots(req.query);
      const [daily, chart] = await Promise.all([sync.ensureLinkDaily(raw, start, end, excludeBot), sync.getLinkChart(raw, start, end, excludeBot)]);
      const period = daily.reduce(
        (a, d) => ({ visit_count: a.visit_count + d.visit_count, visitor_count: a.visitor_count + d.visitor_count, ip_count: a.ip_count + d.ip_count }),
        { visit_count: 0, visitor_count: 0, ip_count: 0 }
      );
      const events = q(`SELECT COUNT(*) AS n, MAX(visit_time) AS last FROM visit_events WHERE link_id = ?`).get(raw.id);
      return ok(res, {
        range: { start, end, days },
        exclude_bot: excludeBot,
        totals: { visit_count: raw.visit_count, visitor_count: raw.visitor_count, ip_count: raw.ip_count, fetched_at: raw.stats_fetched_at },
        period,
        daily,
        chart,
        realtime: { events: events.n, last_visit_at: events.last ? new Date(events.last * 1000).toISOString() : null },
      });
    })
  );

  router.get(
    "/links/:id/visits",
    requireAuth,
    wrap(async (req, res) => {
      const raw = getLinkRaw(Number(req.params.id));
      if (!raw) return fail(res, 404, "not_found", "短链不存在");
      const { start, end } = parseRange({ ...req.query, range: req.query.range || (req.query.start ? undefined : "90d") });
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(5, Number(req.query.page_size) || 20));
      const data = await xm.linkRecords(raw.link_url, { start_date: start, end_date: end, offset: (page - 1) * pageSize, count: pageSize, exclude_bot: !wantsBots(req.query) });
      return ok(res, {
        range: { start, end },
        page,
        page_size: pageSize,
        total: data.total || 0,
        items: (data.records || []).map((r) => ({
          id: r.id,
          visited_at: new Date((r.visit_time || 0) * 1000).toISOString(),
          ip: r.ip,
          referer: r.referer || "",
          target_url: r.target_url,
          z: r.z || "",
          new_visitor: Boolean(r.new_visitor),
          country: r.country || "",
          region: r.region || "",
          city: r.city || "",
          is_robot: Boolean(r.is_robot),
          browser: r.browser,
          os: r.os,
          device: r.device,
          network: r.network,
          user_agent: r.user_agent,
        })),
      });
    })
  );

  // ---------- 概览 ----------
  router.get(
    "/overview",
    requireAuth,
    wrap(async (req, res) => {
      const scope = req.query.scope === "mine" ? "mine" : "all";
      const group = cleanStr(req.query.group, 64);
      const { start, end, days } = parseRange(req.query);
      const me = req.session.open_id;
      const where = [`l.missing_since IS NULL`, scopeSql(scope)];
      const params = { me };
      if (group) {
        where.push(`l.group_id = @group`);
        params.group = group;
      }
      const whereSql = where.join(" AND ");
      const kpi = q(`SELECT COUNT(*) AS total_links,
                            COALESCE(SUM(CASE WHEN l.visit_count > 0 THEN 1 ELSE 0 END),0) AS visited_links,
                            COALESCE(SUM(l.visit_count),0) AS visits_total,
                            COALESCE(SUM(l.visitor_count),0) AS visitors_total,
                            COALESCE(SUM(CASE WHEN l.create_time >= strftime('%s','now') - 7*86400 THEN 1 ELSE 0 END),0) AS created_7d,
                            MIN(l.stats_fetched_at) AS oldest_stats_at
                     FROM links l WHERE ${whereSql}`).get(params);

      // 序列来源：分组每日数据便宜且准确；「我的」里不在自有分组的短链逐条补
      let series;
      let seriesNote = null;
      if (group) {
        series = await sync.seriesForGroups([group], start, end);
      } else if (scope === "all") {
        const groupIds = q(`SELECT id FROM xm_groups WHERE missing_since IS NULL`).all().map((g) => g.id);
        series = await sync.seriesForGroups(groupIds, start, end);
      } else {
        const ownedGroups = q(`SELECT id FROM xm_groups WHERE owner_open_id = ? AND missing_since IS NULL`).all(me).map((g) => g.id);
        const ownLinks = q(`SELECT * FROM links l WHERE l.missing_since IS NULL AND l.creator_open_id = ? AND (l.group_id IS NULL OR l.group_id NOT IN (SELECT id FROM xm_groups WHERE owner_open_id = ?))`).all(me, me);
        const [gSeries, lSeries] = await Promise.all([sync.seriesForGroups(ownedGroups, start, end), sync.seriesForLinks(ownLinks, start, end, { max: 200 })]);
        series = gSeries.map((d, i) => ({ date: d.date, visit_count: d.visit_count + lSeries.series[i].visit_count, visitor_count: d.visitor_count + lSeries.series[i].visitor_count, ip_count: d.ip_count + lSeries.series[i].ip_count }));
        if (lSeries.truncated) seriesNote = `只统计了最近 ${lSeries.counted} 条个人短链的每日数据`;
      }
      const period = series.reduce((a, d) => ({ visit_count: a.visit_count + d.visit_count, visitor_count: a.visitor_count + d.visitor_count }), { visit_count: 0, visitor_count: 0 });
      const today = todayCN();
      const todayRow = series.find((d) => d.date === today) || { visit_count: 0, visitor_count: 0 };
      const prevStart = fmtDate(new Date(new Date(`${start}T00:00:00Z`).getTime() - days * 86_400_000));
      const prevEnd = fmtDate(new Date(new Date(`${start}T00:00:00Z`).getTime() - 86_400_000));
      let previous = null;
      if (group || scope === "all") {
        const ids = group ? [group] : q(`SELECT id FROM xm_groups WHERE missing_since IS NULL`).all().map((g) => g.id);
        const prevSeries = await sync.seriesForGroups(ids, prevStart, prevEnd);
        previous = { visit_count: prevSeries.reduce((a, d) => a + d.visit_count, 0), visitor_count: prevSeries.reduce((a, d) => a + d.visitor_count, 0), start: prevStart, end: prevEnd };
      }
      const top = q(`${LINK_SELECT} WHERE ${whereSql} AND l.visit_count > 0 ORDER BY l.visit_count DESC LIMIT 10`).all(params).map((r) => presentLink(r, req.session));
      const recent = q(`${LINK_SELECT} WHERE ${whereSql} ORDER BY l.create_time DESC, l.id DESC LIMIT 8`).all(params).map((r) => presentLink(r, req.session));
      const recentEvents = q(`SELECT e.visit_time, e.link_url, e.city, e.device, e.browser, e.referer, l.id AS link_id, l.name AS link_name
                              FROM visit_events e LEFT JOIN links l ON l.id = e.link_id ORDER BY e.visit_time DESC LIMIT 10`).all();
      return ok(res, {
        scope,
        group: group || null,
        range: { start, end, days },
        kpi: { ...kpi, period_visits: period.visit_count, period_visitors: period.visitor_count, today_visits: todayRow.visit_count, today_visitors: todayRow.visitor_count },
        previous,
        series,
        series_note: seriesNote,
        top_links: top,
        recent_links: recent,
        recent_events: recentEvents.map((e) => ({ ...e, visited_at: new Date(e.visit_time * 1000).toISOString() })),
      });
    })
  );

  // ---------- 分组 ----------
  router.get(
    "/groups",
    requireAuth,
    wrap(async (req, res) => {
      const rows = q(`SELECT g.id, g.project_id, g.name, g.total_links, g.create_time, g.owner_open_id, u.name AS owner_name, u.avatar_url AS owner_avatar,
                             COALESCE(s.link_count,0) AS link_count, COALESCE(s.visited,0) AS visited_links, COALESCE(s.visits,0) AS visits, COALESCE(s.visitors,0) AS visitors,
                             s.latest_create_time
                      FROM xm_groups g
                      LEFT JOIN users u ON u.open_id = g.owner_open_id
                      LEFT JOIN (SELECT group_id, COUNT(*) AS link_count, SUM(CASE WHEN visit_count>0 THEN 1 ELSE 0 END) AS visited, SUM(visit_count) AS visits, SUM(visitor_count) AS visitors, MAX(create_time) AS latest_create_time
                                 FROM links WHERE missing_since IS NULL GROUP BY group_id) s ON s.group_id = g.id
                      WHERE g.missing_since IS NULL ORDER BY s.visits DESC NULLS LAST, g.create_time`).all();
      return ok(res, {
        items: rows.map((g) => ({
          id: g.id,
          project_id: g.project_id,
          name: g.name,
          created_at: g.create_time ? new Date(g.create_time * 1000).toISOString() : null,
          owner: g.owner_open_id ? { open_id: g.owner_open_id, name: g.owner_name || "", avatar_url: g.owner_avatar || null } : null,
          total_links: g.total_links,
          link_count: g.link_count,
          visited_links: g.visited_links,
          visits: g.visits,
          visitors: g.visitors,
          latest_created_at: g.latest_create_time ? new Date(g.latest_create_time * 1000).toISOString() : null,
          is_mine: g.owner_open_id === req.session.open_id,
        })),
      });
    })
  );

  router.post(
    "/groups",
    requireAuth,
    wrap(async (req, res) => {
      const name = cleanStr(req.body?.name, 64);
      if (!name) return fail(res, 400, "name_required", "请输入分组名称");
      let projectId = cleanStr(req.body?.project_id, 64) || q(`SELECT id FROM xm_projects ORDER BY create_time LIMIT 1`).get()?.id;
      if (!projectId) {
        const projects = await xm.projects();
        projectId = projects[0]?.id;
      }
      if (!projectId) return fail(res, 400, "no_project", "小码账号下没有项目");
      const created = await xm.createGroup(projectId, name);
      q(`INSERT INTO xm_groups (id, project_id, name, total_links, create_time, owner_open_id, synced_at) VALUES (?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, synced_at = excluded.synced_at`).run(created.group_id, projectId, name, Math.floor(Date.now() / 1000), req.session.open_id, nowIso());
      return ok(res, { group: { id: created.group_id, name, project_id: projectId, owner_open_id: req.session.open_id } });
    })
  );

  router.get(
    "/groups/:id/stats",
    requireAuth,
    wrap(async (req, res) => {
      const gid = cleanStr(req.params.id, 64);
      const g = q(`SELECT * FROM xm_groups WHERE id = ?`).get(gid);
      if (!g) return fail(res, 404, "not_found", "分组不存在");
      const { start, end, days } = parseRange(req.query);
      const excludeBot = !wantsBots(req.query);
      const [daily, chart, overall] = await Promise.all([sync.ensureGroupDaily(gid, start, end, excludeBot), sync.getGroupChart(gid, start, end, excludeBot), xm.groupOverall(gid, excludeBot)]);
      const period = daily.reduce((a, d) => ({ visit_count: a.visit_count + d.visit_count, visitor_count: a.visitor_count + d.visitor_count, ip_count: a.ip_count + d.ip_count }), { visit_count: 0, visitor_count: 0, ip_count: 0 });
      return ok(res, { group: { id: g.id, name: g.name, owner_open_id: g.owner_open_id }, range: { start, end, days }, exclude_bot: excludeBot, totals: overall, period, daily, chart });
    })
  );

  router.patch(
    "/groups/:id",
    requireAuth,
    requireAdmin,
    wrap(async (req, res) => {
      const gid = cleanStr(req.params.id, 64);
      if (!q(`SELECT 1 FROM xm_groups WHERE id = ?`).get(gid)) return fail(res, 404, "not_found", "分组不存在");
      const body = req.body || {};
      if (body.owner_open_id !== undefined) {
        const owner = body.owner_open_id ? cleanStr(body.owner_open_id, 128) : null;
        if (owner && !q(`SELECT 1 FROM users WHERE open_id = ?`).get(owner)) return fail(res, 400, "unknown_user", "目标用户不存在");
        q(`UPDATE xm_groups SET owner_open_id = ? WHERE id = ?`).run(owner, gid);
      }
      if (body.name !== undefined) {
        const name = cleanStr(body.name, 64);
        if (!name) return fail(res, 400, "name_required", "分组名称不能为空");
        await xm.updateGroup(gid, name);
        q(`UPDATE xm_groups SET name = ? WHERE id = ?`).run(name, gid);
      }
      const g = q(`SELECT g.*, u.name AS owner_name FROM xm_groups g LEFT JOIN users u ON u.open_id = g.owner_open_id WHERE g.id = ?`).get(gid);
      return ok(res, { group: { id: g.id, name: g.name, owner: g.owner_open_id ? { open_id: g.owner_open_id, name: g.owner_name || "" } : null } });
    })
  );

  // ---------- 用户与设置 ----------
  router.get(
    "/users",
    requireAuth,
    wrap(async (req, res) => {
      const rows = q(`SELECT open_id, name, avatar_url, role, tenant_key, created_at FROM users WHERE open_id LIKE '%:%' ORDER BY name`).all();
      return ok(res, {
        items: rows.map((u) => ({ open_id: u.open_id, name: u.name, avatar_url: u.avatar_url, is_admin: u.role === "admin" || adminFeishuIds.has(u.open_id.split(":").pop()), tenant_key: u.tenant_key })),
      });
    })
  );

  router.get(
    "/settings",
    requireAuth,
    wrap(async (req, res) => {
      const s = q(`SELECT default_domain, default_group_id, exclude_bot FROM user_settings WHERE open_id = ?`).get(req.session.open_id) || { default_domain: "", default_group_id: "", exclude_bot: 1 };
      return ok(res, { settings: { default_domain: s.default_domain, default_group_id: s.default_group_id, exclude_bot: Boolean(s.exclude_bot) } });
    })
  );
  router.put(
    "/settings",
    requireAuth,
    wrap(async (req, res) => {
      const body = req.body || {};
      const cur = q(`SELECT default_domain, default_group_id, exclude_bot FROM user_settings WHERE open_id = ?`).get(req.session.open_id) || { default_domain: "", default_group_id: "", exclude_bot: 1 };
      const next = {
        default_domain: body.default_domain !== undefined ? cleanStr(body.default_domain, 128) : cur.default_domain,
        default_group_id: body.default_group_id !== undefined ? cleanStr(body.default_group_id, 64) : cur.default_group_id,
        exclude_bot: body.exclude_bot !== undefined ? (body.exclude_bot ? 1 : 0) : cur.exclude_bot,
      };
      q(`INSERT INTO user_settings (open_id, default_domain, default_group_id, exclude_bot, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(open_id) DO UPDATE SET default_domain = excluded.default_domain, default_group_id = excluded.default_group_id, exclude_bot = excluded.exclude_bot, updated_at = excluded.updated_at`).run(
        req.session.open_id,
        next.default_domain,
        next.default_group_id,
        next.exclude_bot,
        nowIso()
      );
      return ok(res, { settings: { ...next, exclude_bot: Boolean(next.exclude_bot) } });
    })
  );

  // ---------- 管理 ----------
  router.get("/admin/sync", requireAuth, requireAdmin, wrap(async (req, res) => ok(res, sync.status())));
  router.post(
    "/admin/sync/run",
    requireAuth,
    requireAdmin,
    wrap(async (req, res) => {
      const job = cleanStr(req.body?.job, 32) || "inventory";
      if (job === "inventory") sync.syncInventory({ full: false });
      else if (job === "inventory_full") sync.syncInventory({ full: true });
      else if (job === "totals") sync.syncTotalsTier("initial", 500).then(() => sync.syncTotalsTier("warm", 400));
      else return fail(res, 400, "unknown_job", "未知任务");
      return ok(res, { started: job });
    })
  );
  router.get(
    "/admin/quota",
    requireAuth,
    requireAdmin,
    wrap(async (req, res) => {
      const [quota, whitelist, domains] = await Promise.all([xm.quota(), xm.whitelist(), xm.privateDomains()]);
      return ok(res, { quota, whitelist, private_domains: domains });
    })
  );
  router.get(
    "/admin/events",
    requireAuth,
    requireAdmin,
    wrap(async (req, res) => {
      const rows = q(`SELECT e.*, l.id AS lid, l.name AS link_name FROM visit_events e LEFT JOIN links l ON l.id = e.link_id ORDER BY e.visit_time DESC LIMIT 100`).all();
      return ok(res, { items: rows });
    })
  );

  // ---------- 小码 webhook（公开，验签） ----------
  router.post(
    "/webhooks/xiaomark",
    express.text({ type: "*/*", limit: "64kb" }),
    (req, res) => {
      if (!webhook.token) return res.status(404).type("text/plain").send("webhook disabled");
      let body;
      try {
        body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      } catch {
        return res.status(400).type("text/plain").send("bad json");
      }
      const { url, msgid, sign } = body || {};
      if (!url || !msgid || !sign) return res.status(400).type("text/plain").send("missing fields");
      const expected = crypto.createHash("sha1").update([webhook.token, String(url), String(msgid)].sort().join("")).digest("hex");
      if (expected !== String(sign).toLowerCase()) return res.status(403).type("text/plain").send("bad sign");
      try {
        sync.ingestVisitEvent(body, "webhook");
      } catch (err) {
        log("error", `webhook ingest failed: ${err.message}`);
      }
      res.type("text/plain").send("success");
      if (webhook.relayUrl) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        fetch(webhook.relayUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof req.body === "string" ? req.body : JSON.stringify(body), signal: controller.signal })
          .catch((err) => log("warn", `webhook relay failed: ${err.message}`))
          .finally(() => clearTimeout(t));
      }
    }
  );

  return router;
}
