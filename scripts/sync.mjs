#!/usr/bin/env node
// 运维脚本：node scripts/sync.mjs <inventory|inventory-full|totals|tick|status>
// 与服务进程共用同一个 SQLite（WAL），可在服务运行时执行。
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, statementCache } from "../lib/db.js";
import { createXiaomarkClient } from "../lib/xiaomark.js";
import { createSyncEngine } from "../lib/sync.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.resolve(root, process.env.DB_PATH || "shorturl.db");
const log = (level, msg) => console.log(`[${level}] ${msg}`);
const { db, migrationsRan } = openDatabase(dbPath);
if (migrationsRan.length) log("info", `migrations applied: ${migrationsRan.join(", ")}`);
const q = statementCache(db);
const xm = createXiaomarkClient({ apikey: process.env.XIAOMARK_API_KEY, concurrency: Number(process.env.SYNC_CONCURRENCY || 2), log });
const sync = createSyncEngine({ db, q, xm, log });

const cmd = process.argv[2] || "status";
const t0 = Date.now();
let result;
if (cmd === "inventory") result = await sync.syncInventory({ full: false });
else if (cmd === "inventory-full") result = await sync.syncInventory({ full: true });
else if (cmd === "totals") result = { backfilled: await sync.backfillTotals({ onProgress: (n) => process.stdout.write(`\r  totals refreshed: ${n}   `) }) };
else if (cmd === "tick") { await sync.tick(); result = { ticked: true }; }
else if (cmd === "status") result = sync.status();
else { console.error(`unknown command: ${cmd}`); process.exit(2); }
console.log();
console.log(JSON.stringify(result, null, 2));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s, xiaomark calls: ${xm.stats().calls}`);
db.close();
