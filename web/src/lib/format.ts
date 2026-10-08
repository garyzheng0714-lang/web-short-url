import { formatNumber } from "@/components/ui/chart-scale";

export { formatNumber };

const zhDate = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const zhDateTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const zhMonthDay = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" });

export function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : zhDate.format(d).replaceAll("/", "-");
}
/** 今年只显示月-日，往年带年份 */
export function fmtDateShort(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const full = zhDate.format(d).replaceAll("/", "-");
  const thisYear = zhDate.format(new Date()).slice(0, 4);
  return full.startsWith(thisYear) ? full.slice(5) : full;
}
export function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : zhDateTime.format(d).replaceAll("/", "-");
}
/** "2026-10-08" → "10/8" 这类轴标签 */
export function fmtAxisDay(date: string) {
  return zhMonthDay.format(new Date(`${date}T00:00:00+08:00`));
}
export function relativeTime(iso?: string | null, now = Date.now()) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return fmtDate(iso);
}
export function percent(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}
/** 较上期变化（小数）；上期为 0 时返回 undefined，调用方不显示 */
export function changeRatio(current: number, previous: number | null | undefined) {
  if (previous === null || previous === undefined || previous === 0) return undefined;
  return (current - previous) / previous;
}
export function shortUrlDisplay(url: string) {
  return url.replace(/^https?:\/\//, "");
}
export function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export const BROWSER_LABEL: Record<string, string> = { wechat: "微信", qq: "QQ", tencent: "QQ 浏览器", sogou: "搜狗", uc: "UC", ie: "IE", edge: "Edge", firefox: "Firefox", safari: "Safari", chrome: "Chrome", other: "其他" };
export const OS_LABEL: Record<string, string> = { ios: "iOS", android: "Android", windows: "Windows", macos: "macOS", linux: "Linux", other: "其他" };
export const DEVICE_LABEL: Record<string, string> = { mobile: "手机", pc: "电脑", other: "其他" };
export const NETWORK_LABEL: Record<string, string> = { mobile: "移动网络", broadband: "宽带" };
export const STATUS_LABEL: Record<string, string> = { active: "可用", suspended: "已暂停", banned: "已封禁", missing: "已删除" };
export const labelOf = (map: Record<string, string>, key: string | null | undefined) => (key ? map[key] || key : "未知");
