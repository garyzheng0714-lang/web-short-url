import { test } from "node:test";
import assert from "node:assert/strict";
import { createXiaomarkClient, XiaomarkError, splitDateRange, addDays } from "../lib/xiaomark.js";

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

test("splitDateRange 把区间切成不超过 31 天的连续窗口", () => {
  const windows = splitDateRange("2026-01-01", "2026-03-05", 31);
  assert.deepEqual(windows, [
    ["2026-01-01", "2026-01-31"],
    ["2026-02-01", "2026-03-03"],
    ["2026-03-04", "2026-03-05"],
  ]);
  assert.deepEqual(splitDateRange("2026-05-10", "2026-05-10"), [["2026-05-10", "2026-05-10"]]);
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
});

test("业务返回码为 -2 时重试，成功后返回 data 并计数", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) return jsonResponse({ code: -2, message: "系统繁忙", data: {} }, 503);
    return jsonResponse({ code: 0, message: "请求成功", data: { link_quota: 7 } });
  };
  const xm = createXiaomarkClient({ apikey: "k", fetchImpl, backoffMs: 1, minGapMs: 0 });
  const data = await xm.quota();
  assert.deepEqual(data, { link_quota: 7 });
  assert.equal(calls, 3);
  assert.equal(xm.stats().retried, 2);
  assert.equal(xm.stats().ok, 1);
});

test("业务错误（短链无效 3330）不重试，抛出带 code 的 XiaomarkError", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ code: 3330, message: "短链无效", data: {} }, 400);
  };
  const xm = createXiaomarkClient({ apikey: "k", fetchImpl, backoffMs: 1, minGapMs: 0 });
  await assert.rejects(() => xm.link("https://t.fbif.com/x"), (err) => err instanceof XiaomarkError && err.code === 3330 && err.retryable === false);
  assert.equal(calls, 1);
});

test("连续失败达到阈值后熔断，后续调用立即被拒绝", async () => {
  const fetchImpl = async () => jsonResponse({ code: 1, message: "apikey未授权", data: {} }, 401);
  const xm = createXiaomarkClient({ apikey: "k", fetchImpl, backoffMs: 1, minGapMs: 0, pauseAfterFailures: 2, pauseMs: 60_000 });
  await assert.rejects(() => xm.projects());
  await assert.rejects(() => xm.projects());
  const before = xm.stats().calls;
  await assert.rejects(() => xm.projects(), (err) => err.status === 503 && /暂停/.test(err.message));
  assert.equal(xm.stats().calls, before, "熔断期间不再打上游");
  assert.ok(xm.stats().pausedUntil);
});

test("请求体带 apikey，createLink 丢弃空字段并在 webhook 关闭时不传场景值", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return jsonResponse({ code: 0, message: "ok", data: { link_url: "https://t.fbif.com/abcd" } });
  };
  const xm = createXiaomarkClient({ apikey: "secret", fetchImpl, minGapMs: 0 });
  await xm.createLink({ group_id: "g1", target_url: "https://fbif.com", name: "", domain: "t.fbif.com", key: "", key_length: 4, webhook: false, webhook_scene: "x", advanced_bot_detection: true });
  assert.equal(bodies[0].apikey, "secret");
  assert.equal(bodies[0].group_id, "g1");
  assert.equal("name" in bodies[0], false);
  assert.equal("key" in bodies[0], false);
  assert.equal("webhook_scene" in bodies[0], false);
  assert.equal(bodies[0].advanced_bot_detection, true);
  assert.equal(bodies[0].webhook, false);
});

test("并发上限生效：同时只会有 concurrency 个请求在飞", async () => {
  let inflight = 0;
  let peak = 0;
  const fetchImpl = async () => {
    inflight += 1;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 15));
    inflight -= 1;
    return jsonResponse({ code: 0, message: "ok", data: {} });
  };
  const xm = createXiaomarkClient({ apikey: "k", fetchImpl, concurrency: 2, minGapMs: 0 });
  await Promise.all(Array.from({ length: 8 }, () => xm.quota()));
  assert.equal(peak, 2);
});
