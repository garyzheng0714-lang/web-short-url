import { Link, Outlet, useLocation } from "react-router-dom";
import { FolderOpen, Link2, LogOut, Settings } from "lucide-react";
import { Split, SplitPane } from "@/components/ui/split";
import { NavItem, NavMenu } from "@/components/ui/nav-item";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { BootstrapProvider, useBootstrap } from "./bootstrap";
import { api } from "@/lib/api";
import { clearSessionToken } from "@/lib/session";

/** 「短链」「分组」是首页的两种视图（同一页，?view=groups），「设置」是单独一页 */
const PAGES = [
  { key: "links", to: "/", label: "短链", icon: <Link2 aria-hidden /> },
  { key: "groups", to: "/?view=groups", label: "分组", icon: <FolderOpen aria-hidden /> },
  { key: "settings", to: "/settings", label: "设置", icon: <Settings aria-hidden /> },
] as const;

function useCurrentKey() {
  const { pathname, search } = useLocation();
  if (pathname.startsWith("/settings")) return "settings";
  return new URLSearchParams(search).get("view") === "groups" ? "groups" : "links";
}

async function logout() {
  await api.logout();
  clearSessionToken();
  window.location.replace("/login");
}

function Sidebar() {
  const { data } = useBootstrap();
  const current = useCurrentKey();
  return (
    <SplitPane asChild width={228} scroll={false} surface="none" className="px-2">
      <nav aria-label="工作区" className="flex flex-col">
        <div className="flex h-(--ds-header-h) shrink-0 items-center px-2 text-sm font-semibold">FBIF 短链</div>
        <NavMenu>
          {PAGES.map((p) => (
            <NavItem key={p.key} asChild icon={p.icon} active={p.key === current}>
              <Link to={p.to}>{p.label}</Link>
            </NavItem>
          ))}
        </NavMenu>
        <div className="mt-auto flex items-center gap-2 px-2 py-3">
          <Avatar name={data.user.name || "用户"} src={data.user.avatar_url || undefined} size={24} shape="circle" />
          <span className="min-w-0 flex-1 truncate text-sm">{data.user.name}</span>
          <Tooltip content="退出登录">
            <Button variant="ghost" size="icon-sm" aria-label="退出登录" onClick={() => void logout()}>
              <LogOut />
            </Button>
          </Tooltip>
        </div>
      </nav>
    </SplitPane>
  );
}

/** 窄屏（< 768）：侧栏让位，页面顶上一行同样的入口 */
function NarrowNav() {
  const current = useCurrentKey();
  return (
    <div className="flex h-(--ds-header-h) shrink-0 items-center gap-1 px-6 @3xl/app:hidden">
      <span className="mr-2 text-sm font-semibold">FBIF 短链</span>
      {PAGES.map((p) => (
        <Button key={p.key} asChild variant="ghost" size="sm" aria-current={p.key === current ? "page" : undefined}>
          <Link to={p.to}>{p.label}</Link>
        </Button>
      ))}
      <Tooltip content="退出登录">
        <Button variant="ghost" size="icon-sm" aria-label="退出登录" className="edge-end ml-auto" onClick={() => void logout()}>
          <LogOut />
        </Button>
      </Tooltip>
    </div>
  );
}

function Frame() {
  return (
    <div className="@container/app h-dvh bg-canvas text-fg">
      <Split>
        <div className="hidden @3xl/app:contents">
          <Sidebar />
        </div>
        <SplitPane scroll={false} className="@container/main">
          <NarrowNav />
          <div className="min-h-0 flex-1 overflow-y-auto scroll-safe">
            <main className="mx-auto max-w-5xl px-6 pb-16">
              <Outlet />
            </main>
          </div>
        </SplitPane>
      </Split>
    </div>
  );
}

export function AppShell() {
  return (
    <BootstrapProvider>
      <Frame />
    </BootstrapProvider>
  );
}
