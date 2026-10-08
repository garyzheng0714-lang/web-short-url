import { Link, Outlet, useLocation } from "react-router-dom";
import { ChartLine, Link2, Settings } from "lucide-react";
import { Split, SplitPane } from "@/components/ui/split";
import { NavItem } from "@/components/ui/nav-item";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/ui/user-menu";
import { BootstrapProvider, useBootstrap } from "./bootstrap";
import { api } from "@/lib/api";
import { clearSessionToken } from "@/lib/session";

const BRAND = "短链生成工具";
const PAGES = [
  { key: "create", to: "/", label: "生成短链", icon: <Link2 aria-hidden /> },
  { key: "data", to: "/data", label: "短链访问数据", icon: <ChartLine aria-hidden /> },
  { key: "settings", to: "/settings", label: "设置", icon: <Settings aria-hidden /> },
] as const;

function useCurrentKey() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/data")) return "data";
  return "create";
}

async function logout() {
  await api.logout();
  clearSessionToken();
  window.location.replace("/login");
}

/** 账号入口：头像点开是二级菜单（身份、退出登录），不在侧栏上直接摆退出按钮 */
function Account({ className }: { className?: string }) {
  const { data } = useBootstrap();
  return <UserMenu user={{ name: data.user.name || "用户", avatar: data.user.avatar_url || undefined }} onSignOut={logout} className={className} />;
}

/**
 * 侧栏：站名 + 账号菜单，下面三个入口。导航项不放进 NavMenu：那样会有一块跟随悬停底和一块滑动的当前底叠着追，
 * 切换显得拖沓；单独放时当前底是静态的、悬停是 CSS，点了直接到位。
 */
function Sidebar() {
  const current = useCurrentKey();
  return (
    <SplitPane asChild width={228} scroll={false} surface="none" className="px-2">
      <nav aria-label="工作区" className="flex flex-col">
        <div className="flex h-(--ds-header-h) shrink-0 items-center justify-between pl-2">
          <span className="text-sm font-semibold">{BRAND}</span>
          <Account />
        </div>
        <div className="grid gap-(--ds-gap-row)">
          {PAGES.map((p) => (
            <NavItem key={p.key} asChild icon={p.icon} active={p.key === current}>
              <Link to={p.to}>{p.label}</Link>
            </NavItem>
          ))}
        </div>
      </nav>
    </SplitPane>
  );
}

/** 窄屏（< 768）：侧栏让位，顶上一行同样的入口，账号菜单在行尾 */
function NarrowNav() {
  const current = useCurrentKey();
  return (
    <div className="flex h-(--ds-header-h) shrink-0 items-center gap-1 px-6 @3xl/app:hidden">
      {PAGES.map((p) => (
        <Button key={p.key} asChild variant="ghost" size="sm" aria-current={p.key === current ? "page" : undefined} className="first:edge-start">
          <Link to={p.to}>{p.label}</Link>
        </Button>
      ))}
      <Account className="edge-end ml-auto" />
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
