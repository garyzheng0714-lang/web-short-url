#!/usr/bin/env node
// 真实浏览器走查：用本机 Chrome 打开各页面，截图 + 收集 console 报错 + 走一遍建链 / 暂停 / 恢复。
// 用法：SESSION_TOKEN=<token> BASE_URL=http://127.0.0.1:3000 node scripts/ui-check.mjs [--no-create]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.SESSION_TOKEN;
if (!TOKEN) throw new Error("SESSION_TOKEN missing");
const CREATE = !process.argv.includes("--no-create");
// 每次运行独立目录（时间戳），截图不会被上一轮的同名文件混淆
const RUN = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".ui-check", RUN);
fs.mkdirSync(out, { recursive: true });
// 应用外框是 h-dvh + 内层滚动，fullPage 截不到折叠部分：长页面临时把视口拉高再截
const shot = async (page, name, full = true) => {
  const file = path.join(out, `${name}.png`);
  const vp = page.viewportSize();
  if (full && vp) {
    const h = await page.evaluate(() => Math.max(...[...document.querySelectorAll("[data-slot=split-pane] > div")].map((el) => el.scrollHeight), document.body.scrollHeight));
    await page.setViewportSize({ width: vp.width, height: Math.min(4000, Math.max(vp.height, h + 24)) });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: file, fullPage: false });
  if (full && vp) await page.setViewportSize(vp);
  console.log(`  📷 ${name}.png`);
};
const errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
const host = new URL(BASE).hostname;
await ctx.addCookies([{ name: "shorturl_session", value: TOKEN, domain: host, path: "/" }]);
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${page.url()} ${m.text()}`));
page.on("pageerror", (e) => errors.push(`[pageerror] ${page.url()} ${e.message}`));
page.on("response", (r) => r.status() >= 400 && !r.url().includes("/api/tools/") && errors.push(`[http ${r.status()}] ${r.url()}`));
const settle = async () => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
};

console.log("1. 短链列表");
await page.goto(`${BASE}/`);
await settle();
await page.getByRole("table").waitFor({ timeout: 15000 });
await shot(page, "01-links");

let createdUrl = "";
if (CREATE) {
  console.log("2. 生成短链（分组：短链测试）");
  await page.getByRole("combobox", { name: "分组" }).click();
  await page.getByRole("option", { name: "短链测试" }).click();
  const input = page.getByPlaceholder("粘贴长链接，回车生成短链");
  await input.click();
  await page.keyboard.type("https://www.fbif.com/?from=shorturl-ui-check");
  await page.keyboard.press("Enter");
  const status = page.getByRole("status").filter({ hasText: "t.f" }).first();
  await status.waitFor({ timeout: 30000 });
  createdUrl = (await status.locator("a").first().textContent())?.trim() || "";
  console.log(`  created: ${createdUrl}`);
  await settle();
  await shot(page, "02-links-created");

  console.log("3. 行操作：暂停 → 恢复");
  const menu = page.getByRole("button", { name: /更多操作/ }).first();
  await menu.click();
  await page.getByRole("menuitem", { name: "暂停跳转" }).click();
  await page.getByText(/已暂停 .* 的跳转/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await shot(page, "03-links-suspended", false);
  await menu.click();
  await page.getByRole("menuitem", { name: "恢复跳转" }).click();
  await page.getByText(/已恢复 .* 的跳转/).waitFor({ timeout: 15000 });
}

console.log("4. 筛选与搜索");
await page.goto(`${BASE}/?scope=all&group=te9k09li&sort=visits`);
await settle();
await page.getByRole("table").waitFor();
await shot(page, "04-links-filtered", false);

console.log("5. 短链详情（访问最多的一条）");
await page.goto(`${BASE}/links/2708`);
await settle();
await page.getByText("每日访问").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await shot(page, "05-link-detail");
await page.getByRole("radio", { name: "近 90 天" }).click().catch(async () => page.getByText("近 90 天").click());
await settle();
await page.waitForTimeout(1200);
await shot(page, "06-link-detail-90d");

console.log("6. 概览");
await page.goto(`${BASE}/overview`);
await settle();
await page.getByText("访问最多").waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await shot(page, "07-overview");

console.log("7. 分组");
await page.goto(`${BASE}/groups`);
await settle();
await page.getByRole("table").waitFor();
await shot(page, "08-groups", false);
await page.goto(`${BASE}/groups/te9k09li`);
await settle();
await page.getByText("每日访问").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await shot(page, "09-group-detail");

console.log("8. 设置");
await page.goto(`${BASE}/settings`);
await settle();
await page.waitForTimeout(800);
await shot(page, "10-settings");

console.log("9. 窄屏 390");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/`);
await settle();
await shot(page, "11-links-mobile");
await page.goto(`${BASE}/links/2708`);
await settle();
await page.waitForTimeout(1200);
await shot(page, "12-link-detail-mobile");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log(`  horizontal overflow at 390: ${overflow}px`);

await browser.close();
console.log(`\n截图目录：${out}`);
console.log(errors.length ? `\n⚠️ ${errors.length} 条浏览器报错：\n${[...new Set(errors)].join("\n")}` : "\n✅ 没有 console / 页面报错");
if (createdUrl) console.log(`\n测试短链：${createdUrl}`);
