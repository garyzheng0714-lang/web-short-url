import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { openDatabase, statementCache } from "../lib/db.js";
import { createSyncEngine } from "../lib/sync.js";
import { createApiRouter } from "../lib/api.js";
import { addDays } from "../lib/xiaomark.js";

// 可见范围（用户 2026-10-08）：管理员看全部；其他人只看、只改自己创建的短链，看不到的按「不存在」回

const ME = "fbif:ou_me";
const OTHER = "fbif:ou_other";
const BOSS = "fbif:ou_boss";

function fakeXiaomark() {
  const mk = (g, i) => ({ url: `https://t.fbif.com/${g}${i}`, domain: "t.fbif.com", create_time: 1700000000 + i, project_id: "p1", group_id: g, name: `${g}${i}`, target_url: "https://fbif.com/x", suspended: false, banned: false });
  const groups = { g1: [0, 1, 2].map((i) => mk("g1", i)), g2: [0, 1].map((i) => mk("g2", i)) };
  const daily = (start, end) => {
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, visit_count: 1, visitor_count: 1, ip_count: 1 });
    return { visit_count: out.length, visitor_count: out.length, ip_count: out.length, daily_stats: out };
  };
  return {
    stats: () => ({ calls: 0 }),
    projects: async () => [{ id: "p1", name: "项目", create_time: 1 }],
    groups: async () => ({ groups: [{ id: "g1", name: "一组", total_links: 3, create_time: 1 }, { id: "g2", name: "二组", total_links: 2, create_time: 2 }], count: 2, total: 2 }),
    links: async (gid, offset, count) => ({ links: groups[gid].slice(offset, offset + count), count: groups[gid].length, total: groups[gid].length }),
    linkOverall: async () => ({ visit_count: 5, visitor_count: 4, ip_count: 3 }),
    linkDaily: async (_url, start, end) => daily(start, end),
    groupDaily: async (_gid, start, end) => daily(start, end),
    linkChart: async () => ({}),
    groupChart: async () => ({}),
    groupOverall: async () => ({}),
    linkRecords: async () => ({ total: 0, records: [] }),
  };
}

let server;
let base;
let ids;

before(async () => {
  const { db } = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shorturl-vis-")), "t.db"));
  const q = statementCache(db);
  const xm = fakeXiaomark();
  const sync = createSyncEngine({ db, q, xm, log: () => {} });
  await sync.syncInventory({ full: true });
  for (const [openId, role] of [[ME, "member"], [OTHER, "member"], [BOSS, "admin"]]) {
    db.prepare(`INSERT INTO users (open_id, feishu_open_id, name, tenant, role) VALUES (?, ?, ?, 'fbif', ?)`).run(openId, openId.split(":")[1], openId, role);
  }
  const all = db.prepare(`SELECT id, link_url FROM links ORDER BY link_url`).all();
  assert.equal(all.length, 5);
  // g10、g11 是我的，g12 是别人的，g2 两条无主
  const byUrl = Object.fromEntries(all.map((l) => [l.link_url.split("/").pop(), l.id]));
  db.prepare(`UPDATE links SET creator_open_id = ? WHERE id IN (?, ?)`).run(ME, byUrl.g10, byUrl.g11);
  db.prepare(`UPDATE links SET creator_open_id = ? WHERE id = ?`).run(OTHER, byUrl.g12);
  ids = { mine: byUrl.g10, other: byUrl.g12, orphan: byUrl.g20 };

  const app = express();
  app.use(express.json());
  // 测试里的身份：请求头 x-user 指定是谁（真实服务走 session）
  const requireAuth = (req, res, next) => {
    const u = db.prepare(`SELECT open_id, feishu_open_id, role, name FROM users WHERE open_id = ?`).get(req.get("x-user"));
    if (!u) return res.status(401).json({ ok: false });
    req.session = { open_id: u.open_id, feishu_open_id: u.feishu_open_id, role: u.role, user_name: u.name };
    next();
  };
  app.use("/api", createApiRouter({ db, q, xm, sync, requireAuth }));
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server?.close());

const call = async (who, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  return { status: res.status, body: json.data ?? json.error };
};

test("成员的列表只有自己创建的短链，scope=all 也一样", async () => {
  for (const scope of ["all", "mine"]) {
    const r = await call(ME, "GET", `/links?scope=${scope}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 2);
    assert.ok(r.body.items.every((l) => l.creator?.open_id === ME && l.can_manage === true));
  }
});

test("成员看别人的、无主的短链：详情、统计、访问记录都按不存在回", async () => {
  for (const id of [ids.other, ids.orphan]) {
    for (const suffix of ["", "/stats", "/visits"]) {
      const r = await call(ME, "GET", `/links/${id}${suffix}`);
      assert.equal(r.status, 404, `GET /links/${id}${suffix}`);
    }
  }
  assert.equal((await call(ME, "GET", `/links/${ids.mine}`)).status, 200);
});

test("成员的 7 日趋势只返回自己的", async () => {
  const r = await call(ME, "GET", `/links/trends?ids=${ids.mine},${ids.other},${ids.orphan}`);
  assert.deepEqual(Object.keys(r.body.trends).map(Number), [ids.mine]);
});

test("成员不能改、停用别人的短链，也不能认领无主短链", async () => {
  assert.equal((await call(ME, "PATCH", `/links/${ids.other}`, { name: "x" })).status, 404);
  assert.equal((await call(ME, "POST", `/links/${ids.other}/suspend`)).status, 404);
  assert.equal((await call(ME, "POST", `/links/${ids.orphan}/claim`)).status, 403);
});

test("成员的分组汇总只算自己的短链；分组每日统计只给管理员", async () => {
  const r = await call(ME, "GET", "/groups");
  assert.deepEqual(r.body.items.map((g) => [g.id, g.link_count, g.total_links]), [["g1", 2, 2]]);
  assert.equal((await call(ME, "GET", "/groups/g1/stats")).status, 403);
});

test("成员的概览只算自己的短链", async () => {
  const r = await call(ME, "GET", "/overview?range=7d&scope=all");
  assert.equal(r.status, 200);
  assert.equal(r.body.kpi.total_links, 2);
  assert.ok(r.body.top_links.every((l) => l.creator?.open_id === ME));
  assert.equal(r.body.previous, null);
});

test("管理员看全部，可以看别人的与无主的", async () => {
  const r = await call(BOSS, "GET", "/links?scope=all");
  assert.equal(r.body.total, 5);
  assert.equal((await call(BOSS, "GET", `/links/${ids.other}`)).status, 200);
  assert.equal((await call(BOSS, "GET", `/links/${ids.orphan}`)).status, 200);
  const g = await call(BOSS, "GET", "/groups");
  assert.deepEqual(g.body.items.map((x) => x.id).sort(), ["g1", "g2"]);
});
