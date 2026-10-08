import { Link, Outlet, useNavigate } from "react-router-dom";
import { LogOut, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BootstrapProvider, useBootstrap } from "./bootstrap";
import { api } from "@/lib/api";
import { clearSessionToken } from "@/lib/session";

async function logout() {
  await api.logout();
  clearSessionToken();
  window.location.replace("/login");
}

/** 一页的工具，没有侧栏：顶栏只有站名和账号菜单，内容一列居中。 */
function Frame() {
  const { data } = useBootstrap();
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh bg-canvas text-fg">
      <header className="sticky top-0 z-30 bg-canvas">
        <div className="mx-auto flex h-(--ds-header-h) max-w-5xl items-center px-6">
          <Link to="/" className="text-sm font-semibold">
            FBIF 短链
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="账号" className="edge-end ml-auto">
                <Avatar name={data.user.name || "用户"} src={data.user.avatar_url || undefined} size={24} shape="circle" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{data.user.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate("/settings")}>
                <Settings aria-hidden />
                设置
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOut aria-hidden />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 pb-16">
        <Outlet />
      </main>
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
