// 同步引擎：把小码账号里的项目 / 分组 / 短链 / 统计镜像到本地 SQLite。
// 设计要点：
//   - 盘点（inventory）：全量每 24 小时一次；其余时间只看分组 total_links 变化，翻末尾页做增量。
//   - 累计数据（totals）：按热度分层刷新，每个 tick 只处理有限批量，把调用量摊到全天。
//   - 每日数据 / 多维分布：按需拉取；历史日期不可变，拉过一次就永久缓存；当天 10 分钟过期。
//   - 所有上游调用都经 lib/xiaomark.js，限流与重试在那一层。

import { nowIso } from "./db.js";
import { addDays, splitDateRange } from "./xiaomark.js";

export const SCENE_PREFIX = "shorturl:";
const DAY = 86_400;

/** 北京时间的今天（小码的统计日期按北京时间） */
export function todayCN(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function rangeFromPreset(preset, now = new Date()) {
  const end = todayCN(now);
  const days = preset === "90d" ? 90 : preset === "30d" ? 30 : 7;
  return { start: addDays(end, -(days - 1)), end, days };
}

function keyFromUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return "";
  }
}

export function createSyncEngine({ db, q, xm, log = () => {}, options = {} }) {
  const opts = {
    tickMs: 5 * 60_000,
    inventoryFullEveryMs: 24 * 3600_000,
    inventoryTailEveryMs: 6 * 3600_000,
    hotBatch: 200,
    warmBatch: 400,
    coldBatch: 150,
    initialBatch: 500,
    todayTtlMs: 10 * 60_000,
    ...options,
  };
  const running = new Set();
  let timer = null;

  // ---------- 基础 upsert ----------
  const upsertProjectStmt = () =>
    q(`INSERT INTO xm_projects (id, name, create_time, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, create_time = excluded.create_time, synced_at = excluded.synced_at`);
  const upsertGroupStmt = () =>
    q(`INSERT INTO xm_groups (id, project_id, name, total_links, create_time, synced_at, missing_since)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, name = excluded.name, total_links = excluded.total_links,
         create_time = excluded.create_time, synced_at = excluded.synced_at, missing_since = NULL`);
  const upsertLinkStmt = () =>
    q(`INSERT INTO links (link_url, domain, key, project_id, group_id, name, target_url, create_time,
         escape_from_wechat, advanced_bot_detection, webhook, webhook_scene, suspended, banned, last_synced_at, missing_since)
       VALUES (@link_url, @domain, @key, @project_id, @group_id, @name, @target_url, @create_time,
         @escape_from_wechat, @advanced_bot_detection, @webhook, @webhook_scene, @suspended, @banned, @last_synced_at, NULL)
       ON CONFLICT(link_url) DO UPDATE SET
         domain = excluded.domain, key = excluded.key, project_id = excluded.project_id, group_id = excluded.group_id,
         name = excluded.name, target_url = excluded.target_url, create_time = excluded.create_time,
         escape_from_wechat = excluded.escape_from_wechat, advanced_bot_detection = excluded.advanced_bot_detection,
         webhook = excluded.webhook, webhook_scene = excluded.webhook_scene, suspended = excluded.suspended, banned = excluded.banned,
         last_synced_at = excluded.last_synced_at, missing_since = NULL`);
  const attributeByScene = () =>
    q(`UPDATE links SET creator_open_id = (SELECT open_id FROM users WHERE feishu_open_id = ? LIMIT 1), source = 'tool'
       WHERE link_url = ? AND creator_open_id IS NULL`);

  function upsertLinkFromXm(l) {
    upsertLinkStmt().run({
      link_url: l.url,
      domain: l.domain || "",
      key: keyFromUrl(l.url),
      project_id: l.project_id || null,
      group_id: l.group_id || null,
      name: l.name || "",
      target_url: l.target_url || "",
      create_time: l.create_time || null,
      escape_from_wechat: l.escape_from_wechat ? 1 : 0,
      advanced_bot_detection: l.advanced_bot_detection ? 1 : 0,
      webhook: l.webhook ? 1 : 0,
      webhook_scene: l.webhook_scene || "",
      suspended: l.suspended ? 1 : 0,
      banned: l.banned ? 1 : 0,
      last_synced_at: nowIso(),
    });
    if (typeof l.webhook_scene === "string" && l.webhook_scene.startsWith(SCENE_PREFIX)) {
      attributeByScene().run(l.webhook_scene.slice(SCENE_PREFIX.length), l.url);
    }
    return q(`SELECT * FROM links WHERE link_url = ?`).get(l.url);
  }

  function setState(key, value) {
    q(`INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, String(value), nowIso());
  }
  function getState(key) {
    return q(`SELECT value, updated_at FROM sync_state WHERE key = ?`).get(key) || null;
  }

  // ---------- 任务记账 ----------
  async function runJob(job, fn) {
    if (running.has(job)) return { skipped: true, job };
    running.add(job);
    const startedAt = nowIso();
    const callsBefore = xm.stats().calls;
    const runId = q(`INSERT INTO sync_runs (job, started_at) VALUES (?, ?)`).run(job, startedAt).lastInsertRowid;
    try {
      const items = (await fn()) ?? 0;
      q(`UPDATE sync_runs SET finished_at = ?, ok = 1, items = ?, calls = ? WHERE id = ?`).run(nowIso(), items, xm.stats().calls - callsBefore, runId);
      return { ok: true, job, items };
    } catch (err) {
      q(`UPDATE sync_runs SET finished_at = ?, ok = 0, calls = ?, error = ? WHERE id = ?`).run(nowIso(), xm.stats().calls - callsBefore, String(err?.message || err), runId);
      log("error", `sync ${job} failed: ${err?.message || err}`);
      return { ok: false, job, error: String(err?.message || err) };
    } finally {
      running.delete(job);
    }
  }

  // ---------- 盘点 ----------
  async function syncInventory({ full = false } = {}) {
    return runJob(full ? "inventory_full" : "inventory", async () => {
      const runStart = nowIso();
      let upserted = 0;
      const projects = await xm.projects();
      const seenGroups = new Set();
      for (const p of projects) {
        upsertProjectStmt().run(p.id, p.name || "", p.create_time || null, nowIso());
        let offset = 0;
        for (;;) {
          const page = await xm.groups(p.id, offset, 100);
          const groups = page.groups || [];
          for (const g of groups) {
            seenGroups.add(g.id);
            upsertGroupStmt().run(g.id, p.id, g.name || "", g.total_links || 0, g.create_time || null, nowIso());
            upserted += await syncGroupLinks(g, { full, runStart });
          }
          offset += groups.length;
          if (groups.length === 0 || offset >= (page.total || 0)) break;
        }
      }
      if (seenGroups.size) {
        const placeholders = [...seenGroups].map(() => "?").join(",");
        db.prepare(`UPDATE xm_groups SET missing_since = COALESCE(missing_since, ?) WHERE id NOT IN (${placeholders})`).run(nowIso(), ...seenGroups);
      }
      setState("inventory_at", runStart);
      if (full) setState("inventory_full_at", runStart);
      return upserted;
    });
  }

  async function syncGroupLinks(g, { full, runStart }) {
    const prevRow = getState(`group_count:${g.id}`);
    const prev = prevRow ? Number(prevRow.value) : null;
    const total = g.total_links || 0;
    let start = 0;
    if (!full && prev !== null) {
      if (total === prev) {
        return 0;
      }
      if (total > prev) start = Math.max(0, prev - 100);
      // total < prev：有删除，整组重翻
    }
    let offset = start;
    let count = 0;
    let fetched = 0;
    for (;;) {
      const page = await xm.links(g.id, offset, 100);
      const links = page.links || [];
      const tx = db.transaction((rows) => rows.forEach((l) => upsertLinkFromXm(l)));
      tx(links);
      count += links.length;
      fetched = page.total || 0;
      offset += links.length;
      if (links.length === 0 || offset >= fetched) break;
    }
    if (full || start === 0) {
      // 整组翻过：这一轮没碰到的就是上游已不存在的
      q(`UPDATE links SET missing_since = COALESCE(missing_since, ?) WHERE group_id = ? AND (last_synced_at IS NULL OR last_synced_at < ?)`).run(nowIso(), g.id, runStart);
    }
    setState(`group_count:${g.id}`, fetched || total);
    return count;
  }

  // ---------- 累计数据 ----------
  async function refreshTotals(rows) {
    const update = q(`UPDATE links SET visit_count = ?, visitor_count = ?, ip_count = ?, stats_fetched_at = ? WHERE id = ?`);
    let done = 0;
    const chunk = 8;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      await Promise.all(
        slice.map(async (row) => {
          try {
            const s = await xm.linkOverall(row.link_url, true);
            update.run(s.visit_count || 0, s.visitor_count || 0, s.ip_count || 0, nowIso(), row.id);
            done += 1;
          } catch (err) {
            if (err?.code === 3330 || err?.code === 3331) {
              // 短链无效 / 已封禁：标记，不再反复拉
              q(`UPDATE links SET stats_fetched_at = ?, banned = CASE WHEN ? = 3331 THEN 1 ELSE banned END, missing_since = CASE WHEN ? = 3330 THEN COALESCE(missing_since, ?) ELSE missing_since END WHERE id = ?`).run(nowIso(), err.code, err.code, nowIso(), row.id);
            } else {
              throw err;
            }
          }
        })
      );
    }
    return done;
  }

  const tierQueries = {
    hot: `SELECT id, link_url FROM links WHERE missing_since IS NULL
            AND (create_time >= strftime('%s','now') - ${7 * DAY} OR last_opened_at >= datetime('now', '-1 hour'))
            AND (stats_fetched_at IS NULL OR stats_fetched_at < datetime('now', '-15 minutes'))
          ORDER BY stats_fetched_at LIMIT ?`,
    initial: `SELECT id, link_url FROM links WHERE missing_since IS NULL AND stats_fetched_at IS NULL ORDER BY create_time DESC LIMIT ?`,
    warm: `SELECT id, link_url FROM links WHERE missing_since IS NULL AND visit_count > 0
             AND stats_fetched_at < datetime('now', '-1 day') ORDER BY stats_fetched_at LIMIT ?`,
    cold: `SELECT id, link_url FROM links WHERE missing_since IS NULL AND visit_count = 0
             AND stats_fetched_at < datetime('now', '-7 days') ORDER BY stats_fetched_at LIMIT ?`,
  };

  function syncTotalsTier(tier, limit) {
    return runJob(`totals_${tier}`, async () => {
      const rows = q(tierQueries[tier]).all(limit);
      if (!rows.length) return 0;
      return refreshTotals(rows);
    });
  }

  /** 一次性把所有没拉过累计数据的短链补齐（运维脚本用） */
  async function backfillTotals({ batch = 500, onProgress } = {}) {
    let total = 0;
    for (;;) {
      const rows = q(tierQueries.initial).all(batch);
      if (!rows.length) break;
      total += await refreshTotals(rows);
      onProgress?.(total);
    }
    return total;
  }

  // ---------- 每日数据 ----------
  function stale(fetchedAt, ttlMs) {
    return !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > ttlMs;
  }

  function datesNeeding(existing, start, end) {
    const today = todayCN();
    const yesterday = addDays(today, -1);
    const byDate = new Map(existing.map((r) => [r.date, r]));
    const missing = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const row = byDate.get(d);
      if (!row) {
        if (d <= today) missing.push(d);
        continue;
      }
      if ((d === today || d === yesterday) && stale(row.fetched_at, opts.todayTtlMs)) missing.push(d);
    }
    return missing;
  }

  async function ensureLinkDaily(link, start, end, excludeBot = true) {
    const existing = q(`SELECT date, fetched_at FROM link_stats_daily WHERE link_id = ? AND date BETWEEN ? AND ?`).all(link.id, start, end);
    const missing = datesNeeding(existing, start, end);
    if (missing.length) {
      const ins = q(`INSERT INTO link_stats_daily (link_id, date, visit_count, visitor_count, ip_count, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(link_id, date) DO UPDATE SET visit_count = excluded.visit_count, visitor_count = excluded.visitor_count, ip_count = excluded.ip_count, fetched_at = excluded.fetched_at`);
      for (const [s, e] of splitDateRange(missing[0], missing[missing.length - 1])) {
        const d = await xm.linkDaily(link.link_url, s, e, excludeBot);
        const tx = db.transaction((rows) => rows.forEach((r) => ins.run(link.id, r.date, r.visit_count || 0, r.visitor_count || 0, r.ip_count || 0, nowIso())));
        tx(d.daily_stats || []);
      }
    }
    return seriesRows(q(`SELECT date, visit_count, visitor_count, ip_count FROM link_stats_daily WHERE link_id = ? AND date BETWEEN ? AND ? ORDER BY date`).all(link.id, start, end), start, end);
  }

  async function ensureGroupDaily(groupId, start, end, excludeBot = true) {
    const existing = q(`SELECT date, fetched_at FROM group_stats_daily WHERE group_id = ? AND date BETWEEN ? AND ?`).all(groupId, start, end);
    const missing = datesNeeding(existing, start, end);
    if (missing.length) {
      const ins = q(`INSERT INTO group_stats_daily (group_id, date, visit_count, visitor_count, ip_count, visited_link_count, created_link_count, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(group_id, date) DO UPDATE SET visit_count = excluded.visit_count, visitor_count = excluded.visitor_count, ip_count = excluded.ip_count,
                       visited_link_count = excluded.visited_link_count, created_link_count = excluded.created_link_count, fetched_at = excluded.fetched_at`);
      for (const [s, e] of splitDateRange(missing[0], missing[missing.length - 1])) {
        const d = await xm.groupDaily(groupId, s, e, excludeBot);
        const tx = db.transaction((rows) =>
          rows.forEach((r) => ins.run(groupId, r.date, r.visit_count || 0, r.visitor_count || 0, r.ip_count || 0, r.visited_link_count || 0, r.created_link_count || 0, nowIso()))
        );
        tx(d.daily_stats || []);
      }
    }
    return seriesRows(
      q(`SELECT date, visit_count, visitor_count, ip_count, visited_link_count, created_link_count FROM group_stats_daily WHERE group_id = ? AND date BETWEEN ? AND ? ORDER BY date`).all(groupId, start, end),
      start,
      end
    );
  }

  /** 补齐缺失日期为 0，保证序列连续 */
  function seriesRows(rows, start, end) {
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const r = byDate.get(d);
      out.push({ date: d, visit_count: r?.visit_count || 0, visitor_count: r?.visitor_count || 0, ip_count: r?.ip_count || 0, visited_link_count: r?.visited_link_count || 0, created_link_count: r?.created_link_count || 0 });
    }
    return out;
  }

  function sumSeries(seriesList, start, end) {
    const acc = new Map();
    for (let d = start; d <= end; d = addDays(d, 1)) acc.set(d, { date: d, visit_count: 0, visitor_count: 0, ip_count: 0 });
    for (const series of seriesList) {
      for (const r of series) {
        const a = acc.get(r.date);
        if (!a) continue;
        a.visit_count += r.visit_count || 0;
        a.visitor_count += r.visitor_count || 0;
        a.ip_count += r.ip_count || 0;
      }
    }
    return [...acc.values()];
  }

  async function seriesForGroups(groupIds, start, end) {
    const list = [];
    for (const gid of groupIds) list.push(await ensureGroupDaily(gid, start, end));
    return sumSeries(list, start, end);
  }

  async function seriesForLinks(links, start, end, { max = 200 } = {}) {
    const list = [];
    const limited = links.slice(0, max);
    for (const l of limited) list.push(await ensureLinkDaily(l, start, end));
    return { series: sumSeries(list, start, end), truncated: links.length > limited.length, counted: limited.length };
  }

  // ---------- 多维分布缓存 ----------
  async function cachedChart(scope, scopeId, start, end, excludeBot, fetcher) {
    const key = [scope, scopeId, start, end, excludeBot ? 1 : 0];
    const row = q(`SELECT payload, fetched_at FROM chart_cache WHERE scope = ? AND scope_id = ? AND start_date = ? AND end_date = ? AND exclude_bot = ?`).get(...key);
    const ttl = end < todayCN() ? 24 * 3600_000 : opts.todayTtlMs;
    if (row && !stale(row.fetched_at, ttl)) return { ...JSON.parse(row.payload), _cached_at: row.fetched_at };
    const payloads = [];
    for (const [s, e] of splitDateRange(start, end)) payloads.push(await fetcher(s, e));
    const merged = mergeCharts(payloads);
    q(`INSERT INTO chart_cache (scope, scope_id, start_date, end_date, exclude_bot, payload, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, scope_id, start_date, end_date, exclude_bot) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`).run(...key, JSON.stringify(merged), nowIso());
    return { ...merged, _cached_at: nowIso() };
  }

  /** 多个 ≤31 天窗口的多维数据相加（top 类按 key 合并后重排，取前 5） */
  function mergeCharts(list) {
    if (list.length === 1) return list[0];
    const out = { new_visitor_count: 0 };
    const sumBy = (field, keyName, valueName = "count") => {
      const m = new Map();
      for (const p of list) for (const r of p[field] || []) {
        const k = r[keyName];
        const cur = m.get(k) || { ...r, [valueName]: 0 };
        cur[valueName] += r[valueName] || 0;
        m.set(k, cur);
      }
      return [...m.values()];
    };
    for (const p of list) out.new_visitor_count += p.new_visitor_count || 0;
    out.hour_stats = sumBy("hour_stats", "hour").sort((a, b) => a.hour - b.hour);
    out.top_ip_stats = sumBy("top_ip_stats", "ip").sort((a, b) => b.count - a.count).slice(0, 5);
    out.top_referer_stats = sumBy("top_referer_stats", "referer").sort((a, b) => b.count - a.count).slice(0, 5);
    out.world_stats = sumBy("world_stats", "country_code").sort((a, b) => b.count - a.count);
    out.china_stats = sumBy("china_stats", "region").sort((a, b) => b.count - a.count);
    out.browser_stats = sumBy("browser_stats", "browser").sort((a, b) => b.count - a.count);
    out.os_stats = sumBy("os_stats", "os").sort((a, b) => b.count - a.count);
    out.device_stats = sumBy("device_stats", "device").sort((a, b) => b.count - a.count);
    out.network_stats = sumBy("network_stats", "network").sort((a, b) => b.count - a.count);
    return out;
  }

  const getLinkChart = (link, start, end, excludeBot = true) => cachedChart("link", String(link.id), start, end, excludeBot, (s, e) => xm.linkChart(link.link_url, s, e, excludeBot));
  const getGroupChart = (groupId, start, end, excludeBot = true) => cachedChart("group", groupId, start, end, excludeBot, (s, e) => xm.groupChart(groupId, s, e, excludeBot));

  // ---------- 单条即时刷新 ----------
  async function refreshLink(link, { force = false } = {}) {
    if (!force && !stale(link.stats_fetched_at, opts.todayTtlMs) && !stale(link.last_synced_at, opts.todayTtlMs)) return link;
    const detail = await xm.link(link.link_url);
    const row = upsertLinkFromXm(detail);
    await refreshTotals([row]);
    return q(`SELECT * FROM links WHERE id = ?`).get(row.id);
  }

  function touchOpened(linkId) {
    q(`UPDATE links SET last_opened_at = ? WHERE id = ?`).run(nowIso(), linkId);
  }

  // ---------- webhook 事件 ----------
  function ingestVisitEvent(ev, source = "webhook") {
    const r = ev.record || {};
    const link = q(`SELECT id FROM links WHERE link_url = ?`).get(ev.url) || q(`SELECT id FROM links WHERE link_url = ?`).get(String(ev.url).replace(/^http:/, "https:"));
    const info = q(`INSERT OR IGNORE INTO visit_events (record_id, link_url, link_id, visit_time, ip, user_agent, referer, target_url, z, new_visitor, country_code, country, region, city, is_robot, browser, os, device, network, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      r.id || ev.msgid,
      ev.url,
      link?.id ?? null,
      r.visit_time || Math.floor(Date.now() / 1000),
      r.ip || null, r.user_agent || null, r.referer ?? null, r.target_url || null, r.z ?? null,
      r.new_visitor ? 1 : 0, r.country_code || null, r.country || null, r.region || null, r.city || null,
      r.is_robot ? 1 : 0, r.browser || null, r.os || null, r.device || null, r.network || null,
      source
    );
    if (info.changes && link?.id) q(`UPDATE links SET last_opened_at = COALESCE(last_opened_at, ?) WHERE id = ?`).run(nowIso(), link.id);
    return info.changes > 0;
  }

  // ---------- 调度 ----------
  async function tick() {
    const fullAt = getState("inventory_full_at");
    const tailAt = getState("inventory_at");
    const ageMs = (row) => (row ? Date.now() - new Date(row.value).getTime() : Infinity);
    if (ageMs(fullAt) > opts.inventoryFullEveryMs) await syncInventory({ full: true });
    else if (ageMs(tailAt) > opts.inventoryTailEveryMs) await syncInventory({ full: false });
    await syncTotalsTier("hot", opts.hotBatch);
    await syncTotalsTier("initial", opts.initialBatch);
    await syncTotalsTier("warm", opts.warmBatch);
    await syncTotalsTier("cold", opts.coldBatch);
  }

  function start({ initialDelayMs = 10_000 } = {}) {
    if (timer) return;
    const loop = async () => {
      try {
        await tick();
      } catch (err) {
        log("error", `sync tick failed: ${err?.message || err}`);
      }
    };
    setTimeout(loop, initialDelayMs);
    timer = setInterval(loop, opts.tickMs);
    timer.unref?.();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function status() {
    const lastRuns = q(`SELECT job, started_at, finished_at, ok, items, calls, error FROM sync_runs r
                        WHERE id IN (SELECT MAX(id) FROM sync_runs GROUP BY job) ORDER BY started_at DESC`).all();
    const counts = q(`SELECT COUNT(*) AS total,
                             SUM(CASE WHEN missing_since IS NULL THEN 1 ELSE 0 END) AS live,
                             SUM(CASE WHEN stats_fetched_at IS NOT NULL THEN 1 ELSE 0 END) AS with_stats,
                             SUM(CASE WHEN missing_since IS NULL AND stats_fetched_at IS NULL THEN 1 ELSE 0 END) AS pending_stats,
                             SUM(CASE WHEN creator_open_id IS NOT NULL THEN 1 ELSE 0 END) AS attributed
                      FROM links`).get();
    const events = q(`SELECT COUNT(*) AS n, MAX(visit_time) AS last FROM visit_events`).get();
    return {
      running: [...running],
      inventory_full_at: getState("inventory_full_at")?.value || null,
      inventory_at: getState("inventory_at")?.value || null,
      counts,
      events,
      last_runs: lastRuns,
      client: xm.stats(),
      scheduler: { active: Boolean(timer), tick_ms: opts.tickMs },
    };
  }

  return {
    options: opts,
    syncInventory,
    syncTotalsTier,
    backfillTotals,
    refreshTotals,
    refreshLink,
    touchOpened,
    ensureLinkDaily,
    ensureGroupDaily,
    seriesForGroups,
    seriesForLinks,
    getLinkChart,
    getGroupChart,
    upsertLinkFromXm,
    ingestVisitEvent,
    tick,
    start,
    stop,
    status,
  };
}
