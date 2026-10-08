import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronsUpDown, LayoutDashboard, Link2, List, LogOut, Settings } from "lucide-react";
import { Split, SplitPane } from "@/components/ui/split";
import { NavItem } from "@/components/ui/nav-item";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserMenu } from "@/components/ui/user-menu";
import { BootstrapProvider, useBootstrap } from "./bootstrap";
import { api } from "@/lib/api";
import { clearSessionToken } from "@/lib/session";

const BRAND = "短链生成工具";
/** short：窄屏顶栏里的短名（四个全名放不下 390 宽） */
const PAGES = [
  { key: "create", to: "/", label: "生成短链", short: "生成", icon: <Link2 aria-hidden /> },
  { key: "dashboard", to: "/dashboard", label: "仪表盘", short: "仪表盘", icon: <LayoutDashboard aria-hidden /> },
  { key: "data", to: "/data", label: "短链访问数据", short: "列表", icon: <List aria-hidden /> },
  { key: "settings", to: "/settings", label: "设置", short: "设置", icon: <Settings aria-hidden /> },
] as const;

function useCurrentKey() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/data")) return "data";
  return "create";
}

async function logout() {
  await api.logout();
  clearSessionToken();
  window.location.replace("/login");
}

/**
 * 侧栏底部的账号行（X、Patreon、Klaviyo 展开侧栏的排法）：头像、名字、身份，末尾上下箭头；整行点开菜单，设置与退出登录在里面。
 * 头像左缘与站标、导航图标同一条线（侧栏 8 + 行内边距 8）。
 */
function AccountRow() {
  const { data } = useBootstrap();
  const navigate = useNavigate();
  const name = data.user.name || "用户";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`账号菜单，${name}`}
          className="flex w-full min-w-0 items-center gap-2 rounded-row px-2 py-1.5 text-left outline-none transition-colors duration-(--ds-dur-fast) hover:bg-hover focus-visible:focus-ring data-[state=open]:bg-hover"
        >
          <Avatar name={name} src={data.user.avatar_url || undefined} size={32} shape="circle" />
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-medium text-fg">{name}</span>
            <span className="truncate text-xs text-fg-muted">{data.user.is_admin ? "管理员" : "成员"}</span>
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-fg-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings aria-hidden />
          设置
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut aria-hidden />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 侧栏：顶上站标与站名，中间四个入口，底部账号行。
 * 导航项不放进 NavMenu：那样会有一块跟随悬停底和一块滑动的当前底叠着追，切换显得拖沓；单独放时当前底是静态的、悬停是 CSS。
 */
function Sidebar() {
  const current = useCurrentKey();
  return (
    <SplitPane asChild width={228} scroll={false} surface="none" className="px-2">
      <nav aria-label="工作区" className="flex flex-col">
        <div className="flex h-(--ds-header-h) shrink-0 items-center gap-2 px-2">
          <span aria-hidden className="grid size-6 place-items-center rounded-sm bg-accent text-primary-fg">
            <Link2 className="size-4" />
          </span>
          <span className="text-sm font-semibold">{BRAND}</span>
        </div>
        <div className="grid gap-(--ds-gap-row)">
          {PAGES.map((p) => (
            <NavItem key={p.key} asChild icon={p.icon} active={p.key === current}>
              <Link to={p.to}>{p.label}</Link>
            </NavItem>
          ))}
        </div>
        <div className="mt-auto py-2">
          <AccountRow />
        </div>
      </nav>
    </SplitPane>
  );
}

/** 窄屏（< 768）：侧栏让位，顶上一行短名入口，账号菜单（头像，顶栏的排法）在行尾 */
function NarrowNav() {
  const current = useCurrentKey();
  const { data } = useBootstrap();
  return (
    <div className="flex h-(--ds-header-h) shrink-0 items-center gap-1 px-6 @3xl/app:hidden">
      {PAGES.map((p) => (
        <Button key={p.key} asChild variant="ghost" size="sm" aria-current={p.key === current ? "page" : undefined} className="first:edge-start">
          <Link to={p.to} aria-label={p.label}>
            {p.short}
          </Link>
        </Button>
      ))}
      <UserMenu user={{ name: data.user.name || "用户", avatar: data.user.avatar_url || undefined }} onSignOut={logout} className="edge-end ml-auto" />
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
            <main className="mx-auto flex min-h-full max-w-5xl flex-col px-6 pb-16">
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
