#!/usr/bin/env node
// 真实浏览器走查：本机 Chrome 走一遍侧栏与账号菜单、生成短链页、短链访问数据页（指标卡、每日访问卡、短链卡片、分组卡片、抽屉）、设置、窄屏，
// 有 MEMBER_TOKEN 时再以成员身份确认只看得到自己的短链。截图 + 报错汇总 + 对齐量测。
// 用法：SESSION_TOKEN=<管理员 token> [MEMBER_TOKEN=<成员 token>] BASE_URL=http://127.0.0.1:3000 node scripts/ui-check.mjs [--no-create] [--quota]
//   --no-create 不真的建链（不消耗小码额度）
//   --quota     额度弹窗：需要事先把这个测试账号的额度调成已用完
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.SESSION_TOKEN;
const MEMBER = process.env.MEMBER_TOKEN;
if (!TOKEN) throw new Error("SESSION_TOKEN missing");
const CREATE = !process.argv.includes("--no-create");
const QUOTA = process.argv.includes("--quota");
const RUN = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".ui-check", RUN);
fs.mkdirSync(out, { recursive: true });
/** Notion 蓝（用户 2026-10-08 裁定的强调色），主按钮的底色应当是它（Su 的按钮把底色画在内层，读 --btn-bg） */
const ACCENT = "#2383e2";

const errors = [];
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `：${detail}` : ""}`);
};
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function open(token) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  await ctx.addCookies([{ name: "shorturl_session", value: token, domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${page.url()} ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[pageerror] ${page.url()} ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && !(QUOTA && r.status() === 403) && errors.push(`[http ${r.status()}] ${r.url()}`));
  const settle = async (ms = 500) => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(ms);
  };
  const shot = async (name, full = true) => {
    const vp = page.viewportSize();
    if (full && vp) {
      // 页面在主栏里滚动（侧栏布局），按主栏内容高撑开视口
      const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, (document.querySelector("main")?.parentElement?.scrollHeight || 0) + 64));
      await page.setViewportSize({ width: vp.width, height: Math.min(5000, Math.max(vp.height, h)) });
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    if (full && vp) await page.setViewportSize(vp);
    console.log(`  📷 ${name}.png`);
  };
  return { ctx, page, settle, shot };
}
const box = (loc) => loc.boundingBox();

// ===== 管理员 =====
const { ctx, page, settle, shot } = await open(TOKEN);
const nav = page.getByRole("navigation", { name: "工作区" });

console.log("1. 侧栏与生成短链页");
await page.goto(`${BASE}/`);
await settle();
await shot("01-create");
const input = await box(page.locator("[data-slot=input-shell]").first());
const btn = page.getByRole("button", { name: "生成短链" });
const btnBox = await box(btn);
check("输入框与按钮同高", Math.abs(input.height - btnBox.height) <= 0.5, `${input.height} / ${btnBox.height}`);
check("输入框与按钮顶边对齐", Math.abs(input.y - btnBox.y) <= 0.5, `${input.y} / ${btnBox.y}`);
const mainBox = await box(page.locator("main"));
const leftGap = input.x - mainBox.x;
const rightGap = mainBox.x + mainBox.width - (btnBox.x + btnBox.width);
check("输入组水平居中、宽不超过 672", Math.abs(leftGap - rightGap) <= 1.5 && btnBox.x + btnBox.width - input.x <= 672.5, `左 ${leftGap} 右 ${rightGap} 宽 ${btnBox.x + btnBox.width - input.x}`);
check("生成页没有可见标题（不复述按钮）", !(await page.getByRole("heading", { name: "生成短链" }).isVisible()) || (await page.getByRole("heading", { name: "生成短链" }).evaluate((el) => el.getBoundingClientRect().width <= 1)));
check("生成页只有输入框和按钮：没有用量行、没有列表与搜索", (await page.getByText(/本月已生成/).count()) === 0 && (await page.locator("main [data-slot=search-field], main table, main [data-slot=card]").count()) === 0);
const btnBg = await btn.evaluate((el) => getComputedStyle(el).getPropertyValue("--btn-bg").trim().toLowerCase());
check("主按钮是强调色（Notion 蓝）", btnBg === ACCENT, btnBg);
check("站名是「短链生成工具」", (await nav.textContent()).includes("短链生成工具"));
const navLinks = (await nav.getByRole("link").allTextContents()).map((t) => t.trim());
check("侧栏三项：生成短链、短链访问数据、设置", ["生成短链", "短链访问数据", "设置"].every((t) => navLinks.some((x) => x.includes(t))), navLinks.join(" / "));
check("侧栏当前项是「生成短链」", (await nav.getByRole("link", { name: "生成短链" }).getAttribute("aria-current")) === "page");
check("侧栏上没有直接摆的退出按钮", (await nav.getByRole("button", { name: "退出登录" }).count()) === 0);
await nav.getByRole("button", { name: /^账号菜单/ }).click();
await page.getByRole("menuitem", { name: "退出登录" }).waitFor({ timeout: 5000 });
check("退出登录在账号菜单（二级菜单）里", await page.getByRole("menuitem", { name: "退出登录" }).isVisible());
await shot("01b-account-menu", false);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

let createdUrl = "";
if (CREATE) {
  console.log("2. 生成一条短链");
  await page.locator("[data-slot=input-shell] input").first().click();
  await page.keyboard.type("https://www.fbif.com/?from=shorturl-ui-check-v3");
  await page.keyboard.press("Enter");
  const status = page.getByRole("status").filter({ hasText: "t." }).first();
  await status.waitFor({ timeout: 30000 });
  createdUrl = ((await status.locator("button").first().textContent()) || "").trim();
  console.log(`  created: ${createdUrl}`);
  await shot("02-created", false);
  await page.goto(`${BASE}/data`);
  await settle();
  const firstCard = (await page.locator("main section [data-slot=card]").first().textContent()) || "";
  check("新短链是数据页第一张短链卡片", createdUrl && firstCard.includes(createdUrl.split("/").pop()), firstCard.slice(0, 40));
}

console.log("3. 短链访问数据页");
await nav.getByRole("link", { name: "短链访问数据" }).click();
await settle(1200);
check("侧栏切到「短链访问数据」", page.url().endsWith("/data") && (await nav.getByRole("link", { name: "短链访问数据" }).getAttribute("aria-current")) === "page", page.url().replace(BASE, ""));
await page.locator("main svg").first().waitFor({ timeout: 20000 });
await shot("03-data");
const kpis = page.getByRole("group", { name: "概览" }).locator("[data-slot=card]");
check("四张指标卡", (await kpis.count()) === 4);
const h1 = await box(page.getByRole("heading", { name: "短链访问数据" }));
const kpiBoxes = await Promise.all([0, 1, 2, 3].map((i) => kpis.nth(i).boundingBox()));
const rangeSeg = await box(page.locator("header [data-slot=segmented]").last());
check("标题与第一张指标卡左缘同线", Math.abs(h1.x - kpiBoxes[0].x) <= 1.5, `${h1.x} / ${kpiBoxes[0].x}`);
check("时间切换与最后一张指标卡右缘同线", Math.abs(rangeSeg.x + rangeSeg.width - (kpiBoxes[3].x + kpiBoxes[3].width)) <= 1.5, `${rangeSeg.x + rangeSeg.width} / ${kpiBoxes[3].x + kpiBoxes[3].width}`);
check("指标卡同高同顶", kpiBoxes.every((b) => Math.abs(b.y - kpiBoxes[0].y) <= 0.5 && Math.abs(b.height - kpiBoxes[0].height) <= 0.5));
const cards = page.locator("main section [data-slot=card]");
check("短链以卡片呈现", (await cards.count()) > 0, `${await cards.count()} 张`);
const cardBg = await cards.first().evaluate((el) => getComputedStyle(el).backgroundColor);
check("卡片是实色面（不是透明）", cardBg !== "rgba(0, 0, 0, 0)" && cardBg !== "transparent", cardBg);
const [c0, c1] = [await box(cards.nth(0)), await box(cards.nth(1))];
check("短链卡片在桌面上并排、同高", Math.abs(c0.y - c1.y) <= 0.5 && Math.abs(c0.height - c1.height) <= 0.5 && c1.x > c0.x);

console.log("4. 点卡片开详情抽屉");
await cards.first().locator("[data-slot=card-link]").click();
const dialog = page.getByRole("dialog");
await dialog.getByText("每日访问").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
check("打开抽屉后地址带 ?link=", /[?&]link=\d+/.test(page.url()), page.url().replace(BASE, ""));
check("抽屉宽度 ≥ 640", ((await box(dialog))?.width || 0) >= 640, String((await box(dialog))?.width));
await shot("04-link-drawer", false);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
check("Esc 关闭后地址去掉 link", !/[?&]link=/.test(page.url()), page.url().replace(BASE, ""));

console.log("5. 分组卡片与分组抽屉");
await page.getByRole("radio", { name: "分组" }).click();
await settle();
const groupCards = page.locator("main section [data-slot=card]");
await groupCards.first().waitFor();
check("分组以卡片呈现", (await groupCards.count()) > 0, `${await groupCards.count()} 张`);
await shot("05-groups");
await groupCards.first().locator("[data-slot=card-link]").click();
await dialog.getByText("每日访问").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await shot("06-group-drawer", false);
await dialog.getByRole("button", { name: "查看组内短链" }).click();
await settle();
check("「查看组内短链」切回短链卡片并按分组筛选", /[?&]group=/.test(page.url()) && !/view=groups/.test(page.url()), page.url().replace(BASE, ""));

if (QUOTA) {
  console.log("6. 额度用完弹窗");
  await page.goto(`${BASE}/`);
  await settle();
  await page.locator("[data-slot=input-shell] input").first().click();
  await page.keyboard.type("https://www.fbif.com/?quota-check");
  await page.getByRole("button", { name: "生成短链" }).click();
  await page.getByRole("dialog").getByText("本月额度已用完").waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await shot("07-quota-dialog", false);
  check("额度弹窗出现且写明联系人", (await page.getByRole("dialog").textContent()).includes("联系"));
}

console.log("7. 设置");
await nav.getByRole("link", { name: "设置" }).click();
await settle(800);
await shot("08-settings");
const quotaFields = page.locator("[data-slot=number-field]");
check("成员每月额度是可自定义的数字框", (await quotaFields.count()) > 0, `${await quotaFields.count()} 个`);

console.log("8. 窄屏 390");
await page.setViewportSize({ width: 390, height: 844 });
for (const url of ["/", "/data"]) {
  await page.goto(`${BASE}${url}`);
  await settle(800);
  const overflow = await page.evaluate(() => {
    const pane = document.querySelector("main")?.parentElement;
    return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, pane ? pane.scrollWidth - pane.clientWidth : 0);
  });
  check(`390 宽 ${url} 无横向溢出`, overflow <= 0, `${overflow}px`);
}
check("390 宽侧栏收起、顶上一行入口与账号菜单", !(await nav.isVisible()) && (await page.getByRole("link", { name: "短链访问数据" }).first().isVisible()) && (await page.getByRole("button", { name: /^账号菜单/ }).first().isVisible()));
await shot("09-data-mobile");
await ctx.close();

// ===== 成员 =====
if (MEMBER) {
  console.log("9. 成员只看得到自己的短链");
  const m = await open(MEMBER);
  await m.page.goto(`${BASE}/data`);
  await m.settle(1200);
  await m.shot("10-member-data");
  check("成员没有「全部 / 我的」切换", (await m.page.getByRole("radio", { name: "全部" }).count()) === 0);
  const res = await m.page.evaluate(async () => (await (await fetch("/api/links?scope=all&page_size=100", { credentials: "include" })).json()).data);
  check("成员的接口即使要 scope=all 也只返回自己创建的", res.items.every((l) => l.creator && l.can_manage), `${res.total} 条`);
  const shown = await m.page.locator("main section [data-slot=card]").count();
  check("成员页面上的短链卡片数 = 自己的短链数", shown === Math.min(res.total, 18), `${shown} / ${res.total}`);
  // 用 Playwright 的请求接口（同一份 cookie）探一次，故意的 403 不进页面控制台
  const status = (await m.page.request.get(`${BASE}/api/groups/x/stats`)).status();
  check("成员拿不到分组的整体数据", status === 403, String(status));
  await m.ctx.close();
}

await browser.close();
console.log(`\n截图目录：${out}`);
const failed = checks.filter((c) => !c.ok);
const realErrors = [...new Set(errors)];
console.log(failed.length ? `\n✗ ${failed.length} 项检查未过` : `\n✓ ${checks.length} 项检查全部通过`);
console.log(realErrors.length ? `⚠️ ${realErrors.length} 条浏览器报错：\n${realErrors.join("\n")}` : "✓ 没有 console / 页面 / HTTP 报错");
if (createdUrl) console.log(`测试短链：${createdUrl}`);
process.exitCode = failed.length || realErrors.length ? 1 : 0;
