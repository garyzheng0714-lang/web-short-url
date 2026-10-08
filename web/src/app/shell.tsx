import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronsUpDown, LayoutDashboard, Link2, List, LogOut, Settings } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { NavItem } from "@/components/ui/nav-item";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BootstrapProvider, useBootstrap } from "./bootstrap";
import { api } from "@/lib/api";
import { clearSessionToken } from "@/lib/session";

const BRAND = "短链生成工具";
const PAGES = [
  { key: "create", to: "/", label: "生成短链", icon: <Link2 aria-hidden /> },
  { key: "dashboard", to: "/dashboard", label: "仪表盘", icon: <LayoutDashboard aria-hidden /> },
  { key: "data", to: "/data", label: "短链访问数据", icon: <List aria-hidden /> },
  { key: "settings", to: "/settings", label: "设置", icon: <Settings aria-hidden /> },
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
 * 侧栏底部的账号行（X、Patreon、Klaviyo 展开侧栏的排法）：头像、名字，末尾上下箭头；整行点开菜单，设置与退出登录在里面。
 * 和导航项同高（--ds-h-row）。对齐：侧栏脚左内边距 8 + 行内边距 4，24 的头像中心在 24，和导航图标中心同一条竖线；名字从 40 起，和导航文字同一条线。
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
          className="flex h-(--ds-h-row) w-full min-w-0 items-center gap-1 rounded-row pr-2 pl-1 text-left outline-none transition-colors duration-(--ds-dur-fast) hover:bg-hover focus-visible:focus-ring data-[state=open]:bg-hover"
        >
          <Avatar name={name} src={data.user.avatar_url || undefined} size={24} shape="circle" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{name}</span>
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
 * 外壳用 Su 的 Sidebar（收起 / 展开按钮在正文卡片左上角，快捷键 [；收起后碰左边缘浮出；右边线可拖动调宽；窄于 768 换成从左滑出的抽屉）。
 * 侧栏头：24 的站标中心与导航图标中心同一条竖线（头左内边距 12 + 12 = 24，导航 8 + 8 + 8 = 24），站名与导航文字同从 40 起。
 * 导航项单独放（不进 NavMenu）：当前底是静态的、悬停是 CSS，切换直接到位，不出现两块底追着滑。
 */
function Frame() {
  const current = useCurrentKey();
  return (
    <SidebarProvider className="@container h-dvh bg-sidebar text-fg">
      <Sidebar label="主导航">
        <SidebarHeader className="gap-1 ps-3">
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-sm bg-accent text-primary-fg">
            <Link2 className="size-4" />
          </span>
          <span className="truncate text-sm font-semibold">{BRAND}</span>
        </SidebarHeader>
        <SidebarContent>
          <div className="grid gap-(--ds-gap-row)">
            {PAGES.map((p) => (
              <NavItem key={p.key} asChild icon={p.icon} active={p.key === current}>
                <Link to={p.to}>{p.label}</Link>
              </NavItem>
            ))}
          </div>
        </SidebarContent>
        <SidebarFooter>
          <AccountRow />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-0 p-(--ds-gutter) @max-xl:p-0">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-card bg-canvas @max-xl:rounded-none">
          {/* 收起按钮嵌进卡片左上角：离上、左都是 4，圆角同心（同 Su 的 app-shell） */}
          <header className="flex h-(--ds-header-h) shrink-0 items-center pl-1">
            <SidebarTrigger className="rounded-popover" />
          </header>
          <div className="scroll-safe min-h-0 flex-1 overflow-y-auto">
            <main className="mx-auto flex min-h-full max-w-5xl flex-col px-6 pb-16">
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function AppShell() {
  return (
    <BootstrapProvider>
      <Frame />
    </BootstrapProvider>
  );
}
