#!/usr/bin/env node
// 真实浏览器走查：本机 Chrome 走一遍侧栏与账号菜单、生成短链页、仪表盘（指标卡、每日访问卡、排行卡）、短链访问数据（纯列表、分组列表、抽屉）、设置、窄屏，
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
const btn = page.getByRole("button", { name: "生成", exact: true });
const btnBox = await box(btn);
check("输入框与按钮同高", Math.abs(input.height - btnBox.height) <= 0.5, `${input.height} / ${btnBox.height}`);
check("输入框与按钮顶边对齐", Math.abs(input.y - btnBox.y) <= 0.5, `${input.y} / ${btnBox.y}`);
const mainBox = await box(page.locator("main"));
const leftGap = input.x - mainBox.x;
const rightGap = mainBox.x + mainBox.width - (btnBox.x + btnBox.width);
check("输入组水平居中、宽不超过 672", Math.abs(leftGap - rightGap) <= 1.5 && btnBox.x + btnBox.width - input.x <= 672.5, `左 ${leftGap} 右 ${rightGap} 宽 ${btnBox.x + btnBox.width - input.x}`);
const heading = page.getByRole("heading", { name: "生成短链" });
const headBox = await box(heading);
check("标题、输入组同一条中轴", Math.abs(headBox.x + headBox.width / 2 - (input.x + (btnBox.x + btnBox.width - input.x) / 2)) <= 1.5);
check("按钮只写动词，不复述标题", (await btn.textContent()).trim() === "生成" && (await heading.textContent()).trim() === "生成短链");
const pane = await page.evaluate(() => { const r = document.querySelector("main").parentElement.getBoundingClientRect(); return { top: r.top, height: r.height }; });
const centerRatio = (input.y + input.height / 2 - pane.top) / pane.height;
check("输入组落在主区视觉中心略偏上", centerRatio > 0.35 && centerRatio < 0.6, `${Math.round(centerRatio * 100)}%`);
check("生成页只有输入框和按钮：没有用量行、没有列表与搜索", (await page.getByText(/本月已生成/).count()) === 0 && (await page.locator("main [data-slot=search-field], main table, main [data-slot=card]").count()) === 0);
const btnBg = await btn.evaluate((el) => getComputedStyle(el).getPropertyValue("--btn-bg").trim().toLowerCase());
check("主按钮是强调色（Notion 蓝）", btnBg === ACCENT, btnBg);
check("站名是「短链生成工具」", (await nav.textContent()).includes("短链生成工具"));
const navLinks = (await nav.getByRole("link").allTextContents()).map((t) => t.trim());
check("侧栏四项：生成短链、仪表盘、短链访问数据、设置", ["生成短链", "仪表盘", "短链访问数据", "设置"].every((t) => navLinks.some((x) => x.includes(t))), navLinks.join(" / "));
check("侧栏当前项是「生成短链」", (await nav.getByRole("link", { name: "生成短链" }).getAttribute("aria-current")) === "page");
check("侧栏上没有直接摆的退出按钮", (await nav.getByRole("button", { name: "退出登录" }).count()) === 0);
const avatarBox = await box(nav.getByRole("button", { name: /^账号菜单/ }));
const navBox = await box(nav);
check("账号行在侧栏底部", avatarBox.y + avatarBox.height > navBox.y + navBox.height - 80, `y ${avatarBox.y}`);
const accountText = (await nav.getByRole("button", { name: /^账号菜单/ }).textContent()) || "";
check("账号行不只是头像：有名字和身份", avatarBox.width > 150 && /管理员|成员/.test(accountText), accountText.trim());
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
  const firstRow = (await page.locator("main ul[aria-label=短链] > li").first().textContent()) || "";
  check("新短链是数据页列表第一行", createdUrl && firstRow.includes(createdUrl.split("/").pop()), firstRow.slice(0, 40));
}

console.log("3. 仪表盘");
await nav.getByRole("link", { name: "仪表盘" }).click();
await settle(1200);
check("侧栏切到「仪表盘」", page.url().endsWith("/dashboard") && (await nav.getByRole("link", { name: "仪表盘" }).getAttribute("aria-current")) === "page", page.url().replace(BASE, ""));
await page.locator("main svg").first().waitFor({ timeout: 20000 });
await page.locator("main ul[aria-label=访问最多的短链] > li").first().waitFor({ timeout: 20000 });
await shot("03-dashboard");
const kpis = page.getByRole("group", { name: "概览" }).locator("[data-slot=card]");
check("四张指标卡", (await kpis.count()) === 4);
const h1 = await box(page.getByRole("heading", { name: "仪表盘" }));
const kpiBoxes = await Promise.all([0, 1, 2, 3].map((i) => kpis.nth(i).boundingBox()));
const rangeSeg = await box(page.locator("header [data-slot=segmented]").last());
check("标题与第一张指标卡左缘同线", Math.abs(h1.x - kpiBoxes[0].x) <= 1.5, `${h1.x} / ${kpiBoxes[0].x}`);
check("时间切换与最后一张指标卡右缘同线", Math.abs(rangeSeg.x + rangeSeg.width - (kpiBoxes[3].x + kpiBoxes[3].width)) <= 1.5, `${rangeSeg.x + rangeSeg.width} / ${kpiBoxes[3].x + kpiBoxes[3].width}`);
check("指标卡同高同顶", kpiBoxes.every((b) => Math.abs(b.y - kpiBoxes[0].y) <= 0.5 && Math.abs(b.height - kpiBoxes[0].height) <= 0.5));
const rankLinks = page.locator("main ul[aria-label=访问最多的短链]");
const rankGroups = page.locator("main ul[aria-label=分组]");
const [rl, rg] = [await box(rankLinks), await box(rankGroups)];
check("两张排行卡并排", Math.abs(rl.y - rg.y) <= 1 && rg.x > rl.x, `y ${rl.y} / ${rg.y}`);
check("排行有数据", (await rankLinks.locator("> li").count()) > 0 && (await rankGroups.locator("> li").count()) > 0);
await rankLinks.locator("> li button").first().click();
const dialog = page.getByRole("dialog");
await dialog.getByText("每日访问").first().waitFor({ timeout: 20000 });
check("点排行开短链抽屉", /[?&]link=\d+/.test(page.url()), page.url().replace(BASE, ""));
await page.keyboard.press("Escape");
await page.waitForTimeout(600);

console.log("4. 短链访问数据：纯列表");
await nav.getByRole("link", { name: "短链访问数据" }).click();
await settle(1200);
check("侧栏切到「短链访问数据」", page.url().endsWith("/data") && (await nav.getByRole("link", { name: "短链访问数据" }).getAttribute("aria-current")) === "page", page.url().replace(BASE, ""));
const list = page.locator("main ul[aria-label=短链]");
const rows = list.locator("> li");
await rows.first().waitFor({ timeout: 20000 });
await shot("04-data-list");
check("列表页没有指标卡与图表", (await page.getByRole("group", { name: "概览" }).count()) === 0 && (await page.locator("main [data-slot=card]").count()) === 0);
check("短链以列表呈现", (await rows.count()) > 0, `${await rows.count()} 行`);
const listBg = await list.evaluate((el) => getComputedStyle(el).backgroundColor);
check("列表是一块实色面（不是透明）", listBg !== "rgba(0, 0, 0, 0)" && listBg !== "transparent", listBg);
const rowBoxes = await Promise.all([0, 1, 2].map((i) => rows.nth(i).boundingBox()));
check("列表行等高、左右缘对齐", rowBoxes.every((b) => Math.abs(b.height - rowBoxes[0].height) <= 0.5 && Math.abs(b.x - rowBoxes[0].x) <= 0.5 && Math.abs(b.width - rowBoxes[0].width) <= 0.5));
const lb = await box(list);
const dh1 = await box(page.getByRole("heading", { name: "短链访问数据" }));
const searchBox = await box(page.locator("[data-slot=search-field]").first());
check("标题与列表左缘同线、搜索框与列表右缘同线", Math.abs(dh1.x - lb.x) <= 1.5 && Math.abs(searchBox.x + searchBox.width - (lb.x + lb.width)) <= 1.5, `左 ${dh1.x}/${lb.x} 右 ${searchBox.x + searchBox.width}/${lb.x + lb.width}`);
const pills = await rows.evaluateAll((els) => els.slice(0, 6).map((el) => { const r = el.querySelector("[data-part=visits]")?.getBoundingClientRect(); return r ? Math.round(r.right) : null; }));
check("访问次数右缘同线", pills.every((x) => x !== null && Math.abs(x - pills[0]) <= 1), pills.join(" / "));

console.log("5. 详情抽屉");
await rows.first().locator("button[aria-label^=查看]").click();
await dialog.getByText("每日访问").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
check("打开抽屉后地址带 ?link=", /[?&]link=\d+/.test(page.url()), page.url().replace(BASE, ""));
check("抽屉宽度 ≥ 640", ((await box(dialog))?.width || 0) >= 640, String((await box(dialog))?.width));
const actions = ["复制短链", "二维码", "更多操作"];
check("抽屉动作只有复制、二维码和「更多」", (await Promise.all(actions.map((n) => dialog.getByRole("button", { name: n }).count()))).every((c) => c === 1) && (await dialog.getByRole("button", { name: "打开短链" }).count()) === 0);
check("抽屉属性是一张标签 · 值的小表", (await dialog.locator("dl dt").count()) >= 3);
check("指标名里不重复时间范围", (await dialog.getByRole("group", { name: "指标" }).textContent()).includes("近 30 天") === false);
await shot("05-link-drawer", false);
await dialog.getByRole("button", { name: "更多操作" }).click();
await page.getByRole("menuitem", { name: "查看跳转链路" }).waitFor({ timeout: 5000 });
check("「更多」里有打开、跳转链路等", (await page.getByRole("menuitem", { name: "打开短链" }).count()) === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
check("Esc 关闭后地址去掉 link", !/[?&]link=/.test(page.url()), page.url().replace(BASE, ""));

console.log("6. 分组列表与分组抽屉");
await page.getByRole("radio", { name: "分组" }).click();
await settle();
const groupRows = page.locator("main ul[aria-label=分组] > li");
await groupRows.first().waitFor();
check("分组以列表呈现", (await groupRows.count()) > 0, `${await groupRows.count()} 行`);
await shot("06-groups");
await groupRows.first().locator("button[aria-label^=查看]").click();
await dialog.getByText("每日访问").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await shot("07-group-drawer", false);
await dialog.getByRole("button", { name: "查看组内短链" }).click();
await settle();
check("「查看组内短链」切回短链列表并按分组筛选", /[?&]group=/.test(page.url()) && !/view=groups/.test(page.url()), page.url().replace(BASE, ""));

if (QUOTA) {
  console.log("6b. 额度用完弹窗");
  await page.goto(`${BASE}/`);
  await settle();
  await page.locator("[data-slot=input-shell] input").first().click();
  await page.keyboard.type("https://www.fbif.com/?quota-check");
  await page.getByRole("button", { name: "生成", exact: true }).click();
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
for (const url of ["/", "/dashboard", "/data"]) {
  await page.goto(`${BASE}${url}`);
  await settle(800);
  const overflow = await page.evaluate(() => {
    const pane = document.querySelector("main")?.parentElement;
    return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, pane ? pane.scrollWidth - pane.clientWidth : 0);
  });
  check(`390 宽 ${url} 无横向溢出`, overflow <= 0, `${overflow}px`);
}
check("390 宽侧栏收起、顶上一行入口与账号菜单", !(await nav.isVisible()) && (await page.getByRole("link", { name: "仪表盘" }).first().isVisible()) && (await page.getByRole("button", { name: /^账号菜单/ }).first().isVisible()));
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
  const shown = await m.page.locator("main ul[aria-label=短链] > li").count();
  check("成员页面上的短链行数 = 自己的短链数", shown === Math.min(res.total, 20), `${shown} / ${res.total}`);
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
