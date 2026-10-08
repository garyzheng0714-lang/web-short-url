// 小码（Xiaomark）V2 API 客户端：唯一出口。
// 职责：并发上限、最小间隔、超时、指数退避重试、熔断暂停、调用计数。
// 文档：https://xiaomark.com/help/api （本地快照 docs/xiaomark-api/）

export class XiaomarkError extends Error {
  constructor(message, { code = -1, status = 0, path = "", retryable = false } = {}) {
    super(message);
    this.name = "XiaomarkError";
    this.code = code;
    this.status = status;
    this.path = path;
    this.retryable = retryable;
  }
}

const RETRYABLE_CODES = new Set([-1, -2]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function fmtDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}

/** 把 [start, end] 切成每段 ≤ maxDays 天的区间（小码每日/多维接口单次最多 31 天） */
export function splitDateRange(start, end, maxDays = 31) {
  const out = [];
  let s = start;
  while (s <= end) {
    const e = addDays(s, maxDays - 1);
    out.push([s, e < end ? e : end]);
    s = addDays(e, 1);
  }
  return out;
}

export function createXiaomarkClient({
  apikey,
  baseUrl = "https://api.xiaomark.com",
  concurrency = 2,
  minGapMs = 60,
  timeoutMs = 15000,
  maxRetries = 3,
  backoffMs = 400,
  pauseAfterFailures = 5,
  pauseMs = 60_000,
  fetchImpl = globalThis.fetch,
  log = () => {},
} = {}) {
  if (!apikey) throw new Error("XIAOMARK_API_KEY missing");

  const queue = [];
  let active = 0;
  let lastStart = 0;
  let consecutiveFailures = 0;
  let pausedUntil = 0;
  const stats = { calls: 0, ok: 0, failed: 0, retried: 0, lastCallAt: null, lastError: null, lastErrorAt: null };

  function pump() {
    while (active < concurrency && queue.length) {
      const now = Date.now();
      const wait = Math.max(0, lastStart + minGapMs - now);
      const task = queue.shift();
      active += 1;
      lastStart = now + wait;
      setTimeout(() => {
        task()
          .catch(() => {})
          .finally(() => {
            active -= 1;
            pump();
          });
      }, wait);
    }
  }

  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject));
      pump();
    });
  }

  async function rawPost(path, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey, ...payload }),
        signal: controller.signal,
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new XiaomarkError("上游返回了非 JSON 响应", { status: res.status, path, retryable: res.status >= 500 });
      }
      if (typeof data.code !== "number") {
        throw new XiaomarkError("上游响应缺少 code 字段", { status: res.status, path, retryable: res.status >= 500 });
      }
      if (data.code !== 0) {
        throw new XiaomarkError(data.message || `小码返回码 ${data.code}`, {
          code: data.code,
          status: res.status,
          path,
          retryable: RETRYABLE_CODES.has(data.code) || res.status === 429 || res.status >= 500,
        });
      }
      return data.data ?? {};
    } catch (err) {
      if (err instanceof XiaomarkError) throw err;
      const isAbort = err?.name === "AbortError";
      throw new XiaomarkError(isAbort ? "小码接口超时" : `小码接口网络错误：${err?.message || err}`, {
        status: isAbort ? 504 : 0,
        path,
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function call(path, payload = {}) {
    if (Date.now() < pausedUntil) {
      throw new XiaomarkError(`小码接口连续失败，已暂停到 ${new Date(pausedUntil).toISOString()}`, {
        code: -2,
        status: 503,
        path,
        retryable: true,
      });
    }
    return enqueue(async () => {
      let attempt = 0;
      for (;;) {
        stats.calls += 1;
        stats.lastCallAt = new Date().toISOString();
        try {
          const data = await rawPost(path, payload);
          stats.ok += 1;
          consecutiveFailures = 0;
          return data;
        } catch (err) {
          stats.failed += 1;
          stats.lastError = `${path}: ${err.message}`;
          stats.lastErrorAt = new Date().toISOString();
          if (err.retryable && attempt < maxRetries) {
            attempt += 1;
            stats.retried += 1;
            const backoff = backoffMs * 2 ** attempt + Math.floor(Math.random() * (backoffMs / 2));
            log("warn", `xiaomark retry ${attempt}/${maxRetries} ${path} in ${backoff}ms: ${err.message}`);
            await sleep(backoff);
            continue;
          }
          consecutiveFailures += 1;
          if (consecutiveFailures >= pauseAfterFailures) {
            pausedUntil = Date.now() + pauseMs;
            consecutiveFailures = 0;
            log("error", `xiaomark paused for ${pauseMs}ms after repeated failures`);
          }
          throw err;
        }
      }
    });
  }

  const bool = (v) => (typeof v === "boolean" ? v : undefined);
  const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));

  return {
    call,
    stats: () => ({ ...stats, queued: queue.length, active, pausedUntil: pausedUntil > Date.now() ? new Date(pausedUntil).toISOString() : null }),

    // 元数据
    projects: () => call("/v2/sl/project/get_all").then((d) => d.projects || []),
    groups: (project_id, offset = 0, count = 100) => call("/v2/sl/group/batch_get", { project_id, offset, count }),
    createGroup: (project_id, name) => call("/v2/sl/group/create", { project_id, name }),
    updateGroup: (group_id, name) => call("/v2/sl/group/update", { group_id, name }),
    privateDomains: () => call("/v2/sl/private_domain/get_all").then((d) => d.private_domains || []),
    quota: () => call("/v2/sl/quota/get"),
    whitelist: () => call("/v2/sl/whitelist/get"),

    // 短链
    links: (group_id, offset = 0, count = 100) => call("/v2/sl/link/batch_get", { group_id, offset, count }),
    link: (link_url) => call("/v2/sl/link/get", { link_url }).then((d) => d.link),
    createLink: (p) =>
      call(
        "/v2/sl/link/create",
        compact({
          group_id: p.group_id,
          target_url: p.target_url,
          name: p.name,
          domain: p.domain,
          key: p.key,
          key_length: p.key_length,
          escape_from_wechat: bool(p.escape_from_wechat),
          advanced_bot_detection: bool(p.advanced_bot_detection),
          webhook: bool(p.webhook),
          webhook_scene: p.webhook ? p.webhook_scene : undefined,
        })
      ),
    updateLink: (p) =>
      call(
        "/v2/sl/link/update",
        compact({
          link_url: p.link_url,
          target_url: p.target_url,
          name: p.name,
          escape_from_wechat: bool(p.escape_from_wechat),
          advanced_bot_detection: bool(p.advanced_bot_detection),
          webhook: bool(p.webhook),
          webhook_scene: p.webhook_scene,
        })
      ),
    suspendLinks: (link_url_list) => call("/v2/sl/link/batch_suspend", { link_url_list }),
    resumeLinks: (link_url_list) => call("/v2/sl/link/batch_resume", { link_url_list }),

    // 短链统计
    linkOverall: (link_url, exclude_bot = true) => call("/v2/sl/link/overall_stats/get", { link_url, exclude_bot }),
    linkDaily: (link_url, start_date, end_date, exclude_bot = true) =>
      call("/v2/sl/link/daily_stats/get", { link_url, start_date, end_date, exclude_bot }),
    linkChart: (link_url, start_date, end_date, exclude_bot = true) =>
      call("/v2/sl/link/chart_stats/get", { link_url, start_date, end_date, exclude_bot }),
    linkRecords: (link_url, { start_date, end_date, offset = 0, count = 20, exclude_bot = true } = {}) =>
      call("/v2/sl/link/visit_record/batch_get", compact({ link_url, start_date, end_date, offset, count, exclude_bot })),

    // 分组统计
    groupOverall: (group_id, exclude_bot = true) => call("/v2/sl/group/overall_stats/get", { group_id, exclude_bot }),
    groupDaily: (group_id, start_date, end_date, exclude_bot = true) =>
      call("/v2/sl/group/daily_stats/get", { group_id, start_date, end_date, exclude_bot }),
    groupChart: (group_id, start_date, end_date, exclude_bot = true) =>
      call("/v2/sl/group/chart_stats/get", { group_id, start_date, end_date, exclude_bot }),
    groupRecords: (group_id, { start_date, end_date, offset = 0, count = 20, exclude_bot = true } = {}) =>
      call("/v2/sl/group/visit_record/batch_get", compact({ group_id, start_date, end_date, offset, count, exclude_bot })),
  };
}
