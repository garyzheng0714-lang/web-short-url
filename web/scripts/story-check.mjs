#!/usr/bin/env node
// 首页短链图解的逐格走查（onetake 的验法）：暂停后用 seek 定格，检查每处衔接留下了什么、主体是否出框、动静比例与镜头长短差，
// 并出一张逐格拼图和每步的定格截图；--video 另逐帧渲染一圈 MP4（要本机 ffmpeg）。
// 用法：SESSION_TOKEN=<token> BASE_URL=http://127.0.0.1:3000 node scripts/story-check.mjs [--video]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.SESSION_TOKEN;
if (!TOKEN) throw new Error("SESSION_TOKEN missing");
const VIDEO = process.argv.includes("--video");
const RUN = process.env.RUN_ID || `story-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".ui-check", RUN);
fs.mkdirSync(out, { recursive: true });

const CYCLE = 16;
const FPS = 30;
// 每处衔接：动作的起止，以及两侧都必须看得见的部件（data-part）
const BOUNDARIES = [
  { name: "发送：输入栏的字 → 气泡", at: [1.9, 2.45], before: ["chat"], after: ["chat", "message"] },
  { name: "收短：同一个气泡", at: [4.4, 4.9], before: ["message", "bubble"], after: ["message", "bubble", "short-link"] },
  { name: "镜头左移", at: [6.6, 7.45], before: ["chat", "short-link"], after: ["chat", "short-link", "page"] },
  { name: "拉线：短链 → 报名表", at: [7.45, 8.05], before: ["short-link", "page"], after: ["short-link", "page", "route"] },
  { name: "重发新链接", at: [9.1, 9.45], before: ["short-link", "route", "page"], after: ["short-link", "route", "page", "resend"] },
  { name: "收回重发、改跳转、换版", at: [11.4, 12.2], before: ["short-link", "route", "page"], after: ["short-link", "route", "page"] },
  { name: "客户再点一次", at: [12.5, 13.35], before: ["short-link", "route", "page"], after: ["short-link", "route", "page"] },
  { name: "一圈结束回到起点", at: [14.6, 15.5], before: ["chat"], after: ["chat"] },
];

const errors = [];
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `：${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function run(width, height, tag, { colorScheme = "light" } = {}) {
  console.log(`\n${tag}（${width}×${height}，${colorScheme}）`);
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "zh-CN", timezoneId: "Asia/Shanghai", deviceScaleFactor: 2, colorScheme });
  await ctx.addCookies([{ name: "shorturl_session", value: TOKEN, domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`${BASE}/`);
  // 应用还没接系统主题：深色这一轮直接挂 Su 的 data-theme，确认图解只用了语义色
  if (colorScheme === "dark") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const stage = page.locator("[data-slot=short-link-story] > [role=img]");
  await stage.waitFor({ timeout: 20000 });
  await stage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  check("进入视口后动画在跑", (await stage.getAttribute("data-running")) !== null);
  await page.getByRole("button", { name: "暂停动画" }).click();
  await page.waitForTimeout(1500);
  check("暂停后帧循环睡下", (await stage.getAttribute("data-running")) === null);

  // 定格采样：每帧记下各部件是否可见（自身与祖先的透明度连乘 > .5）、是否在舞台内，以及所有被帧循环写过的元素的位置与透明度
  const sample = (t) =>
    stage.evaluate((root, t) => {
      root.seek(t);
      const rb = root.getBoundingClientRect();
      const op = (el) => {
        let o = 1;
        for (let n = el; n && n !== root; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
        return o;
      };
      const parts = {};
      for (const el of root.querySelectorAll("[data-part]")) {
        const b = el.getBoundingClientRect();
        const visible = op(el) > 0.5 && b.width > 0 && b.height > 0;
        const inFrame = b.left >= rb.left - 1 && b.right <= rb.right + 1;
        parts[el.dataset.part] = { visible, inFrame };
      }
      const motion = [...root.querySelectorAll("[style], path, circle")].flatMap((el) => {
        const b = el.getBoundingClientRect();
        return [b.x, b.y, b.width, b.height, Number(getComputedStyle(el).opacity) * 100];
      });
      return { parts, motion };
    }, t);

  const frames = [];
  for (let i = 0; i < CYCLE * FPS; i++) frames.push(await sample(i / FPS));

  // 衔接：动作开始前 .15 秒与结束后 .15 秒，指定部件都看得见
  for (const b of BOUNDARIES) {
    const pre = frames[Math.round((b.at[0] - 0.15) * FPS)].parts;
    const post = frames[Math.round((b.at[1] + 0.15) * FPS) % frames.length].parts;
    const miss = [...b.before.filter((p) => !pre[p]?.visible).map((p) => `前缺 ${p}`), ...b.after.filter((p) => !post[p]?.visible).map((p) => `后缺 ${p}`)];
    const carried = b.before.filter((p) => b.after.includes(p) && pre[p]?.visible && post[p]?.visible);
    check(`衔接「${b.name}」有东西留下`, miss.length === 0 && carried.length > 0, miss.join("、") || `留下 ${carried.join("、")}`);
  }
  // 出框：看得见的部件都在舞台里
  const out_ = frames.flatMap((f, i) => Object.entries(f.parts).filter(([, p]) => p.visible && !p.inFrame).map(([k]) => `${(i / FPS).toFixed(2)}s ${k}`));
  check("主体不出框", out_.length === 0, out_.slice(0, 4).join("、"));
  // 节奏：相邻两帧的总位移 < .5 算静止；连续的动 / 静段长短
  const delta = frames.map((f, i) => {
    const g = frames[(i + 1) % frames.length].motion;
    return f.motion.reduce((s, v, k) => s + Math.abs(v - (g[k] ?? v)), 0);
  });
  const still = delta.map((d) => d < 0.5);
  const ratio = still.filter(Boolean).length / still.length;
  const runs = [];
  for (let i = 0, start = 0; i <= still.length; i++) {
    if (i === still.length || (i > 0 && still[i] !== still[i - 1])) {
      if (i > start) runs.push({ still: still[start], len: (i - start) / FPS });
      start = i;
    }
  }
  const lens = runs.map((r) => r.len).filter((l) => l >= 2 / FPS);
  const spread = Math.max(...lens) / Math.min(...lens);
  check("静止占三成以上", ratio >= 0.3, `${Math.round(ratio * 100)}%`);
  check("镜头长短差 4 倍以上", spread >= 4, `${runs.length} 段，最长 / 最短 = ${spread.toFixed(1)}`);
  fs.writeFileSync(path.join(out, `${tag}-rhythm.json`), JSON.stringify({ stillRatio: ratio, runs }, null, 2));

  // 逐格拼图：每 .5 秒一格（先滚到正中，免得吸顶栏压住画面）
  await stage.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const cells = [];
  for (let t = 0; t < CYCLE; t += 0.5) {
    await stage.evaluate((root, t) => root.seek(t), t);
    cells.push({ t, src: `data:image/png;base64,${(await stage.screenshot()).toString("base64")}` });
  }
  const sheet = await ctx.newPage();
  const cols = width >= 700 ? 4 : 8;
  await sheet.setViewportSize({ width: 1600, height: 900 });
  await sheet.setContent(
    `<body style="margin:0;padding:16px;background:#f9f8f7;font:12px system-ui"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px">${cells
      .map((c) => `<figure style="margin:0"><img src="${c.src}" style="width:100%;display:block;border:1px solid #e5e3e0;border-radius:8px"><figcaption style="padding-top:4px;color:#636363">${c.t.toFixed(1)}s</figcaption></figure>`)
      .join("")}</div></body>`,
  );
  await sheet.waitForTimeout(300);
  await sheet.screenshot({ path: path.join(out, `${tag}-contact-sheet.png`), fullPage: true });
  await sheet.close();
  console.log(`  📷 ${tag}-contact-sheet.png`);

  // 每步的定格（点步骤按钮；暂停时停在代表画面）
  const stepButtons = page.locator("[data-slot=story-steps] button");
  const n = await stepButtons.count();
  await page.locator("[data-slot=short-link-story]").evaluate((el) => el.scrollIntoView({ block: "center" }));
  for (let i = 0; i < n; i++) {
    await stepButtons.nth(i).click();
    await page.waitForTimeout(150);
    await page.locator("[data-slot=short-link-story]").screenshot({ path: path.join(out, `${tag}-step-${i + 1}.png`) });
  }
  console.log(`  📷 ${tag}-step-1…${n}.png`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("页面没有横向溢出", overflow <= 0, `${overflow}px`);
  await ctx.close();
}

await run(1440, 900, "wide");
await run(390, 844, "narrow");
await run(1440, 900, "dark", { colorScheme: "dark" });

// 减少动态：不跑，停在第 4 步的静止画面（报名表新版、线连着）；点步骤换画面
{
  console.log("\n减少动态");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", reducedMotion: "reduce", deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "shorturl_session", value: TOKEN, domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`${BASE}/`);
  const fig = page.locator("[data-slot=short-link-story]");
  await fig.waitFor({ timeout: 20000 });
  await fig.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(800);
  const stage = fig.locator("> [role=img]");
  const visible = (part) => stage.evaluate((root, part) => Number(getComputedStyle(root.querySelector(`[data-part=${part}]`)).opacity) > 0.5, part);
  check("减少动态时不跑", (await stage.getAttribute("data-running")) === null);
  check("静止画面是第 4 步：报名表与线都在", (await visible("page")) && (await visible("route")));
  await fig.locator("[data-slot=story-steps] button").first().click();
  await page.waitForTimeout(200);
  check("点第 1 步换成长链接画面", !(await visible("page")) && (await visible("message")));
  await fig.screenshot({ path: path.join(out, "reduced-step-1.png") });
  await ctx.close();
}

if (VIDEO) {
  // 逐帧定格渲染（同一时刻同一画面）：30fps 一整圈，用本机 ffmpeg 合成 MP4
  console.log("\n渲染一圈视频");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "zh-CN", deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "shorturl_session", value: TOKEN, domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const fig = page.locator("[data-slot=short-link-story]");
  await fig.waitFor({ timeout: 20000 });
  await fig.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.getByRole("button", { name: "暂停动画" }).click();
  await page.waitForTimeout(1200);
  const dir = path.join(out, "frames");
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < CYCLE * FPS; i++) {
    await fig.locator("> [role=img]").evaluate((root, t) => root.seek(t), i / FPS);
    await fig.screenshot({ path: path.join(dir, `${String(i).padStart(4, "0")}.png`) });
  }
  await ctx.close();
  const { execFileSync } = await import("node:child_process");
  const mp4 = path.join(out, "story.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "%04d.png"), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", mp4]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`  🎞 ${path.relative(process.cwd(), mp4)}`);
}

await browser.close();
for (const e of errors) console.log(`  ! ${e}`);
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过，报错 ${errors.length} 条 → ${path.relative(process.cwd(), out)}`);
process.exit(failed.length || errors.length ? 1 : 0);
