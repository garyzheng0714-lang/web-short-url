"use client"

import * as React from "react"
import { CircleAlert, LogOut, Monitor, Moon, Sun } from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PopupContext, useOpenState } from "@/components/ui/popup"
import { Spinner } from "@/components/ui/spinner"
import { Tag } from "@/components/ui/tag"

/**
 * 账号菜单：顶栏头像后面唯一的账号入口。身份（头像、名字、邮箱、套餐）→ 3–4 个账号去处 → 外观（浅色 / 深色 / 跟随系统）→ 退出。
 * - 宽 ≥ 640：从头像长出来的下拉菜单（DropdownMenu），宽 256，长名字、长邮箱截断，不撑宽。
 * - 宽 < 640：从屏幕下沿升起的底部面板（Drawer side="bottom"）：遮罩、锁住页面滚动，拖下、点遮罩、Esc 关闭，焦点回到头像。
 * - 外观：菜单里提供深浅切换与跟随系统（正在跟随时宽屏右侧打勾、窄屏按下底色）；换了不关菜单。组件只报告（onThemeChange），主题由使用方应用。
 * - 退出：onSignOut 返回 Promise 时原位显示「正在退出」，结束才关；连点不重复请求；失败原位显示「退出失败」，菜单不关，再点重试。
 * - 退出不算危险操作，用普通色。
 * - 头像放在一行末尾时写 className="edge-end"：推出去的只是按钮比 32 的头像多出的那一圈，头像的边落在内容线上。
 *
 * 动效（DESIGN.md K3、§2.4；键盘与指针同一套）：
 * - 宽屏打开 → 菜单从头像下方出现：透明度 + scaleY 0.96 + 朝头像 4px，fast（0.08s）；关闭 EXIT.fast（0.06s）（DropdownMenu）。
 *   悬停底是一块跟随悬停的底，打开两帧后焦点在第一行；「跟随系统」勾上时垫一块选中底。
 * - 窄屏打开 → 面板从下沿升起；拖动跟手，松手按速度弹回或退出（Drawer）。
 * - 换主题 → 菜单保持打开，勾与选中底 fast 画出。
 * - 减少动态 → 菜单与面板只淡入淡出。
 */
type UserMenuTheme = "light" | "dark" | "system"

type UserMenuUser = { name: string; email?: string; avatar?: string; initials?: string; plan?: string }
type UserMenuItem = { label: string; icon?: React.ReactNode; onSelect: () => void }

type UserMenuProps = {
  user: UserMenuUser
  /** 3–4 个账号去处：个人资料、设置、账单 */
  items?: UserMenuItem[]
  /** 当前外观；和 onThemeChange 一起传才显示外观一行 */
  theme?: UserMenuTheme
  onThemeChange?: (theme: UserMenuTheme) => void
  /** 返回 Promise：处理中原位显示，结束才关；拒绝时显示失败 */
  onSignOut?: () => void | Promise<unknown>
  signOutLabel?: string
  /** 加在头像按钮上 */
  className?: string
  /** 受控：菜单是否开着 */
  open?: boolean
  /** 非受控：挂载时就开着（静止展示）；窄屏（底部面板是模态）不生效 */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** 宽屏下拉菜单：默认 true，开着时页面其余部分不可交互；静止展示配 false。窄屏底部面板始终模态 */
  modal?: boolean
}


const NARROW = "(max-width: 639px)"
function useNarrow() {
  return React.useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(NARROW)
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    },
    () => window.matchMedia(NARROW).matches,
    () => false
  )
}

/** 退出：一次只发一个请求；成功后关菜单，失败留在原处。卸载后结果到达不再改状态。 */
function useSignOut(onSignOut: UserMenuProps["onSignOut"], close: () => void) {
  const [state, setState] = React.useState<"idle" | "pending" | "error">("idle")
  const busy = React.useRef(false)
  const alive = React.useRef(true)
  React.useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])
  const run = async () => {
    if (busy.current || !onSignOut) return
    busy.current = true
    setState("pending")
    try {
      await onSignOut()
      if (!alive.current) return
      setState("idle")
      close()
    } catch {
      if (alive.current) setState("error")
    } finally {
      busy.current = false
    }
  }
  const reset = () => {
    if (!busy.current) setState("idle")
  }
  return { state, run, reset }
}

function SignOutFace({ state, label }: { state: "idle" | "pending" | "error"; label: string }) {
  return state === "pending" ? (
    <>
      <Spinner aria-hidden />
      正在退出
    </>
  ) : state === "error" ? (
    <>
      <CircleAlert aria-hidden className="text-danger!" />
      退出失败，再试一次
    </>
  ) : (
    <>
      <LogOut aria-hidden />
      {label}
    </>
  )
}

/** 当前看到的是不是深色：跟随系统时读系统设置 */
const isDark = (theme?: UserMenuTheme) => theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)

/** 手动覆盖系统主题；跟随系统是复选项：正在跟随时右侧打勾，选了看得见（DESIGN.md §4.3）。 */
function ThemeRow({ theme, onThemeChange }: { theme: UserMenuTheme; onThemeChange: (theme: UserMenuTheme) => void }) {
  const dark = isDark(theme)
  return <>
    <DropdownMenuItem onSelect={e => { e.preventDefault(); onThemeChange(dark ? "light" : "dark") }}>
      {dark ? <Sun /> : <Moon />}{dark ? "切换浅色" : "切换深色"}
    </DropdownMenuItem>
    <DropdownMenuCheckboxItem checked={theme === "system"} onSelect={e => { e.preventDefault(); onThemeChange("system") }}>
      <Monitor />跟随系统
    </DropdownMenuCheckboxItem>
  </>
}

function UserMenu({ user, items = [], theme, onThemeChange, onSignOut, signOutLabel = "退出登录", className, open: openProp, defaultOpen = false, onOpenChange, modal = true }: UserMenuProps) {
  const narrow = useNarrow()
  const { open, setOpen, resting } = useOpenState(openProp, defaultOpen && !narrow, onOpenChange)
  const signOut = useSignOut(onSignOut, () => setOpen(false))
  const change = (next: boolean) => {
    if (next) signOut.reset()
    setOpen(next)
  }
  const dark = isDark(theme)
  const themed = theme !== undefined && onThemeChange !== undefined
  const status = signOut.state === "pending" ? "正在退出" : signOut.state === "error" ? "退出失败" : ""

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      data-slot="user-menu-trigger"
      aria-label={`账号菜单，${user.name}`}
      // 看得见的是 32 的头像：edge-start / edge-end 只推出按钮比头像多出的那一圈（DESIGN.md §4.5 光学对齐）
      className={cn("rounded-full [--ds-edge:calc((var(--ds-h-md)_-_32px)/2)] [--ds-ink-inset:0px]", className)}
    >
      <Avatar name={user.name} src={user.avatar} initials={user.initials} size={32} shape="circle" />
    </Button>
  )

  if (narrow) {
    return (
      <Drawer open={open} onOpenChange={change}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent
          side="bottom"
          title={user.name}
          description={
            user.email || user.plan ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{user.email}</span>
                {user.plan ? <Tag variant="chip">{user.plan}</Tag> : null}
              </span>
            ) : undefined
          }
        >
          {items.length ? (
            <div className="-mx-(--ds-pad-x-md) grid">
              {items.map((item) => (
                <Button
                  key={item.label}
                  variant="ghost"
                  className="w-full justify-start text-fg"
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                >
                  {item.icon}
                  {item.label}
                </Button>
              ))}
            </div>
          ) : null}
          {themed ? (
            <div data-slot="user-menu-theme" className="flex items-center justify-between gap-item">
              <span className="text-base">外观</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => onThemeChange(dark ? "light" : "dark")}>
                  {dark ? <Sun /> : <Moon />}{dark ? "切换浅色" : "切换深色"}
                </Button>
                {/* 正在跟随系统：按下的底色（ghost 的 aria-pressed），不加勾号，宽度不变 */}
                <Button variant="ghost" aria-pressed={theme === "system"} onClick={() => onThemeChange("system")}>
                  <Monitor />跟随系统
                </Button>
              </div>
            </div>
          ) : null}
          {onSignOut ? (
            <div className="-mx-(--ds-pad-x-md) grid">
              <Button
                variant="ghost"
                data-slot="user-menu-sign-out"
                aria-busy={signOut.state === "pending" || undefined}
                className="w-full justify-start text-fg"
                onClick={() => void signOut.run()}
              >
                <SignOutFace state={signOut.state} label={signOutLabel} />
              </Button>
            </div>
          ) : null}
          <span role="status" className="sr-only">
            {status}
          </span>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={change} modal={modal}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      {/* 开关在这里管，受控地交给 DropdownMenu，它只看得到 open、算不出「静止打开」：resting 在内容层外再给一次，
          defaultOpen 的菜单载入、换示例时不把焦点拉进去（2026-10-06 第四轮） */}
      <PopupContext value={{ open, setOpen: change, resting }}>
      <DropdownMenuContent className="w-64 max-w-[calc(100vw-16px)]">
        <div data-slot="user-menu-identity" className="flex items-center gap-2 p-2">
          <Avatar name={user.name} src={user.avatar} initials={user.initials} size={32} shape="circle" />
          <div className="grid min-w-0 flex-1">
            <span className="truncate font-medium">{user.name}</span>
            {user.email ? <span className="truncate text-xs text-fg-muted">{user.email}</span> : null}
          </div>
          {user.plan ? <Tag variant="chip">{user.plan}</Tag> : null}
        </div>
        {items.length ? <DropdownMenuSeparator /> : null}
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
        {themed ? (
          <>
            <DropdownMenuSeparator />
            <ThemeRow theme={theme} onThemeChange={onThemeChange} />
          </>
        ) : null}
        {onSignOut ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-slot="user-menu-sign-out"
              aria-busy={signOut.state === "pending" || undefined}
              // 退出要等结果：菜单先不关
              onSelect={(e) => {
                e.preventDefault()
                void signOut.run()
              }}
            >
              <SignOutFace state={signOut.state} label={signOutLabel} />
            </DropdownMenuItem>
          </>
        ) : null}
        <span role="status" className="sr-only">
          {status}
        </span>
      </DropdownMenuContent>
      </PopupContext>
    </DropdownMenu>
  )
}

export { UserMenu, type UserMenuItem, type UserMenuProps, type UserMenuTheme, type UserMenuUser }
