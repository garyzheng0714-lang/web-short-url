import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { openDatabase, statementCache } from "../lib/db.js";
import { createSyncEngine } from "../lib/sync.js";
import { createApiRouter } from "../lib/api.js";

// 批量建链（用户 2026-10-08：粘贴多条自动展开，一批最多 1000 条，前端每 100 条提交一次）

const ME = "fbif:ou_me";
const OTHER = "fbif:ou_other";

let seq = 0;
const mode = { batchFails: false, badTarget: "" };
const calls = { batch: 0, single: 0 };

function fakeXiaomark() {
  return {
    stats: () => ({ calls: 0 }),
    projects: async () => [{ id: "p1", name: "项目", create_time: 1 }],
    groups: async () => ({ groups: [{ id: "g1", name: "一组", total_links: 0, create_time: 1 }], count: 1, total: 1 }),
    links: async () => ({ links: [], count: 0, total: 0 }),
    batchCreateLinks: async (p) => {
      calls.batch += 1;
      if (mode.batchFails) throw new Error("小码：有一条目标链接不可用");
      return { link_url_list: p.items.map(() => `https://t.fbif.com/b${++seq}`), count: p.items.length };
    },
    createLink: async (p) => {
      calls.single += 1;
      if (p.target_url === mode.badTarget) throw new Error("目标链接被小码拒绝");
      return { link_url: `https://t.fbif.com/s${++seq}` };
    },
  };
}

let server;
let base;
let db;

before(async () => {
  ({ db } = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shorturl-batch-")), "t.db")));
  const q = statementCache(db);
  const xm = fakeXiaomark();
  const sync = createSyncEngine({ db, q, xm, log: () => {} });
  await sync.syncInventory({ full: true });
  for (const openId of [ME, OTHER]) {
    db.prepare(`INSERT INTO users (open_id, feishu_open_id, name, tenant, role) VALUES (?, ?, ?, 'fbif', 'member')`).run(openId, openId.split(":")[1], openId);
  }
  const app = express();
  app.use(express.json({ limit: "1mb" }));
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

beforeEach(() => {
  mode.batchFails = false;
  mode.badTarget = "";
  calls.batch = 0;
  calls.single = 0;
  db.prepare(`UPDATE users SET monthly_quota = NULL`).run();
});

const post = async (who, body) => {
  const res = await fetch(`${base}/links/batch`, { method: "POST", headers: { "content-type": "application/json", ...(who ? { "x-user": who } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test("一份里的有效链接一次建好，格式不对的单独报错，创建者记成本人", async () => {
  const before = (await (await fetch(`${base}/usage`, { headers: { "x-user": ME } })).json()).data.used;
  const r = await post(ME, { group_id: "g1", items: [{ target_url: "https://a.com/1", name: "甲" }, { target_url: "not a url" }, { target_url: "https://b.com/2" }] });
  assert.equal(r.status, 200);
  assert.equal(calls.batch, 1);
  const items = r.body.data.items;
  assert.deepEqual(items.map((i) => i.index), [0, 1, 2]);
  assert.ok(items[0].link && items[2].link);
  assert.match(items[1].error, /http/);
  assert.equal(items[0].link.name, "甲");
  assert.equal(items[0].link.target_url, "https://a.com/1");
  assert.equal(r.body.data.usage.used, before + 2);
  const owners = db.prepare(`SELECT creator_open_id, source FROM links WHERE link_url IN (?, ?)`).all(items[0].link.link_url, items[2].link.link_url);
  assert.deepEqual(owners.map((o) => [o.creator_open_id, o.source]), [[ME, "tool"], [ME, "tool"]]);
});

test("额度不够时整份不建", async () => {
  db.prepare(`UPDATE users SET monthly_quota = ? WHERE open_id = ?`).run(0, OTHER);
  const r = await post(OTHER, { group_id: "g1", items: [{ target_url: "https://a.com/x" }, { target_url: "https://a.com/y" }] });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "quota_exceeded");
  assert.equal(calls.batch + calls.single, 0);
});

test("一份超过 100 条要分批", async () => {
  const r = await post(ME, { group_id: "g1", items: Array.from({ length: 101 }, (_, i) => ({ target_url: `https://a.com/${i}` })) });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "too_many");
});

test("整份失败时逐条重试，只有出错的那条失败", async () => {
  mode.batchFails = true;
  mode.badTarget = "https://bad.com/";
  const r = await post(ME, { group_id: "g1", items: [{ target_url: "https://ok.com/1" }, { target_url: "https://bad.com/" }, { target_url: "https://ok.com/2" }] });
  assert.equal(r.status, 200);
  assert.equal(calls.batch, 1);
  assert.equal(calls.single, 3);
  const items = r.body.data.items;
  assert.ok(items[0].link && items[2].link);
  assert.match(items[1].error, /拒绝/);
});

test("没登录不能批量建链；建好的别人看不到", async () => {
  assert.equal((await post(null, { group_id: "g1", items: [{ target_url: "https://a.com/z" }] })).status, 401);
  const r = await post(ME, { group_id: "g1", items: [{ target_url: "https://mine.com/only" }] });
  const id = r.body.data.items[0].link.id;
  const res = await fetch(`${base}/links/${id}`, { headers: { "x-user": OTHER } });
  assert.equal(res.status, 404);
});
