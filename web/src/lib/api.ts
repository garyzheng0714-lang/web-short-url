import { redirectToLogin, sessionFetch } from "./session";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await sessionFetch(path, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError("未登录", "unauthorized", 401);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.ok === false) {
    const err = body?.error || {};
    throw new ApiError(err.message || `请求失败（${res.status}）`, err.code || "request_failed", res.status);
  }
  return body.data as T;
}

const qs = (params: object) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
};

// ---------- 类型 ----------
export type LinkStatus = "active" | "suspended" | "banned" | "missing";
export interface Person {
  open_id: string;
  name: string;
  avatar_url: string | null;
}
export interface LinkItem {
  id: number;
  link_url: string;
  domain: string;
  key: string;
  group_id: string | null;
  group_name: string;
  name: string;
  target_url: string;
  created_at: string | null;
  flags: { escape_from_wechat: boolean; advanced_bot_detection: boolean; webhook: boolean; webhook_scene: string };
  status: LinkStatus;
  creator: Person | null;
  source: string;
  stats: { visit_count: number; visitor_count: number; ip_count: number; fetched_at: string | null };
  can_manage: boolean;
  is_mine: boolean;
}
export interface Usage {
  used: number;
  limit: number;
  remaining: number;
  month: string;
  contact: string;
}
export interface Member {
  open_id: string;
  name: string;
  avatar_url: string | null;
  is_admin: boolean;
  tenant_key: string;
  monthly_quota: number | null;
  used_this_month: number;
  limit: number;
}
export interface GroupMeta {
  id: string;
  name: string;
  project_id: string;
  total_links: number;
  owner_open_id: string | null;
  owner_name: string | null;
  link_count: number;
}
export interface Bootstrap {
  user: { open_id: string; feishu_open_id: string; name: string; avatar_url: string | null; tenant_key: string; is_admin: boolean };
  settings: { default_domain: string; default_group_id: string; exclude_bot: boolean };
  domains: { domain: string; ssl: boolean }[];
  default_domain_fallback: string;
  groups: GroupMeta[];
  projects: { id: string; name: string }[];
  defaults: { key_length: number; advanced_bot_detection: boolean; webhook: boolean; escape_from_wechat: boolean };
  quota: { link_quota: number } | null;
  usage: Usage;
  sync: { links: { total: number; live: number; with_stats: number; pending_stats: number; attributed: number } | null; inventory_at: string | null; pending_stats: number };
  today: string;
}
export interface DailyPoint {
  date: string;
  visit_count: number;
  visitor_count: number;
  ip_count: number;
  visited_link_count?: number;
  created_link_count?: number;
}
export interface Chart {
  new_visitor_count: number;
  hour_stats: { hour: number; count: number; visit_count?: number }[];
  top_ip_stats: { ip: string; count: number }[];
  top_referer_stats: { referer: string; count: number }[];
  world_stats: { country_code: string; country: string; count: number }[];
  china_stats: { region: string; count: number }[];
  browser_stats: { browser: string; count: number }[];
  os_stats: { os: string; count: number }[];
  device_stats: { device: string; count: number }[];
  network_stats: { network: string; count: number }[];
  _cached_at?: string;
}
export interface LinkStats {
  range: { start: string; end: string; days: number };
  exclude_bot: boolean;
  totals: { visit_count: number; visitor_count: number; ip_count: number; fetched_at: string | null };
  period: { visit_count: number; visitor_count: number; ip_count: number };
  daily: DailyPoint[];
  chart: Chart;
  realtime: { events: number; last_visit_at: string | null };
}
export interface VisitRecord {
  id: string;
  visited_at: string;
  ip: string;
  referer: string;
  target_url: string;
  z: string;
  new_visitor: boolean;
  country: string;
  region: string;
  city: string;
  is_robot: boolean;
  browser: string;
  os: string;
  device: string;
  network: string;
  user_agent: string;
}
export interface Overview {
  scope: "all" | "mine";
  group: string | null;
  range: { start: string; end: string; days: number };
  kpi: {
    total_links: number;
    visited_links: number;
    visits_total: number;
    visitors_total: number;
    created_7d: number;
    oldest_stats_at: string | null;
    period_visits: number;
    period_visitors: number;
    today_visits: number;
    today_visitors: number;
  };
  previous: { visit_count: number; visitor_count: number; start: string; end: string } | null;
  series: DailyPoint[];
  series_note: string | null;
  top_links: LinkItem[];
  recent_links: LinkItem[];
  recent_events: { visited_at: string; link_url: string; link_id: number | null; link_name: string | null; city: string | null; device: string | null; browser: string | null; referer: string | null }[];
}
export interface GroupItem {
  id: string;
  project_id: string;
  name: string;
  created_at: string | null;
  owner: Person | null;
  total_links: number;
  link_count: number;
  visited_links: number;
  visits: number;
  visitors: number;
  latest_created_at: string | null;
  is_mine: boolean;
}
export interface GroupStats {
  group: { id: string; name: string; owner_open_id: string | null };
  range: { start: string; end: string; days: number };
  exclude_bot: boolean;
  totals: { visit_count: number; visitor_count: number; ip_count: number; visited_link_count: number; created_link_count: number };
  period: { visit_count: number; visitor_count: number; ip_count: number };
  daily: DailyPoint[];
  chart: Chart;
}
export interface SyncStatus {
  running: string[];
  inventory_full_at: string | null;
  inventory_at: string | null;
  counts: { total: number; live: number; with_stats: number; pending_stats: number; attributed: number };
  events: { n: number; last: number | null };
  last_runs: { job: string; started_at: string; finished_at: string | null; ok: number | null; items: number; calls: number; error: string | null }[];
  client: { calls: number; ok: number; failed: number; retried: number; lastCallAt: string | null; lastError: string | null; lastErrorAt: string | null; queued: number; active: number; pausedUntil: string | null };
  scheduler: { active: boolean; tick_ms: number };
}

export interface ListLinksParams {
  scope?: "all" | "mine";
  group?: string;
  domain?: string;
  status?: string;
  creator?: string;
  q?: string;
  sort?: "created" | "created_asc" | "visits" | "visitors";
  page?: number;
  page_size?: number;
}
export interface ListLinksResult {
  items: LinkItem[];
  page: number;
  page_size: number;
  total: number;
  summary: { visits: number; visited_links: number };
}
export interface CreateLinkBody {
  target_url: string;
  group_id: string;
  domain?: string;
  name?: string;
  key?: string;
  key_length?: number;
  escape_from_wechat?: boolean;
  advanced_bot_detection?: boolean;
  webhook?: boolean;
}
export type RangeParams = { range?: "7d" | "30d" | "90d"; start?: string; end?: string; bot?: "exclude" | "include" };

// ---------- 调用 ----------
export const api = {
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  listLinks: (p: ListLinksParams) => request<ListLinksResult>(`/api/links${qs(p)}`),
  trends: (ids: number[]) => request<{ start: string; end: string; trends: Record<string, number[]> }>(`/api/links/trends?ids=${ids.join(",")}`),
  createLink: (body: CreateLinkBody) => request<{ link: LinkItem; usage: Usage }>("/api/links", { method: "POST", body: JSON.stringify(body) }),
  usage: () => request<Usage>("/api/usage"),
  getLink: (id: number) => request<{ link: LinkItem }>(`/api/links/${id}`),
  updateLink: (id: number, patch: Partial<{ name: string; target_url: string; escape_from_wechat: boolean; advanced_bot_detection: boolean; webhook: boolean }>) =>
    request<{ link: LinkItem }>(`/api/links/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  suspendLink: (id: number) => request<{ link: LinkItem }>(`/api/links/${id}/suspend`, { method: "POST" }),
  resumeLink: (id: number) => request<{ link: LinkItem }>(`/api/links/${id}/resume`, { method: "POST" }),
  claimLink: (id: number, open_id?: string | null) => request<{ link: LinkItem }>(`/api/links/${id}/claim`, { method: "POST", body: JSON.stringify(open_id === undefined ? {} : { open_id }) }),
  linkStats: (id: number, p: RangeParams) => request<LinkStats>(`/api/links/${id}/stats${qs(p)}`),
  linkVisits: (id: number, p: RangeParams & { page?: number; page_size?: number }) => request<{ range: { start: string; end: string }; page: number; page_size: number; total: number; items: VisitRecord[] }>(`/api/links/${id}/visits${qs(p)}`),
  overview: (p: { scope?: "all" | "mine"; group?: string } & RangeParams) => request<Overview>(`/api/overview${qs(p)}`),
  groups: () => request<{ items: GroupItem[] }>("/api/groups"),
  createGroup: (name: string, project_id?: string) => request<{ group: { id: string; name: string; project_id: string } }>("/api/groups", { method: "POST", body: JSON.stringify({ name, project_id }) }),
  groupStats: (id: string, p: RangeParams) => request<GroupStats>(`/api/groups/${encodeURIComponent(id)}/stats${qs(p)}`),
  updateGroup: (id: string, patch: { owner_open_id?: string | null; name?: string }) => request<{ group: { id: string; name: string; owner: Person | null } }>(`/api/groups/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  users: () => request<{ default_monthly_quota: number; items: Member[] }>("/api/users"),
  updateUser: (openId: string, patch: { monthly_quota: number | null }) => request<Usage & { open_id: string; monthly_quota: number | null }>(`/api/users/${encodeURIComponent(openId)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  settings: () => request<{ settings: Bootstrap["settings"] }>("/api/settings"),
  saveSettings: (s: Partial<Bootstrap["settings"]>) => request<{ settings: Bootstrap["settings"] }>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  syncStatus: () => request<SyncStatus>("/api/admin/sync"),
  runSync: (job: "inventory" | "inventory_full" | "totals") => request<{ started: string }>("/api/admin/sync/run", { method: "POST", body: JSON.stringify({ job }) }),
  quota: () => request<{ quota: { link_quota: number }; whitelist: { domains: string[]; max_whitelist_size: number; available_submissions: number }; private_domains: { domain: string; ssl_enabled: boolean }[] }>("/api/admin/quota"),
  qrcode: (text: string) => request<{ text: string; data_url: string }>("/api/tools/qrcode", { method: "POST", body: JSON.stringify({ text }) }),
  resolveRedirect: (url: string) => request<{ input_url: string; redirected: boolean; final_url: string; steps: { url: string; status: number; location?: string }[]; truncated: boolean }>("/api/tools/resolve-redirect", { method: "POST", body: JSON.stringify({ url }) }),
  logout: () => sessionFetch("/auth/feishu/logout", { method: "POST" }).catch(() => undefined),
};
