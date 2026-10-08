// SQLite 打开与版本化迁移。
// 规则：每个版本只跑一次（schema_migrations 记账），但每一步本身仍写成幂等，老库重复执行也安全。

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function localUserId(tenant, openId) {
  return `${tenant || "unknown"}:${openId}`;
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function addColumnIfMissing(db, table, column, ddl) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

const MIGRATIONS = [
  {
    version: 1,
    name: "legacy baseline: users / sessions / link_history + tenant namespace",
    up(db) {
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
      for (const [col, type] of [
        ["feishu_open_id", "TEXT DEFAULT ''"],
        ["tenant", "TEXT DEFAULT ''"],
        ["tenant_key", "TEXT DEFAULT ''"],
        ["union_id", "TEXT DEFAULT ''"],
        ["user_id", "TEXT DEFAULT ''"],
        ["email", "TEXT DEFAULT ''"],
      ]) {
        addColumnIfMissing(db, "users", col, type);
      }

      // 老库裸 open_id → tenant:open_id 命名空间（同时搬 sessions / link_history 外键）
      const legacyRows = db
        .prepare(
          `SELECT open_id, tenant FROM users
           WHERE tenant IN ('fbif', 'fude') AND open_id NOT LIKE 'fbif:%' AND open_id NOT LIKE 'fude:%'`
        )
        .all();
      const findUser = db.prepare(`SELECT open_id FROM users WHERE open_id = ?`);
      const insertNamespaced = db.prepare(`
        INSERT INTO users (open_id, feishu_open_id, name, avatar_url, tenant, tenant_key, union_id, user_id, email, created_at, updated_at)
        SELECT ?, open_id, name, avatar_url, tenant, tenant_key, union_id, user_id, email, created_at, datetime('now')
        FROM users WHERE open_id = ?`);
      const moveSessions = db.prepare(`UPDATE sessions SET open_id = ? WHERE open_id = ?`);
      const moveHistory = db.prepare(`UPDATE link_history SET open_id = ? WHERE open_id = ?`);
      const deleteUser = db.prepare(`DELETE FROM users WHERE open_id = ?`);
      for (const row of legacyRows) {
        const nextId = localUserId(row.tenant, row.open_id);
        if (!findUser.get(nextId)) insertNamespaced.run(nextId, row.open_id);
        moveSessions.run(nextId, row.open_id);
        moveHistory.run(nextId, row.open_id);
        deleteUser.run(row.open_id);
      }
      db.prepare(
        `UPDATE users SET feishu_open_id = open_id
         WHERE COALESCE(feishu_open_id, '') = '' AND open_id NOT LIKE 'fbif:%' AND open_id NOT LIKE 'fude:%'`
      ).run();
      db.prepare(
        `UPDATE users SET feishu_open_id = substr(open_id, 6)
         WHERE COALESCE(feishu_open_id, '') = '' AND (open_id LIKE 'fbif:%' OR open_id LIKE 'fude:%')`
      ).run();
    },
  },
  {
    version: 2,
    name: "xiaomark mirror: projects / groups / links / stats / events / sync",
    up(db) {
      addColumnIfMissing(db, "users", "role", "TEXT NOT NULL DEFAULT 'member'");
      db.exec(`
        CREATE TABLE IF NOT EXISTS xm_projects (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL DEFAULT '',
          create_time INTEGER,
          synced_at   TEXT
        );
        CREATE TABLE IF NOT EXISTS xm_groups (
          id            TEXT PRIMARY KEY,
          project_id    TEXT NOT NULL,
          name          TEXT NOT NULL DEFAULT '',
          total_links   INTEGER NOT NULL DEFAULT 0,
          create_time   INTEGER,
          owner_open_id TEXT REFERENCES users(open_id),
          synced_at     TEXT,
          missing_since TEXT
        );
        CREATE TABLE IF NOT EXISTS links (
          id                     INTEGER PRIMARY KEY AUTOINCREMENT,
          link_url               TEXT NOT NULL UNIQUE,
          domain                 TEXT NOT NULL DEFAULT '',
          key                    TEXT NOT NULL DEFAULT '',
          project_id             TEXT,
          group_id               TEXT,
          name                   TEXT NOT NULL DEFAULT '',
          target_url             TEXT NOT NULL DEFAULT '',
          create_time            INTEGER,
          escape_from_wechat     INTEGER NOT NULL DEFAULT 0,
          advanced_bot_detection INTEGER NOT NULL DEFAULT 0,
          webhook                INTEGER NOT NULL DEFAULT 0,
          webhook_scene          TEXT NOT NULL DEFAULT '',
          suspended              INTEGER NOT NULL DEFAULT 0,
          banned                 INTEGER NOT NULL DEFAULT 0,
          creator_open_id        TEXT REFERENCES users(open_id),
          source                 TEXT NOT NULL DEFAULT 'xiaomark',
          claimed_at             TEXT,
          first_seen_at          TEXT NOT NULL DEFAULT (datetime('now')),
          last_synced_at         TEXT,
          missing_since          TEXT,
          visit_count            INTEGER NOT NULL DEFAULT 0,
          visitor_count          INTEGER NOT NULL DEFAULT 0,
          ip_count               INTEGER NOT NULL DEFAULT 0,
          stats_fetched_at       TEXT,
          last_opened_at         TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_links_group ON links(group_id);
        CREATE INDEX IF NOT EXISTS idx_links_creator ON links(creator_open_id);
        CREATE INDEX IF NOT EXISTS idx_links_create_time ON links(create_time);
        CREATE INDEX IF NOT EXISTS idx_links_visit_count ON links(visit_count);
        CREATE INDEX IF NOT EXISTS idx_links_stats_fetched ON links(stats_fetched_at);

        CREATE TABLE IF NOT EXISTS link_stats_daily (
          link_id       INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
          date          TEXT NOT NULL,
          visit_count   INTEGER NOT NULL DEFAULT 0,
          visitor_count INTEGER NOT NULL DEFAULT 0,
          ip_count      INTEGER NOT NULL DEFAULT 0,
          fetched_at    TEXT NOT NULL,
          PRIMARY KEY (link_id, date)
        );
        CREATE TABLE IF NOT EXISTS group_stats_daily (
          group_id           TEXT NOT NULL,
          date               TEXT NOT NULL,
          visit_count        INTEGER NOT NULL DEFAULT 0,
          visitor_count      INTEGER NOT NULL DEFAULT 0,
          ip_count           INTEGER NOT NULL DEFAULT 0,
          visited_link_count INTEGER NOT NULL DEFAULT 0,
          created_link_count INTEGER NOT NULL DEFAULT 0,
          fetched_at         TEXT NOT NULL,
          PRIMARY KEY (group_id, date)
        );
        CREATE TABLE IF NOT EXISTS chart_cache (
          scope       TEXT NOT NULL,
          scope_id    TEXT NOT NULL,
          start_date  TEXT NOT NULL,
          end_date    TEXT NOT NULL,
          exclude_bot INTEGER NOT NULL DEFAULT 1,
          payload     TEXT NOT NULL,
          fetched_at  TEXT NOT NULL,
          PRIMARY KEY (scope, scope_id, start_date, end_date, exclude_bot)
        );
        CREATE TABLE IF NOT EXISTS visit_events (
          record_id    TEXT PRIMARY KEY,
          link_url     TEXT NOT NULL,
          link_id      INTEGER,
          visit_time   INTEGER NOT NULL,
          ip           TEXT, user_agent TEXT, referer TEXT, target_url TEXT, z TEXT,
          new_visitor  INTEGER, country_code TEXT, country TEXT, region TEXT, city TEXT,
          is_robot     INTEGER, browser TEXT, os TEXT, device TEXT, network TEXT,
          source       TEXT NOT NULL DEFAULT 'webhook',
          received_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_visit_events_link_time ON visit_events(link_id, visit_time DESC);
        CREATE INDEX IF NOT EXISTS idx_visit_events_time ON visit_events(visit_time DESC);

        CREATE TABLE IF NOT EXISTS sync_runs (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          job         TEXT NOT NULL,
          started_at  TEXT NOT NULL,
          finished_at TEXT,
          ok          INTEGER,
          items       INTEGER NOT NULL DEFAULT 0,
          calls       INTEGER NOT NULL DEFAULT 0,
          error       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_runs_job ON sync_runs(job, started_at DESC);
        CREATE TABLE IF NOT EXISTS sync_state (
          key        TEXT PRIMARY KEY,
          value      TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS user_settings (
          open_id          TEXT PRIMARY KEY REFERENCES users(open_id),
          default_domain   TEXT NOT NULL DEFAULT '',
          default_group_id TEXT NOT NULL DEFAULT '',
          exclude_bot      INTEGER NOT NULL DEFAULT 1,
          updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 3,
    name: "merge legacy duplicate users; import link_history into links",
    up(db) {
      // 老库遗留：同一飞书账号同时存在裸 open_id 行（tenant 为空）和 fbif: 前缀行。合并到前缀行。
      const dups = db
        .prepare(
          `SELECT a.open_id AS legacy_id, b.open_id AS keep_id
           FROM users a JOIN users b ON b.feishu_open_id = a.feishu_open_id AND b.open_id <> a.open_id
           WHERE a.open_id NOT LIKE '%:%' AND b.open_id LIKE '%:%'`
        )
        .all();
      const mv = (table, col) => db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`);
      const movers = [mv("sessions", "open_id"), mv("link_history", "open_id"), mv("links", "creator_open_id"), mv("xm_groups", "owner_open_id")];
      const del = db.prepare(`DELETE FROM users WHERE open_id = ?`);
      for (const d of dups) {
        for (const m of movers) m.run(d.keep_id, d.legacy_id);
        del.run(d.legacy_id);
      }
      // link_history → links（本工具建的，创建者已知）
      const rows = db.prepare(`SELECT * FROM link_history ORDER BY id`).all();
      const upsert = db.prepare(`
        INSERT INTO links (link_url, domain, group_id, name, target_url, create_time, creator_open_id, source, first_seen_at)
        VALUES (@link_url, @domain, @group_id, @name, @target_url, @create_time, @open_id, 'tool', @created_at)
        ON CONFLICT(link_url) DO UPDATE SET
          creator_open_id = COALESCE(links.creator_open_id, excluded.creator_open_id),
          source = CASE WHEN links.creator_open_id IS NULL THEN 'tool' ELSE links.source END`);
      for (const r of rows) {
        let domain = r.domain || "";
        try {
          domain = domain || new URL(r.link_url).hostname;
        } catch {}
        upsert.run({
          ...r,
          domain,
          group_id: r.group_id || null,
          name: r.name || "",
          create_time: Math.floor(new Date(r.created_at + "Z").getTime() / 1000) || null,
        });
      }
    },
  },
  {
    version: 4,
    name: "per-user monthly quota",
    up(db) {
      // NULL = 用默认额度（DEFAULT_MONTHLY_QUOTA）；管理员可单独调高
      addColumnIfMissing(db, "users", "monthly_quota", "INTEGER");
    },
  },
];

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare(`SELECT version FROM schema_migrations`).all().map((r) => r.version));
  const applyOne = db.transaction((m) => {
    m.up(db);
    db.prepare(`INSERT INTO schema_migrations (version, name) VALUES (?, ?)`).run(m.version, m.name);
  });
  const ran = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    applyOne(m);
    ran.push(m.version);
  }
  return ran;
}

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const ran = migrate(db);
  return { db, migrationsRan: ran };
}

/** 预编译语句缓存：同一条 SQL 只 prepare 一次 */
export function statementCache(db) {
  const cache = new Map();
  return (sql) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };
}

export function nowIso() {
  return new Date().toISOString();
}
