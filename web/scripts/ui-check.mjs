#!/usr/bin/env node
// 真实浏览器走查：本机 Chrome 打开首页，走一遍生成、列表 / 分组视图、详情与分组抽屉、额度弹窗、设置、窄屏；截图 + 报错汇总 + 对齐量测；短链图解的逐格检查另见 story-check.mjs。
// 用法：SESSION_TOKEN=<token> BASE_URL=http://127.0.0.1:3000 node scripts/ui-check.mjs [--no-create] [--quota]
//   --no-create 不真的建链（不消耗小码额度）
//   --quota     额度弹窗：需要事先把这个测试账号的额度调成已用完
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.SESSION_TOKEN;
if (!TOKEN) throw new Error("SESSION_TOKEN missing");
const CREATE = !process.argv.includes("--no-create");
const QUOTA = process.argv.includes("--quota");
const RUN = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".ui-check", RUN);
fs.mkdirSync(out, { recursive: true });

const errors = [];
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `：${detail}` : ""}`);
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
await ctx.addCookies([{ name: "shorturl_session", value: TOKEN, domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${page.url()} ${m.text()}`));
page.on("pageerror", (e) => errors.push(`[pageerror] ${page.url()} ${e.message}`));
page.on("response", (r) => r.status() >= 400 && !r.url().includes("/api/tools/") && !(QUOTA && r.status() === 403) && errors.push(`[http ${r.status()}] ${r.url()}`));
const settle = async (ms = 500) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
const shot = async (name, full = true) => {
  const vp = page.viewportSize();
  if (full && vp) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: vp.width, height: Math.min(5000, Math.max(vp.height, h)) });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  if (full && vp) await page.setViewportSize(vp);
  console.log(`  📷 ${name}.png`);
};
const box = (loc) => loc.boundingBox();

console.log("1. 首页");
await page.goto(`${BASE}/`);
await settle();
await page.getByRole("table").waitFor({ timeout: 20000 });
await shot("01-home");
// 对齐量测：输入框与按钮同高同顶；状态行、标题、插画、工具条左缘与输入框同线
const input = await box(page.locator("[data-slot=input-shell]").first());
const btn = await box(page.getByRole("button", { name: "生成短链" }));
const title = await box(page.getByRole("heading", { name: "生成短链" }));
const meta = await box(page.getByText(/本月已生成/).first());
const seg = await box(page.locator("[data-slot=segmented]").first());
const search = await box(page.locator("input[type=search], [data-slot=search-field] input").first());
check("输入框与按钮同高", Math.abs(input.height - btn.height) <= 0.5, `${input.height} / ${btn.height}`);
check("输入框与按钮顶边对齐", Math.abs(input.y - btn.y) <= 0.5, `${input.y} / ${btn.y}`);
check("标题、输入框、状态行、视图切换左缘同线", [title.x, meta.x, seg.x].every((x) => Math.abs(x - input.x) <= 1.5), `标题 ${title.x} 输入 ${input.x} 状态 ${meta.x} 切换 ${seg.x}`);
const btnRight = btn.x + btn.width;
const searchShell = await box(page.locator("[data-slot=search-field]").first()).catch(() => null);
const sr = searchShell || search;
check("按钮右缘与搜索框右缘同线", Math.abs(btnRight - (sr.x + sr.width)) <= 1.5, `${btnRight} / ${sr.x + sr.width}`);
// 图解：在视口里会动、左缘与输入框同线（逐格的衔接、节奏与减少动态在 scripts/story-check.mjs）
const story = page.locator("[data-slot=short-link-story]");
await story.evaluate((el) => el.scrollIntoView({ block: "center" }));
await page.waitForTimeout(600);
check("短链图解在视口里播放", (await story.locator("> [role=img]").getAttribute("data-running")) !== null);
const storyBox = await box(story);
check("图解左缘与输入框同线", Math.abs(storyBox.x - input.x) <= 1.5, `${storyBox.x} / ${input.x}`);
await page.evaluate(() => window.scrollTo(0, 0));

let createdUrl = "";
if (CREATE) {
  console.log("2. 生成短链");
  await page.locator("[data-slot=input-shell] input").first().click();
  await page.keyboard.type("https://www.fbif.com/?from=shorturl-ui-check-v2");
  await page.keyboard.press("Enter");
  const status = page.getByRole("status").filter({ hasText: "t." }).first();
  await status.waitFor({ timeout: 30000 });
  createdUrl = ((await status.locator("button").first().textContent()) || "").trim();
  console.log(`  created: ${createdUrl}`);
  await settle();
  await shot("02-created", false);
  const firstRow = (await page.getByRole("row").nth(1).textContent()) || "";
  check("新短链出现在列表首行", createdUrl && firstRow.includes(createdUrl.split("/").pop()), firstRow.slice(0, 60));
}

console.log("3. 点行打开详情抽屉");
await page.goto(`${BASE}/?sort=visits`);
await settle();
await page.getByRole("row").nth(1).click();
const dialog = page.getByRole("dialog");
await dialog.getByText("每日访问").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
check("打开抽屉后地址带 ?link=", /[?&]link=\d+/.test(page.url()), page.url().replace(BASE, ""));
check("抽屉宽度 ≥ 640", ((await box(dialog.first()))?.width || 0) >= 640, String((await box(dialog.first()))?.width));
await shot("03-link-drawer", false);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
check("Esc 关闭后地址去掉 link", !/[?&]link=/.test(page.url()), page.url().replace(BASE, ""));

console.log("4. 分组视图与分组抽屉");
await page.getByRole("radio", { name: "分组" }).click();
await settle();
await page.getByRole("table").waitFor();
await shot("04-groups-view", false);
await page.getByRole("row").nth(1).click();
await dialog.getByText("每日访问").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await shot("05-group-drawer", false);
await dialog.getByRole("button", { name: "查看组内短链" }).click();
await settle();
check("「查看组内短链」切回列表并按分组筛选", /[?&]group=/.test(page.url()) && !/view=groups/.test(page.url()), page.url().replace(BASE, ""));
await shot("06-list-filtered", false);

if (QUOTA) {
  console.log("5. 额度用完弹窗");
  await page.goto(`${BASE}/`);
  await settle();
  await page.locator("[data-slot=input-shell] input").first().fill("https://www.fbif.com/?quota-check");
  await page.getByRole("button", { name: "生成短链" }).click();
  await page.getByRole("dialog").getByText("本月额度已用完").waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await shot("07-quota-dialog", false);
  check("额度弹窗出现且写明联系人", (await page.getByRole("dialog").textContent()).includes("联系"));
}

console.log("6. 设置");
await page.goto(`${BASE}/settings`);
await settle(800);
await shot("08-settings");

console.log("7. 窄屏 390");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/`);
await settle(800);
await shot("09-home-mobile");
check("390 宽无横向溢出", (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
const firstCell = await box(page.getByRole("row").nth(1).getByRole("cell").first());
check("390 宽列表的短链列宽 ≥ 160", (firstCell?.width || 0) >= 160, String(firstCell?.width));
await page.goto(`${BASE}/?link=2708`);
await settle(1200);
await shot("10-drawer-mobile", false);

await browser.close();
console.log(`\n截图目录：${out}`);
const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n✗ ${failed.length} 项检查未过` : `\n✓ ${checks.length} 项检查全部通过`);
console.log(errors.length ? `⚠️ ${errors.length} 条浏览器报错：\n${[...new Set(errors)].join("\n")}` : "✓ 没有 console / 页面 / HTTP 报错");
if (createdUrl) console.log(`测试短链：${createdUrl}`);
process.exitCode = failed.length || errors.length ? 1 : 0;
