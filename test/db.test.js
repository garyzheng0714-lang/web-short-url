import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDatabase, migrate } from "../lib/db.js";

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shorturl-test-")), "t.db");

test("全新库：三个版本的迁移跑完，再次打开不再重复执行", () => {
  const file = tmpDb();
  const first = openDatabase(file);
  assert.deepEqual(first.migrationsRan, [1, 2, 3]);
  const tables = first.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all().map((r) => r.name);
  for (const t of ["users", "sessions", "links", "xm_groups", "link_stats_daily", "group_stats_daily", "chart_cache", "visit_events", "sync_runs", "sync_state", "user_settings", "schema_migrations"]) {
    assert.ok(tables.includes(t), `缺少表 ${t}`);
  }
  assert.deepEqual(migrate(first.db), []);
  first.db.close();
  const again = openDatabase(file);
  assert.deepEqual(again.migrationsRan, []);
  again.db.close();
});

test("老库：裸 open_id 用户并入 fbif: 前缀行，link_history 并入 links 并保留创建者", () => {
  const file = tmpDb();
  const raw = new Database(file);
  // 复刻 v0.2 的 schema：users 已有兼容列，无 role；link_history 有两条历史
  raw.exec(`
    CREATE TABLE users (open_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', avatar_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      tenant TEXT DEFAULT '', tenant_key TEXT DEFAULT '', union_id TEXT DEFAULT '', user_id TEXT DEFAULT '', email TEXT DEFAULT '', feishu_open_id TEXT DEFAULT '');
    CREATE TABLE sessions (token TEXT PRIMARY KEY, open_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (open_id) REFERENCES users(open_id));
    CREATE TABLE link_history (id INTEGER PRIMARY KEY AUTOINCREMENT, open_id TEXT NOT NULL, link_url TEXT NOT NULL, target_url TEXT NOT NULL, name TEXT DEFAULT '', domain TEXT DEFAULT '', group_id TEXT DEFAULT '', group_name TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (open_id) REFERENCES users(open_id));
    INSERT INTO users (open_id, name, tenant, feishu_open_id) VALUES ('ou_abc', '郑某', '', 'ou_abc');
    INSERT INTO users (open_id, name, tenant, tenant_key, feishu_open_id) VALUES ('fbif:ou_abc', '郑某', 'fbif', 'tk1', 'ou_abc');
    INSERT INTO sessions (token, open_id, expires_at) VALUES ('t1', 'ou_abc', datetime('now', '+1 day'));
    INSERT INTO link_history (open_id, link_url, target_url, name, group_id, group_name, created_at) VALUES ('ou_abc', 'https://t.fbif.com/old1', 'https://fbif.com/a', '', 'g1', '默认分组', '2026-03-01 10:00:00');
    INSERT INTO link_history (open_id, link_url, target_url, name, group_id, group_name, created_at) VALUES ('fbif:ou_abc', 'https://t.fbif.com/old2', 'https://fbif.com/b', '活动页', 'g1', '默认分组', '2026-03-02 10:00:00');
  `);
  raw.close();

  const { db, migrationsRan } = openDatabase(file);
  assert.deepEqual(migrationsRan, [1, 2, 3]);
  const users = db.prepare(`SELECT open_id, role FROM users ORDER BY open_id`).all();
  assert.deepEqual(users, [{ open_id: "fbif:ou_abc", role: "member" }]);
  assert.equal(db.prepare(`SELECT open_id FROM sessions WHERE token = 't1'`).get().open_id, "fbif:ou_abc", "session 外键跟着搬");
  const links = db.prepare(`SELECT link_url, domain, creator_open_id, source, name FROM links ORDER BY link_url`).all();
  assert.deepEqual(links, [
    { link_url: "https://t.fbif.com/old1", domain: "t.fbif.com", creator_open_id: "fbif:ou_abc", source: "tool", name: "" },
    { link_url: "https://t.fbif.com/old2", domain: "t.fbif.com", creator_open_id: "fbif:ou_abc", source: "tool", name: "活动页" },
  ]);
  db.close();
});
