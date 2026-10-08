// 会话兜底通道（与 public/login.html 和 server.js 的约定一致）：
// 飞书端内 / 客户电脑可能丢 HttpOnly cookie，登录回跳时后端在 URL hash 里附带 session_token；
// 前端启动时立即消费、存 sessionStorage、清地址栏；之后所有同源请求自动带 X-Session-Token。

const STORAGE_KEY = "shorturl_session_token";

export function consumeSessionTokenFromHash(): void {
  const m = (window.location.hash || "").match(/(?:^|[&#])session_token=([^&]+)/);
  if (!m) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, decodeURIComponent(m[1]));
  } catch {}
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearSessionToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function redirectToLogin(): void {
  clearSessionToken();
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?next=${next}`);
}

/** 同源 API 请求统一出口：自动带 cookie 与 X-Session-Token */
export function sessionFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getSessionToken();
  if (token && !headers.has("X-Session-Token")) headers.set("X-Session-Token", token);
  return fetch(input, { ...init, headers, credentials: "include" });
}
