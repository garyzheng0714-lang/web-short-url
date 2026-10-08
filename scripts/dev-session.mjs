#!/usr/bin/env node
// 本地调试用：在本地 SQLite 里创建一个测试用户和 7 天 session，打印 token。
// 只对本机数据库文件生效；生产环境不要用，正式登录永远走飞书。
import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../lib/db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { db } = openDatabase(path.resolve(root, process.env.DB_PATH || "shorturl.db"));
const role = process.argv.includes("--admin") ? "admin" : "member";
const name = process.argv.find((a) => a.startsWith("--name="))?.slice(7) || (role === "admin" ? "本地管理员" : "本地成员");
const feishuId = `ou_dev_${crypto.createHash("sha1").update(name).digest("hex").slice(0, 24)}`;
const openId = `fbif:${feishuId}`;
db.prepare(`INSERT INTO users (open_id, feishu_open_id, name, tenant, tenant_key, role) VALUES (?, ?, ?, 'fbif', 'dev', ?)
  ON CONFLICT(open_id) DO UPDATE SET name = excluded.name, role = excluded.role`).run(openId, feishuId, name, role);
const token = crypto.randomBytes(32).toString("hex");
db.prepare(`INSERT INTO sessions (token, open_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))`).run(token, openId);
console.log(token);
