import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, statementCache } from "../lib/db.js";
import { createSyncEngine, todayCN, rangeFromPreset } from "../lib/sync.js";
import { addDays } from "../lib/xiaomark.js";

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shorturl-sync-")), "t.db");

/** 假小码：一个项目、两个分组，分组 g1 有 n1 条短链，所有调用都记账 */
function fakeXiaomark({ g1Links = 150, g2Links = 3 } = {}) {
  const calls = [];
  const mkLink = (g, i) => ({
    url: `https://t.fbif.com/${g}${i}`,
    domain: "t.fbif.com",
    create_time: 1700000000 + i,
    project_id: "p1",
    group_id: g,
    name: `短链${g}${i}`,
    target_url: "https://fbif.com/x",
    escape_from_wechat: false,
    advanced_bot_detection: true,
    webhook: i % 2 === 0,
    webhook_scene: i === 1 ? "shorturl:ou_me" : "",
    suspended: false,
    banned: false,
  });
  const state = { g1Links, g2Links };
  const all = (g) => Array.from({ length: g === "g1" ? state.g1Links : state.g2Links }, (_, i) => mkLink(g, i));
  const stats = { calls: 0 };
  const rec = (name, ...args) => {
    calls.push([name, ...args]);
    stats.calls += 1;
  };
  return {
    state,
    calls,
    stats: () => ({ ...stats }),
    projects: async () => (rec("projects"), [{ id: "p1", name: "我的项目", create_time: 1 }]),
    groups: async (pid, offset) => (rec("groups", pid, offset), { groups: [{ id: "g1", name: "一组", total_links: state.g1Links, create_time: 1 }, { id: "g2", name: "二组", total_links: state.g2Links, create_time: 2 }], count: 2, total: 2 }),
    links: async (gid, offset, count) => {
      rec("links", gid, offset, count);
      const list = all(gid);
      return { links: list.slice(offset, offset + count), count: Math.min(count, list.length - offset), total: list.length };
    },
    linkOverall: async (url) => (rec("linkOverall", url), { visit_count: 5, visitor_count: 4, ip_count: 3 }),
    linkDaily: async (url, start, end) => {
      rec("linkDaily", url, start, end);
      const out = [];
      for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, visit_count: 1, visitor_count: 1, ip_count: 1 });
      return { visit_count: out.length, visitor_count: out.length, ip_count: out.length, daily_stats: out };
    },
    linkChart: async (url, start, end) => (rec("linkChart", url, start, end), { new_visitor_count: 2, hour_stats: [{ hour: 9, count: 3 }], top_ip_stats: [], top_referer_stats: [{ referer: "", count: 3 }], world_stats: [], china_stats: [{ region: "上海市", count: 3 }], browser_stats: [], os_stats: [], device_stats: [{ device: "mobile", count: 3 }], network_stats: [] }),
    groupDaily: async (gid, start, end) => {
      rec("groupDaily", gid, start, end);
      const out = [];
      for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, visit_count: 2, visitor_count: 2, ip_count: 2, visited_link_count: 1, created_link_count: 0 });
      return { daily_stats: out };
    },
  };
}

function setup(xmOpts) {
  const { db } = openDatabase(tmpDb());
  const q = statementCache(db);
  db.prepare(`INSERT INTO users (open_id, feishu_open_id, name, tenant) VALUES ('fbif:ou_me', 'ou_me', '我', 'fbif')`).run();
  const xm = fakeXiaomark(xmOpts);
  const sync = createSyncEngine({ db, q, xm, options: { todayTtlMs: 60_000 } });
  return { db, q, xm, sync };
}

test("全量盘点：分页拉完所有分组的短链，并按场景值回填创建者", async () => {
  const { q, xm, sync } = setup();
  const r = await sync.syncInventory({ full: true });
  assert.equal(r.ok, true);
  assert.equal(r.items, 153);
  assert.equal(q(`SELECT COUNT(*) AS n FROM links`).get().n, 153);
  assert.equal(xm.calls.filter((c) => c[0] === "links" && c[1] === "g1").length, 2, "150 条短链按 100 一页翻两页");
  assert.equal(q(`SELECT creator_open_id, source FROM links WHERE link_url = 'https://t.fbif.com/g11'`).get().creator_open_id, "fbif:ou_me");
  assert.equal(q(`SELECT COUNT(*) AS n FROM sync_runs WHERE job = 'inventory_full' AND ok = 1`).get().n, 1);
});

test("增量盘点：分组数量没变就不翻页；变多只翻末尾页", async () => {
  const { q, xm, sync } = setup();
  await sync.syncInventory({ full: true });
  xm.calls.length = 0;
  await sync.syncInventory({ full: false });
  assert.equal(xm.calls.filter((c) => c[0] === "links").length, 0, "没有变化就不拉短链");
  xm.state.g2Links = 5;
  await sync.syncInventory({ full: false });
  const tail = xm.calls.filter((c) => c[0] === "links");
  assert.deepEqual(tail.map((c) => c[1]), ["g2"]);
  assert.equal(q(`SELECT COUNT(*) AS n FROM links WHERE group_id = 'g2'`).get().n, 5);
});

test("每日数据：历史日期只拉一次，再查同一区间不打上游", async () => {
  const { q, xm, sync } = setup({ g1Links: 1, g2Links: 0 });
  await sync.syncInventory({ full: true });
  const link = q(`SELECT * FROM links LIMIT 1`).get();
  const { start, end } = rangeFromPreset("7d");
  const first = await sync.ensureLinkDaily(link, start, end);
  assert.equal(first.length, 7);
  assert.equal(first.at(-1).date, todayCN());
  const n1 = xm.calls.filter((c) => c[0] === "linkDaily").length;
  assert.equal(n1, 1);
  const second = await sync.ensureLinkDaily(link, start, end);
  assert.equal(xm.calls.filter((c) => c[0] === "linkDaily").length, n1, "TTL 内不再拉取");
  assert.deepEqual(second.map((d) => d.visit_count), first.map((d) => d.visit_count));
});

test("多维分布：超过 31 天切成多段并合并，结果进缓存", async () => {
  const { q, xm, sync } = setup({ g1Links: 1, g2Links: 0 });
  await sync.syncInventory({ full: true });
  const link = q(`SELECT * FROM links LIMIT 1`).get();
  const { start, end } = rangeFromPreset("90d");
  const chart = await sync.getLinkChart(link, start, end, true);
  assert.equal(xm.calls.filter((c) => c[0] === "linkChart").length, 3, "90 天 = 3 段");
  assert.equal(chart.new_visitor_count, 6);
  assert.deepEqual(chart.hour_stats, [{ hour: 9, count: 9 }]);
  assert.deepEqual(chart.china_stats, [{ region: "上海市", count: 9 }]);
  await sync.getLinkChart(link, start, end, true);
  assert.equal(xm.calls.filter((c) => c[0] === "linkChart").length, 3, "命中缓存");
});

test("分组每日序列相加，并给概览补齐缺失日期", async () => {
  const { sync } = setup();
  await sync.syncInventory({ full: true });
  const { start, end } = rangeFromPreset("7d");
  const series = await sync.seriesForGroups(["g1", "g2"], start, end);
  assert.equal(series.length, 7);
  assert.ok(series.every((d) => d.visit_count === 4));
});

test("webhook 事件按记录 id 去重，并挂到对应短链", async () => {
  const { q, sync } = setup({ g1Links: 1, g2Links: 0 });
  await sync.syncInventory({ full: true });
  const ev = { url: "https://t.fbif.com/g10", msgid: "m1", record: { id: "m1", visit_time: 1700000000, ip: "1.2.3.4", browser: "wechat", device: "mobile", is_robot: false, new_visitor: true } };
  assert.equal(sync.ingestVisitEvent(ev), true);
  assert.equal(sync.ingestVisitEvent(ev), false);
  const row = q(`SELECT link_id, browser FROM visit_events WHERE record_id = 'm1'`).get();
  assert.ok(row.link_id);
  assert.equal(row.browser, "wechat");
});

test("累计数据分层：新短链先补齐，状态里能看到计数", async () => {
  const { q, xm, sync } = setup({ g1Links: 3, g2Links: 0 });
  await sync.syncInventory({ full: true });
  const r = await sync.syncTotalsTier("initial", 10);
  assert.equal(r.items, 3);
  assert.equal(xm.calls.filter((c) => c[0] === "linkOverall").length, 3);
  assert.equal(q(`SELECT SUM(visit_count) AS v FROM links`).get().v, 15);
  const status = sync.status();
  assert.equal(status.counts.with_stats, 3);
  assert.equal(status.counts.pending_stats, 0);
});
